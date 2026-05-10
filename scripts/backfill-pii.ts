/**
 * scripts/backfill-pii.ts
 *
 * ONE-TIME back-fill script: reads all existing plain-text PII from the
 * legacy columns, encrypts it, and writes it to the new secure tables.
 *
 * Run BEFORE executing the DROP COLUMN statements in pii_migration.sql.
 *
 * Usage:
 *   npx tsx scripts/backfill-pii.ts
 *
 * Required env vars (same as production):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PII_ENCRYPTION_KEY   — 32-byte key as 64 hex chars or base64
 *   PII_BLIND_INDEX_KEY  — 32-byte key as 64 hex chars or base64
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { encrypt, blindIndex } from '../lib/crypto'

const url        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db         = createClient(url, serviceKey, { auth: { persistSession: false } })

// ─────────────────────────────────────────────────────────────────────────────
// 1. Back-fill member names
// ─────────────────────────────────────────────────────────────────────────────
async function backfillMembers() {
  console.log('[backfill] Fetching members with plain-text names…')

  // At this stage the `name` column still exists (we haven't dropped it yet)
  const { data: members, error } = await db
    .from('members')
    .select('id, name')

  if (error) throw error
  console.log(`[backfill] Found ${members?.length ?? 0} members to migrate`)

  let migrated = 0
  let skipped  = 0

  for (const m of members ?? []) {
    if (!m.name) { skipped++; continue }

    // Check if a secure row already exists (idempotent re-run support)
    const { data: existing } = await db
      .from('member_secure_data')
      .select('member_id')
      .eq('member_id', m.id)
      .maybeSingle()

    if (existing) { skipped++; continue }

    const { error: insErr } = await db
      .from('member_secure_data')
      .insert({
        member_id : m.id,
        name_enc  : encrypt(m.name),
        name_hash : blindIndex(m.name),
      })

    if (insErr) {
      console.error(`[backfill] Failed for member ${m.id}:`, insErr.message)
    } else {
      migrated++
    }
  }

  console.log(`[backfill] Members: ${migrated} migrated, ${skipped} skipped`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Back-fill push subscriptions
// ─────────────────────────────────────────────────────────────────────────────
async function backfillPushSubscriptions() {
  console.log('[backfill] Fetching push_subscriptions with plain-text endpoints…')

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, group_id, endpoint, p256dh, auth')

  if (error) throw error
  console.log(`[backfill] Found ${subs?.length ?? 0} push subscriptions to migrate`)

  let migrated = 0
  let skipped  = 0

  for (const s of subs ?? []) {
    if (!s.endpoint) { skipped++; continue }

    const endpointHash = blindIndex(s.endpoint)

    const { data: existing } = await db
      .from('push_subscription_secure_data')
      .select('subscription_id')
      .eq('subscription_id', s.id)
      .maybeSingle()

    if (existing) { skipped++; continue }

    const { error: insErr } = await db
      .from('push_subscription_secure_data')
      .insert({
        subscription_id : s.id,
        endpoint_enc    : encrypt(s.endpoint),
        endpoint_hash   : endpointHash,
        p256dh_enc      : s.p256dh ? encrypt(s.p256dh) : null,
        auth_enc        : s.auth   ? encrypt(s.auth)   : null,
      })

    if (insErr) {
      console.error(`[backfill] Failed for subscription ${s.id}:`, insErr.message)
    } else {
      migrated++
    }
  }

  console.log(`[backfill] Push subscriptions: ${migrated} migrated, ${skipped} skipped`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[backfill] Starting PII back-fill…')
  await backfillMembers()
  await backfillPushSubscriptions()
  console.log('[backfill] Done. Verify secure table row counts before running DROP COLUMN statements.')
}

main().catch(err => {
  console.error('[backfill] Fatal error:', err)
  process.exit(1)
})
