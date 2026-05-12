'use client'
import { useEffect, useState } from 'react'
import { getPushSubscription, unsubscribeFromPush, subscribeToPush } from '@/lib/push'
import { useI18n } from '@/lib/i18n'

type Props = {
  groupId:   string
  label?:    string
  onToggle?: (subscribed: boolean) => void
}

export default function PushToggle({ groupId, label, onToggle }: Props) {
  const { t } = useI18n()
  const [supported,   setSupported]   = useState(false)
  const [subscribed,  setSubscribed]  = useState(false)
  const [loading,     setLoading]     = useState(true)

  // ── Check current subscription state on mount ────────────────────────────
  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setLoading(false)
      return
    }
    setSupported(true)

    // Bug 2 fix: use getRegistrations() to find any active SW, not a specific
    // scope string, then check pushManager subscription status.
    navigator.serviceWorker.getRegistrations().then(async regs => {
      for (const reg of regs) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) { setSubscribed(true); break }
      }
      setLoading(false)
    })
  }, [])

  const toggle = async () => {
    setLoading(true)
    try {
      if (subscribed) {
        // Unsubscribe: tell server to remove the endpoint, then unsubscribe locally
        const sub = await getPushSubscription()
        if (sub) {
          await fetch('/api/push/subscribe', {
            method:  'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ endpoint: sub.endpoint }),
          })
          await unsubscribeFromPush()
        }
        setSubscribed(false)
        onToggle?.(false)
      } else {
        // Bug 1 fix: read NEXT_PUBLIC_ var here at call time, not at module level.
        // Next.js statically replaces process.env.NEXT_PUBLIC_* at build time,
        // so this is still a compile-time constant — but reading it here avoids
        // the empty-string trap caused by the module-level assignment running
        // before the build replacement is applied in certain bundler configs.
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
        if (!vapidKey) {
          alert('Push notifications are not configured (missing VAPID key). Please contact support.')
          setLoading(false)
          return
        }

        const sub = await subscribeToPush(vapidKey)
        if (sub) {
          const res = await fetch('/api/push/subscribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ groupId, subscription: sub.toJSON() }),
          })
          if (res.ok) {
            setSubscribed(true)
            onToggle?.(true)
          } else {
            // API rejected — clean up the browser subscription too
            await sub.unsubscribe()
            console.error('[PushToggle] subscribe API failed', await res.text())
          }
        }
      }
    } catch (e) {
      console.error('[PushToggle] toggle error:', e)
    }
    setLoading(false)
  }

  if (!supported) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 16px', background: 'var(--surface-2)',
      borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
    }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
          {label ?? t('push.defaultLabel')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {loading
            ? 'Checking…'
            : subscribed ? t('push.subscribedHint') : t('push.unsubscribedHint')}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={loading}
        aria-label={subscribed ? t('push.disableAriaLabel') : t('push.enableAriaLabel')}
        style={{
          width: 48, height: 26, borderRadius: 13,
          background: loading ? '#9ca3af' : subscribed ? 'var(--success, #22c55e)' : '#d1d5db',
          border: 'none', cursor: loading ? 'wait' : 'pointer',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 3, width: 20, height: 20,
          borderRadius: '50%', background: 'white',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          transition: 'left 0.2s',
          left: subscribed ? 25 : 3,
        }} />
      </button>
    </div>
  )
}