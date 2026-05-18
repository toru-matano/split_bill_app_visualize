'use client'
/**
 * hooks/useServiceWorker.ts
 *
 * Registers /sw.js and manages its lifecycle cleanly.
 *
 * Responsibilities:
 *  1. Register the SW after the page is interactive (window 'load' event).
 *  2. Detect when a new SW version is waiting and notify the user.
 *  3. Trigger SKIP_WAITING + reload when the user accepts the update.
 *
 * The hook is called once in the root layout so it runs on every page
 * without polluting individual page components.
 *
 * Update flow:
 *   New SW downloaded → SW enters 'waiting' state → hook sets `updateReady`
 *   → UI shows "Update available" toast/banner → user taps "Reload"
 *   → hook posts SKIP_WAITING → new SW activates → page reloads fresh.
 */

import { useEffect, useState } from 'react'

type SwState = {
  /** True once a newer SW version is waiting to activate */
  updateReady: boolean
  /** Call this to immediately activate the waiting SW and reload */
  activateUpdate: () => void
}

export function useServiceWorker(): SwState {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const updateReady = waitingWorker !== null

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator)
    ) return

    let registration: ServiceWorkerRegistration | null = null

    const onControllerChange = () => {
      // New SW has taken control — reload to use fresh assets
      window.location.reload()
    }

    const trackWaiting = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) {
        setWaitingWorker(reg.waiting)
        return
      }
      // Listen for a future update
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            // A new SW installed while an old one is still controlling the page
            setWaitingWorker(installing)
          }
        })
      })
    }

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', {
          // scope defaults to '/' — explicit for clarity
          scope: '/',
          // updateViaCache: 'none' forces the browser to always fetch /sw.js
          // from the network (bypassing the HTTP cache) so updates are detected
          // immediately without waiting for the HTTP cache to expire.
          updateViaCache: 'none',
        })

        trackWaiting(registration)

        // Periodically check for updates (every 60 s while the page is open)
        const intervalId = setInterval(() => {
          registration?.update().catch(() => {})
        }, 60_000)

        // Cleanup on unmount
        return () => clearInterval(intervalId)
      } catch (err) {
        console.warn('[SW] Registration failed:', err)
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Defer registration until after first paint to not compete with
    // critical resources during page load.
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
    }

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  const activateUpdate = () => {
    if (!waitingWorker) return
    // Tell the waiting SW to skip the waiting phase and activate immediately
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    // controllerchange fires → onControllerChange → window.location.reload()
  }

  return { updateReady, activateUpdate }
}
