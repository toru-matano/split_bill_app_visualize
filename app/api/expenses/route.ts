import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { groupId, paidBy, amount, label, splitAmong, splitAmounts, category, originalCurrency, originalAmount, exchangeRate } = await req.json()
    if (!groupId || !paidBy || !amount || !splitAmong?.length) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

    const { data: expense, error: expError } = await supabase
      .from('expenses')
      .insert({ group_id: groupId, paid_by: paidBy, amount: Number(amount), label, category: category ?? 'other', original_currency: originalCurrency ?? null, original_amount: originalAmount ?? null, exchange_rate: exchangeRate ?? null })
      .select().single()
    if (expError) throw expError

    // If custom splitAmounts provided, use them; otherwise equal split
    const splits = splitAmong.map((memberId: string, i: number) => ({
      expense_id: expense.id,
      member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : Number(amount) / splitAmong.length,
    }))

    const { error: splitError } = await supabase.from('expense_splits').insert(splits)
    if (splitError) throw splitError
    return NextResponse.json({ id: expense.id })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function PUT(req: NextRequest) {
  try {
    const { expenseId, paidBy, amount, label, splitAmong, splitAmounts, category, originalCurrency, originalAmount, exchangeRate } = await req.json()
    if (!expenseId || !paidBy || !amount || !splitAmong?.length) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

    const { error: expError } = await supabase.from('expenses').update({ paid_by: paidBy, amount: Number(amount), label, category: category ?? 'other', original_currency: originalCurrency ?? null, original_amount: originalAmount ?? null, exchange_rate: exchangeRate ?? null }).eq('id', expenseId)
    if (expError) throw expError

    await supabase.from('expense_splits').delete().eq('expense_id', expenseId)

    const splits = splitAmong.map((memberId: string, i: number) => ({
      expense_id: expenseId,
      member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : Number(amount) / splitAmong.length,
    }))
    const { error: splitError } = await supabase.from('expense_splits').insert(splits)
    if (splitError) throw splitError
    return NextResponse.json({ ok: true })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const { expenseId } = await req.json()
    const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) { console.error(err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
