// Push notification helpers — client-side only

export const PUSH_STORAGE_KEY = 'splitmate_push_subscription'

/** Convert a base64url VAPID public key to a Uint8Array */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

/** Register the service worker and subscribe to push notifications.
 *  Returns the PushSubscription or null on failure. */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })
  return subscription
}

/** Check if currently subscribed */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

/** Unsubscribe from push notifications */
export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getPushSubscription()
  if (sub) await sub.unsubscribe()
}

/** Send a push notification via our API route */
export async function sendPushNotification(opts: {
  groupId: string
  title: string
  body: string
  url: string
}): Promise<void> {
  try {
    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
  } catch {
    // Fail silently — push is best-effort
  }
}
