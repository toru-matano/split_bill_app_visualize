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
import webpushLib from 'web-push'
import { supabaseServer } from '@/lib/supabase-server'
import { decrypt } from '@/lib/crypto'

const db = supabaseServer

// ── Internal helper: decrypt and send a single push notification ─────────────
async function sendWebPush(
  sub: {
    subscription_id : string
    endpoint_enc    : Buffer | string
    p256dh_enc      : Buffer | string | null
    auth_enc        : Buffer | string | null
  },
  payload: string,
): Promise<'sent' | 'stale' | 'error'> {
  const vapidPublicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidEmail      = process.env.VAPID_EMAIL ?? 'mailto:admin@splitmate.app'

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('[push/send] VAPID keys missing — set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY')
    return 'error'
  }

  // Bug 4 fix: webpushLib is the correct default import from web-push (CJS pkg).
  // Using the static import at the top of the file avoids the `.default` dance.
  let endpoint: string, p256dh: string, auth: string
  try {
    endpoint = decrypt(sub.endpoint_enc as Buffer)
    p256dh   = sub.p256dh_enc ? decrypt(sub.p256dh_enc as Buffer) : ''
    auth     = sub.auth_enc   ? decrypt(sub.auth_enc   as Buffer) : ''
  } catch (err) {
    console.error(`[push/send] Failed to decrypt subscription ${sub.subscription_id}:`, err)
    return 'error'
  }

  try {
    webpushLib.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)
    await webpushLib.sendNotification({ endpoint, keys: { p256dh, auth } }, payload)
    return 'sent'
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 410 || status === 404) {
      return 'stale'  // Browser unsubscribed — clean up
    }
    // Bug 5 fix: log all other errors so they're visible in server logs
    console.error(`[push/send] sendNotification failed for ${sub.subscription_id}:`, err)
    return 'error'
  }
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
        const result = await sendWebPush(sub, payload)
        if (result === 'sent')  sent++
        if (result === 'stale') staleIds.push(sub.subscription_id)
      }),
    )

    // ── Clean up stale subscriptions (cascade deletes secure rows too) ──────
    if (staleIds.length) {
      await db
        .from('push_subscriptions')
        .delete()
        .in('id', staleIds)
    }

    console.log(`[push/send] groupId=${groupId} sent=${sent} stale=${staleIds.length} total=${secureSubs.length}`)
    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[POST /api/push/send]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
