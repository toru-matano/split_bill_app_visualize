/**
 * app/api/groups/[token]/members/route.ts  (REFACTORED — full file)
 *
 * GET  /api/groups/[token]/members
 *   Returns the full member list with decrypted names.
 *   All decryption happens server-side; the browser never sees ciphertext.
 *
 * POST /api/groups/[token]/members
 *   Creates a new member, encrypts the name, writes to member_secure_data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError } from '@/lib/validation'
import { encrypt, decrypt, blindIndex } from '@/lib/crypto'

const db = supabaseServer

// ── GET — fetch all members for a group with decrypted names ─────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    const { data: group } = await db
      .from('groups').select('id').eq('share_token', token).single()
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const { data: members, error: memberError } = await db
      .from('members')
      .select('id, group_id, created_at')
      .eq('group_id', group.id)
      .order('created_at', { ascending: true })
    if (memberError) throw memberError
    if (!members?.length) return NextResponse.json([])

    // Fetch all encrypted names in one round-trip
    const memberIds = members.map(m => m.id)
    const { data: secureRows, error: secureError } = await db
      .from('member_secure_data')
      .select('member_id, name_enc')
      .in('member_id', memberIds)
    if (secureError) throw secureError

    // Decrypt and map member_id -> name
    const nameMap = new Map<string, string>()
    for (const row of secureRows ?? []) {
      // Let decrypt() throw — errors surface to the outer catch and log properly
      nameMap.set(row.member_id, decrypt(row.name_enc))
    }

    const result = members.map(m => ({
      id         : m.id,
      group_id   : m.group_id,
      created_at : m.created_at,
      name       : nameMap.get(m.id) ?? '[missing]',
    }))

    return NextResponse.json(result)
  } catch (err) {
    console.error('[GET /api/groups/[token]/members]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── POST — create a member with encrypted name ────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const body      = await req.json()

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : ''
    if (!name) throw new ValidationError('Name required')

    const { data: group } = await db
      .from('groups').select('id').eq('share_token', token).single()
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    // Duplicate check via blind index (no plaintext in DB)
    const nameHash = blindIndex(name)
    const { data: groupMemberIds } = await db
      .from('members').select('id').eq('group_id', group.id)
    const memberIdList = (groupMemberIds ?? []).map(m => m.id)

    if (memberIdList.length > 0) {
      const { data: collision } = await db
        .from('member_secure_data')
        .select('member_id')
        .eq('name_hash', nameHash)
        .in('member_id', memberIdList)
      if (collision && collision.length > 0) {
        return NextResponse.json({ error: 'Duplicate name' }, { status: 409 })
      }
    }

    const { data: member, error: memberError } = await db
      .from('members').insert({ group_id: group.id }).select('id, created_at').single()
    if (memberError) throw memberError

    const { error: secureError } = await db
      .from('member_secure_data')
      .insert({ member_id: member.id, name_enc: encrypt(name), name_hash: nameHash })
    if (secureError) throw secureError

    return NextResponse.json({ id: member.id, name })
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[POST /api/groups/[token]/members]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
