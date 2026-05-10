/**
 * app/api/push/send/route.ts  (REFACTORED)
 *
 * Changes from original:
 *  - Push subscription data is now stored encrypted in
 *    `push_subscription_secure_data`.  This route joins the two tables,
 *    decrypts `endpoint_enc`, `p256dh_enc`, and `auth_enc` in the application
 *    layer immediately before passing them to `web-push`, then discards the
 *    plaintext values.
 *  - Stale-subscription cleanup uses the `subscription_id` foreign key
 *    (cascades to the secure table automatically).
 *  - No decrypted values are logged or returned to the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { decrypt } from '@/lib/crypto'

const db = supabaseServer

// ── Internal helper: decrypt and send a single push notification ─────────────
async function sendWebPush(
  sub: {
    endpoint_enc : Buffer | string
    p256dh_enc   : Buffer | string | null
    auth_enc     : Buffer | string | null
  },
  payload: string,
) {
  const webpush        = await import('web-push')
  const vapidPublicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidEmail      = process.env.VAPID_EMAIL ?? 'mailto:admin@splitmate.app'
  if (!vapidPublicKey || !vapidPrivateKey) return  // VAPID not configured; skip silently

  // ── Decrypt immediately before use; never stored as local variables beyond ──
  //    this function scope.
  const endpoint = decrypt(sub.endpoint_enc as Buffer)
  const p256dh   = sub.p256dh_enc ? decrypt(sub.p256dh_enc as Buffer) : ''
  const auth     = sub.auth_enc   ? decrypt(sub.auth_enc   as Buffer) : ''

  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)
  await webpush.sendNotification(
    { endpoint, keys: { p256dh, auth } },
    payload,
  )
}

export async function POST(req: NextRequest) {
  try {
    const { groupId, title, body, url } = await req.json()
    if (!groupId || typeof groupId !== 'string') {
      return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
    }

    // ── Fetch base subscription IDs for this group, then join to secure data ──
    const { data: baseSubs } = await db
      .from('push_subscriptions')
      .select('id')
      .eq('group_id', groupId)

    if (!baseSubs?.length) return NextResponse.json({ ok: true, sent: 0 })

    const subIds = baseSubs.map(s => s.id)

    const { data: secureSubs } = await db
      .from('push_subscription_secure_data')
      .select('subscription_id, endpoint_enc, p256dh_enc, auth_enc')
      .in('subscription_id', subIds)

    if (!secureSubs?.length) return NextResponse.json({ ok: true, sent: 0 })

    const payload = JSON.stringify({ title, body, url, tag: `expense-${groupId}` })
    let sent = 0
    const staleIds: string[] = []

    await Promise.all(
      secureSubs.map(async sub => {
        try {
          await sendWebPush(sub, payload)
          sent++
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode
          if (status === 410 || status === 404) {
            staleIds.push(sub.subscription_id)
          }
        }
      }),
    )

    // ── Clean up stale subscriptions (cascade deletes secure rows too) ──────
    if (staleIds.length) {
      await db
        .from('push_subscriptions')
        .delete()
        .in('id', staleIds)
    }

    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[POST /api/push/send]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
