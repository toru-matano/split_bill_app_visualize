import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Minimal VAPID push sender using web-push if available, else direct fetch
async function sendWebPush(subscription: {
  endpoint: string; p256dh: string | null; auth: string | null
}, payload: string) {
  // Try using web-push library if installed
  try {
    const webpush = await import('web-push')
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!
    const vapidEmail = process.env.VAPID_EMAIL ?? 'mailto:admin@splitmate.app'

    webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh ?? '', auth: subscription.auth ?? '' },
      },
      payload
    )
  } catch {
    // web-push not available — skip silently in dev
  }
}

export async function POST(req: NextRequest) {
  const { groupId, title, body, url } = await req.json()
  if (!groupId) return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })

  // Fetch all subscriptions for this group
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('group_id', groupId)

  if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

  const payload = JSON.stringify({ title, body, url, tag: `expense-${groupId}` })

  let sent = 0
  const stale: string[] = []

  await Promise.all(
    subs.map(async sub => {
      try {
        await sendWebPush(sub, payload)
        sent++
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 410 || status === 404) stale.push(sub.endpoint)
      }
    })
  )

  // Clean up expired subscriptions
  if (stale.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', stale)
  }

  return NextResponse.json({ ok: true, sent })
}
