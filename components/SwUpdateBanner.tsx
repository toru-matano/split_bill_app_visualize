'use client'
/**
 * components/SwUpdateBanner.tsx
 *
 * A non-blocking toast banner that appears at the bottom of the screen
 * when a new Service Worker version is waiting to activate.
 *
 * The banner is intentionally unobtrusive — it doesn't block the UI and
 * can be dismissed. Tapping "Reload" triggers SKIP_WAITING via the hook
 * and the page reloads with fresh assets.
 */

import { useServiceWorker } from '@/hooks/useServiceWorker'

export default function SwUpdateBanner() {
  const { updateReady, activateUpdate } = useServiceWorker()

  if (!updateReady) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: '#1a1a1a',
        color: '#fff',
        borderRadius: 10,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100vw - 32px)',
        animation: 'swBannerIn 0.25s ease',
      }}
    >
      <style>{`
        @keyframes swBannerIn {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      <i className="fa-solid fa-arrow-rotate-right" style={{ fontSize: 14, color: '#60a5fa' }} />
      <span>Update available</span>
      <button
        onClick={activateUpdate}
        style={{
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '5px 12px',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Reload
      </button>
    </div>
  )
}
