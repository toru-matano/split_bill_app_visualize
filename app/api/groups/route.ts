import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError, validateGroupInput } from '@/lib/validation'
import { nanoid } from 'nanoid'

const db = supabaseServer

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, members, currency } = validateGroupInput(body)

    const shareToken = nanoid(10)
    const { data: group, error: groupError } = await db
      .from('groups').insert({ name, currency, share_token: shareToken }).select().single()
    if (groupError) throw groupError

    const { error: membersError } = await db.from('members')
      .insert(members.map((m: string) => ({ group_id: group.id, name: m })))
    if (membersError) throw membersError

    return NextResponse.json({ id: group.id, shareToken })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[POST /api/groups]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
