import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

const db = supabaseServer

async function sendWebPush(sub: { endpoint: string; p256dh: string | null; auth: string | null }, payload: string) {
  const webpush = await import('web-push')
  const vapidPublicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidEmail      = process.env.VAPID_EMAIL ?? 'mailto:admin@splitmate.app'
  if (!vapidPublicKey || !vapidPrivateKey) return // VAPID not configured, skip silently

  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh ?? '', auth: sub.auth ?? '' } },
    payload,
  )
}

export async function POST(req: NextRequest) {
  try {
    const { groupId, title, body, url } = await req.json()
    if (!groupId || typeof groupId !== 'string') return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })

    const { data: subs } = await db
      .from('push_subscriptions').select('endpoint, p256dh, auth').eq('group_id', groupId)
    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

    const payload = JSON.stringify({ title, body, url, tag: `expense-${groupId}` })
    let sent = 0
    const stale: string[] = []

    await Promise.all(subs.map(async sub => {
      try { await sendWebPush(sub, payload); sent++ }
      catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 410 || status === 404) stale.push(sub.endpoint)
      }
    }))

    if (stale.length) await db.from('push_subscriptions').delete().in('endpoint', stale)

    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[POST /api/push/send]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
