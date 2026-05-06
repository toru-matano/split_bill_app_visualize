import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// PATCH /api/groups/[token] — update group name/currency
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { name, currency, notifications_enabled } = await req.json()
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

    const { error } = await supabase.from('groups')
      .update({ name, ...(currency ? { currency } : {}), ...(notifications_enabled !== undefined ? { notifications_enabled } : {}) })
      .eq('share_token', token)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

// DELETE /api/groups/[token] — delete group and all related data
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { data: grp, error: grpError } = await supabase.from('groups').select('id').eq('share_token', token).single()
    if (grpError || !grp) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    const groupId = grp.id
    const { data: expenses, error: expSelectError } = await supabase.from('expenses').select('id').eq('group_id', groupId)
    if (expSelectError) throw expSelectError
    const expenseIds = (expenses ?? []).map(exp => exp.id)

    if (expenseIds.length > 0) {
      const { error: payerError } = await supabase.from('expense_payers').delete().in('expense_id', expenseIds)
      if (payerError) throw payerError
      const { error: splitError } = await supabase.from('expense_splits').delete().in('expense_id', expenseIds)
      if (splitError) throw splitError
      const { error: expenseDeleteError } = await supabase.from('expenses').delete().eq('group_id', groupId)
      if (expenseDeleteError) throw expenseDeleteError
    }

    const { error: memberError } = await supabase.from('members').delete().eq('group_id', groupId)
    if (memberError) throw memberError

    const { error: groupError } = await supabase.from('groups').delete().eq('id', groupId)
    if (groupError) throw groupError

    console.info(`Deleted group ${groupId} and all related members${expenseIds.length > 0 ? `, expenses, payers, and splits (${expenseIds.length} expenses)` : ''}.`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Group delete failed:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
