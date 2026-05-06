import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { nanoid } from 'nanoid'

export async function POST(req: NextRequest) {
  try {
    const { name, members, currency } = await req.json()
    if (!name || !members || members.length < 2) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

    const shareToken = nanoid(10)
    const { data: group, error: groupError } = await supabase
      .from('groups').insert({ name, currency: currency ?? 'JPY', share_token: shareToken }).select().single()
    if (groupError) throw groupError

    const { error: membersError } = await supabase.from('members')
      .insert(members.map((m: string) => ({ group_id: group.id, name: m })))
    if (membersError) throw membersError

    return NextResponse.json({ id: group.id, shareToken })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
