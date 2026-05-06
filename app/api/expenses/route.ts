import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// payers: [{ memberId, amount }] — at least one required
// splitAmong: memberId[] — who owes (with optional splitAmounts per member)

export async function POST(req: NextRequest) {
  try {
    const { groupId, payers, splitAmong, splitAmounts, label, category, originalCurrency, originalAmount, exchangeRate, expenseDate } = await req.json()
    if (!groupId || !payers?.length || !splitAmong?.length) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

    const totalAmount = payers.reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0)
    const primaryPayer = payers[0].memberId  // kept for display fallback

    const { data: expense, error: expError } = await supabase
      .from('expenses')
      .insert({ group_id: groupId, paid_by: primaryPayer, amount: totalAmount, label, category: category ?? 'other', original_currency: originalCurrency ?? null, original_amount: originalAmount ?? null, exchange_rate: exchangeRate ?? null, expense_date: expenseDate ?? null })
      .select().single()
    if (expError) throw expError

    // Insert payers
    const { error: payerError } = await supabase.from('expense_payers').insert(
      payers.map((p: { memberId: string; amount: number }) => ({ expense_id: expense.id, member_id: p.memberId, amount: Number(p.amount) }))
    )
    if (payerError) throw payerError

    // Insert splits
    const splits = splitAmong.map((memberId: string, i: number) => ({
      expense_id: expense.id, member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : totalAmount / splitAmong.length,
    }))
    const { error: splitError } = await supabase.from('expense_splits').insert(splits)
    if (splitError) throw splitError

    return NextResponse.json({ id: expense.id })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function PUT(req: NextRequest) {
  try {
    const { expenseId, payers, splitAmong, splitAmounts, label, category, originalCurrency, originalAmount, exchangeRate, expenseDate } = await req.json()
    if (!expenseId || !payers?.length || !splitAmong?.length) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

    const totalAmount = payers.reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0)
    const primaryPayer = payers[0].memberId

    const { error: expError } = await supabase.from('expenses')
      .update({ paid_by: primaryPayer, amount: totalAmount, label, category: category ?? 'other', original_currency: originalCurrency ?? null, original_amount: originalAmount ?? null, exchange_rate: exchangeRate ?? null, expense_date: expenseDate ?? null })
      .eq('id', expenseId)
    if (expError) throw expError

    await supabase.from('expense_payers').delete().eq('expense_id', expenseId)
    await supabase.from('expense_splits').delete().eq('expense_id', expenseId)

    const { error: payerError } = await supabase.from('expense_payers').insert(
      payers.map((p: { memberId: string; amount: number }) => ({ expense_id: expenseId, member_id: p.memberId, amount: Number(p.amount) }))
    )
    if (payerError) throw payerError

    const splits = splitAmong.map((memberId: string, i: number) => ({
      expense_id: expenseId, member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : totalAmount / splitAmong.length,
    }))
    const { error: splitError } = await supabase.from('expense_splits').insert(splits)
    if (splitError) throw splitError

    return NextResponse.json({ ok: true })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const { expenseId } = await req.json()
    // Delete related payers and splits first
    await supabase.from('expense_payers').delete().eq('expense_id', expenseId)
    await supabase.from('expense_splits').delete().eq('expense_id', expenseId)
    // Then delete the expense
    const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
