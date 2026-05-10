'use client'
import { useEffect, useState } from 'react'
import { subscribeToPush, getPushSubscription, unsubscribeFromPush } from '@/lib/push'
import { useI18n } from '@/lib/i18n'

type Props = {
  groupId: string
  label?: string
}

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

export default function PushToggle({ groupId, label }: Props) {
  const { t } = useI18n()
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    setSupported(true)
    getPushSubscription().then(sub => setSubscribed(!!sub))
  }, [])

  const toggle = async () => {
    setLoading(true)
    try {
      if (subscribed) {
        const sub = await getPushSubscription()
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
          await unsubscribeFromPush()
        }
        setSubscribed(false)
      } else {
        if (!VAPID_KEY) {
          alert('Push notifications require NEXT_PUBLIC_VAPID_PUBLIC_KEY to be set.')
          setLoading(false)
          return
        }
        const sub = await subscribeToPush(VAPID_KEY)
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, subscription: sub.toJSON() }),
          })
          setSubscribed(true)
        }
      }
    } catch (e) {
      console.error('Push toggle error:', e)
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
        <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{label ?? t('push.defaultLabel')}</p>
        <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {subscribed ? t('push.subscribedHint') : t('push.unsubscribedHint')}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={loading}
        aria-label={subscribed ? t('push.disableAriaLabel') : t('push.enableAriaLabel')}
        style={{
          width: 48, height: 26, borderRadius: 13,
          background: subscribed ? 'var(--success, #22c55e)' : '#d1d5db',
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
