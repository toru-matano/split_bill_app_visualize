/**
 * app/api/push/subscribe/route.ts  (REFACTORED)
 *
 * Changes from original:
 *  - The push endpoint URL, p256dh key, and auth secret are encrypted
 *    client-side (server-side application layer) with AES-256-GCM before
 *    insertion into `push_subscription_secure_data`.
 *  - A blind index (HMAC-SHA-256) of the endpoint URL is stored in
 *    `endpoint_hash` and used as the unique key for upsert/deduplication —
 *    replacing the old UNIQUE constraint on the plaintext `endpoint` column.
 *  - The `push_subscriptions` base table retains only `id` and `group_id`.
 *  - DELETE uses the blind index for lookup instead of a plaintext match.
 *  - No encrypted bytes are ever returned to the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError, validatePushEndpoint } from '@/lib/validation'
import { encrypt, blindIndex } from '@/lib/crypto'

const db = supabaseServer

export async function POST(req: NextRequest) {
  try {
    const { groupId, subscription } = await req.json()
    if (!groupId || typeof groupId !== 'string') {
      return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
    }

    // ── 1. Validate inputs before touching crypto ──────────────────────────
    const endpoint = validatePushEndpoint(subscription?.endpoint)
    const p256dh   = typeof subscription?.keys?.p256dh === 'string' ? subscription.keys.p256dh : null
    const auth     = typeof subscription?.keys?.auth   === 'string' ? subscription.keys.auth   : null

    // ── 2. Compute blind index for deduplication ───────────────────────────
    const endpointHash = blindIndex(endpoint)

    // ── 3. Encrypt sensitive fields ────────────────────────────────────────
    const endpointEnc = encrypt(endpoint)
    const p256dhEnc   = p256dh ? encrypt(p256dh) : null
    const authEnc     = auth   ? encrypt(auth)   : null

    // ── 4. Upsert base row (group_id only) — keyed by endpoint blind index ─
    //
    // We cannot upsert on a UNIQUE column that no longer exists (endpoint was
    // dropped).  Instead we upsert on the secure table's `endpoint_hash` UNIQUE
    // column via a two-step: find existing secure row, then insert or update.
    const { data: existingSecure } = await db
      .from('push_subscription_secure_data')
      .select('subscription_id')
      .eq('endpoint_hash', endpointHash)
      .maybeSingle()

    if (existingSecure) {
      // Update the encrypted payload in-place (e.g. key rotation)
      const { error } = await db
        .from('push_subscription_secure_data')
        .update({
          endpoint_enc : endpointEnc,
          p256dh_enc   : p256dhEnc,
          auth_enc     : authEnc,
        })
        .eq('subscription_id', existingSecure.subscription_id)
      if (error) throw error

      // Also re-associate with the (possibly new) group
      const { error: baseErr } = await db
        .from('push_subscriptions')
        .update({ group_id: groupId })
        .eq('id', existingSecure.subscription_id)
      if (baseErr) throw baseErr
    } else {
      // New subscription — insert base row first to get the generated id
      const { data: baseSub, error: baseErr } = await db
        .from('push_subscriptions')
        .insert({ group_id: groupId })
        .select('id')
        .single()
      if (baseErr) throw baseErr

      // Insert secure row
      const { error: secureErr } = await db
        .from('push_subscription_secure_data')
        .insert({
          subscription_id : baseSub.id,
          endpoint_enc    : endpointEnc,
          endpoint_hash   : endpointHash,
          p256dh_enc      : p256dhEnc,
          auth_enc        : authEnc,
        })
      if (secureErr) throw secureErr
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[POST /api/push/subscribe]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { endpoint } = await req.json()
    const validated = validatePushEndpoint(endpoint)

    // ── Look up by blind index — no plaintext in DB ────────────────────────
    const endpointHash = blindIndex(validated)

    const { data: secureRow } = await db
      .from('push_subscription_secure_data')
      .select('subscription_id')
      .eq('endpoint_hash', endpointHash)
      .maybeSingle()

    if (secureRow) {
      // Deleting the base row cascades to the secure table (ON DELETE CASCADE)
      await db
        .from('push_subscriptions')
        .delete()
        .eq('id', secureRow.subscription_id)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
