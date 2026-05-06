import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// PATCH /api/groups/[token] — update group name/currency
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { name, currency } = await req.json()
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

    const { error } = await supabase.from('groups')
      .update({ name, ...(currency ? { currency } : {}) })
      .eq('share_token', token)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

// DELETE /api/groups/[token] — delete group and all related data (cascade)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { error } = await supabase.from('groups').delete().eq('share_token', token)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
