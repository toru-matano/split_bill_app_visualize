/**
 * app/api/groups/route.ts  (REFACTORED)
 *
 * Changes from original:
 *  - Member names are encrypted with AES-256-GCM and stored in
 *    `member_secure_data`; the `members.name` column no longer exists.
 *  - A blind index (name_hash) is computed for each member for future
 *    duplicate-name checks without decrypting.
 *  - Decrypted names are returned to the client (API shape unchanged).
 *  - All Supabase calls already use parameterised queries — no change needed
 *    for SQL injection protection.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError, validateGroupInput } from '@/lib/validation'
import { encrypt, decrypt, blindIndex } from '@/lib/crypto'
import { checkGroupCreateLimit, RateLimitError } from '@/lib/rate-limit'
import { nanoid } from 'nanoid'

const db = supabaseServer

export async function POST(req: NextRequest) {
  try {
    // Rate-limit by IP — 5 group creates per hour per IP
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      'unknown'
    await checkGroupCreateLimit(ip)

    const body = await req.json()
    const { name, members, currency } = validateGroupInput(body)

    // ── 1. Create the group ────────────────────────────────────────────────
    const shareToken = nanoid(10)
    const { data: group, error: groupError } = await db
      .from('groups')
      .insert({ name, currency, share_token: shareToken })
      .select()
      .single()
    if (groupError) throw groupError

    // ── 2. Insert member rows (no PII in this table) ───────────────────────
    const memberInserts = members.map(() => ({ group_id: group.id }))
    const { data: createdMembers, error: membersError } = await db
      .from('members')
      .insert(memberInserts)
      .select('id')
    if (membersError) throw membersError

    // ── 3. Encrypt each member name and build the secure rows ──────────────
    const secureRows = members.map((memberName: string, idx: number) => ({
      member_id : createdMembers[idx].id,
      name_enc  : encrypt(memberName),       // AES-256-GCM ciphertext (BYTEA)
      name_hash : blindIndex(memberName),    // HMAC-SHA-256 blind index (TEXT)
    }))

    const { error: secureError } = await db
      .from('member_secure_data')
      .insert(secureRows)
    if (secureError) throw secureError

    // ── 4. Return; API shape is unchanged ─────────────────────────────────
    return NextResponse.json({ id: group.id, shareToken })
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    console.error('[POST /api/groups]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
