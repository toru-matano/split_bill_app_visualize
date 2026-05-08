import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError } from '@/lib/validation'

const db = supabaseServer

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const body = await req.json()
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : ''
    if (!name) throw new ValidationError('Name required')

    const { data: group } = await db.from('groups').select('id').eq('share_token', token).single()
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const { data: existing } = await db.from('members').select('id')
      .eq('group_id', group.id).ilike('name', name)
    if (existing && existing.length > 0) return NextResponse.json({ error: 'Duplicate name' }, { status: 409 })

    const { data: member, error } = await db.from('members')
      .insert({ group_id: group.id, name }).select().single()
    if (error) throw error

    return NextResponse.json({ id: member.id, name: member.name })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[POST /api/groups/members]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
