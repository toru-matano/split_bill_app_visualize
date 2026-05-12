import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError } from '@/lib/validation'
import { checkMutationLimit, RateLimitError } from '@/lib/rate-limit'

const db = supabaseServer

function validateTransferInput(body: Record<string, unknown>) {
  const groupToken = typeof body.groupToken === 'string' ? body.groupToken : ''
  if (!groupToken) throw new ValidationError('groupToken required')

  const fromMemberId = typeof body.fromMemberId === 'string' ? body.fromMemberId : ''
  const toMemberId   = typeof body.toMemberId   === 'string' ? body.toMemberId   : ''
  if (!fromMemberId || !toMemberId) throw new ValidationError('fromMemberId and toMemberId required')
  if (fromMemberId === toMemberId)   throw new ValidationError('Sender and receiver must be different')

  const amount = Number(body.amount)
  if (!isFinite(amount) || amount <= 0) throw new ValidationError('amount must be a positive number')

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null
  const transferDate = typeof body.transferDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.transferDate)
    ? body.transferDate
    : new Date().toISOString().split('T')[0]

  return { groupToken, fromMemberId, toMemberId, amount, note, transferDate }
}

async function resolveGroupId(token: string): Promise<string | null> {
  const { data } = await db.from('groups').select('id').eq('share_token', token).single()
  return data?.id ?? null
}

async function verifyMembersInGroup(groupId: string, ...memberIds: string[]): Promise<boolean> {
  const { data } = await db.from('members').select('id').eq('group_id', groupId).in('id', memberIds)
  return (data ?? []).length === memberIds.length
}

// POST /api/transfers — record a new real-money transfer
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { groupToken, fromMemberId, toMemberId, amount, note, transferDate } = validateTransferInput(body)

    await checkMutationLimit(groupToken)

    const groupId = await resolveGroupId(groupToken)
    if (!groupId) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const valid = await verifyMembersInGroup(groupId, fromMemberId, toMemberId)
    if (!valid) return NextResponse.json({ error: 'Members not in group' }, { status: 403 })

    const { data, error } = await db
      .from('transfer_records')
      .insert({ group_id: groupId, from_member_id: fromMemberId, to_member_id: toMemberId, amount, note, transfer_date: transferDate })
      .select().single()
    if (error) throw error

    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof RateLimitError)  return NextResponse.json({ error: err.message }, { status: 429 })
    console.error('[POST /api/transfers]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PUT /api/transfers — edit a transfer record
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const transferId = typeof body.transferId === 'string' ? body.transferId : ''
    if (!transferId) return NextResponse.json({ error: 'transferId required' }, { status: 400 })

    const { groupToken, fromMemberId, toMemberId, amount, note, transferDate } = validateTransferInput(body)

    await checkMutationLimit(groupToken)

    const groupId = await resolveGroupId(groupToken)
    if (!groupId) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    // Ownership guard: verify the transfer belongs to this group
    const { data: existing } = await db
      .from('transfer_records').select('group_id').eq('id', transferId).single()
    if (!existing || existing.group_id !== groupId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const valid = await verifyMembersInGroup(groupId, fromMemberId, toMemberId)
    if (!valid) return NextResponse.json({ error: 'Members not in group' }, { status: 403 })

    const { data, error } = await db
      .from('transfer_records')
      .update({ from_member_id: fromMemberId, to_member_id: toMemberId, amount, note, transfer_date: transferDate })
      .eq('id', transferId).select().single()
    if (error) throw error

    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof RateLimitError)  return NextResponse.json({ error: err.message }, { status: 429 })
    console.error('[PUT /api/transfers]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/transfers?id=<transferId>&token=<groupToken>
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const transferId  = searchParams.get('id')    ?? ''
    const groupToken  = searchParams.get('token') ?? ''
    if (!transferId || !groupToken) return NextResponse.json({ error: 'id and token required' }, { status: 400 })

    await checkMutationLimit(groupToken)

    const groupId = await resolveGroupId(groupToken)
    if (!groupId) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const { data: existing } = await db
      .from('transfer_records').select('group_id').eq('id', transferId).single()
    if (!existing || existing.group_id !== groupId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { error } = await db.from('transfer_records').delete().eq('id', transferId)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ error: err.message }, { status: 429 })
    console.error('[DELETE /api/transfers]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
