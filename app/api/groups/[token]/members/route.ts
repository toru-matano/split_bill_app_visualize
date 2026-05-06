import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/groups/[token]/members — add a member to existing group
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { name } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

    // Resolve group id from token
    const { data: group, error: grpErr } = await supabase.from('groups').select('id').eq('share_token', token).single()
    if (grpErr || !group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    // Check for duplicate
    const { data: existing } = await supabase.from('members').select('id').eq('group_id', group.id).ilike('name', name.trim())
    if (existing && existing.length > 0) return NextResponse.json({ error: 'Duplicate name' }, { status: 409 })

    const { data: member, error } = await supabase.from('members')
      .insert({ group_id: group.id, name: name.trim() }).select().single()
    if (error) throw error
    return NextResponse.json({ id: member.id, name: member.name })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
