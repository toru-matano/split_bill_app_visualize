import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { groupId, paidBy, amount, label, splitAmong } = await req.json()

    if (!groupId || !paidBy || !amount || !splitAmong?.length) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const sharePerPerson = Number(amount) / splitAmong.length

    const { data: expense, error: expError } = await supabase
      .from('expenses')
      .insert({ group_id: groupId, paid_by: paidBy, amount: Number(amount), label })
      .select()
      .single()

    if (expError) throw expError

    const { error: splitError } = await supabase
      .from('expense_splits')
      .insert(
        splitAmong.map((memberId: string) => ({
          expense_id: expense.id,
          member_id: memberId,
          amount: sharePerPerson,
        }))
      )

    if (splitError) throw splitError

    return NextResponse.json({ id: expense.id })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Step 3: Edit expense — replace splits atomically
export async function PUT(req: NextRequest) {
  try {
    const { expenseId, paidBy, amount, label, splitAmong } = await req.json()

    if (!expenseId || !paidBy || !amount || !splitAmong?.length) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const sharePerPerson = Number(amount) / splitAmong.length

    // Update expense row
    const { error: expError } = await supabase
      .from('expenses')
      .update({ paid_by: paidBy, amount: Number(amount), label })
      .eq('id', expenseId)

    if (expError) throw expError

    // Delete old splits, insert new ones
    const { error: delError } = await supabase
      .from('expense_splits')
      .delete()
      .eq('expense_id', expenseId)

    if (delError) throw delError

    const { error: splitError } = await supabase
      .from('expense_splits')
      .insert(
        splitAmong.map((memberId: string) => ({
          expense_id: expenseId,
          member_id: memberId,
          amount: sharePerPerson,
        }))
      )

    if (splitError) throw splitError

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { expenseId } = await req.json()
    const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
