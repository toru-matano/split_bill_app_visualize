import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError, validateExpenseInput } from '@/lib/validation'
import { checkMutationLimit, RateLimitError } from '@/lib/rate-limit'

const db = supabaseServer

// ── Helper: verify expense belongs to a group resolved from token ──────────
async function resolveAndGuard(expenseId: string, groupToken?: string) {
  const { data: exp, error } = await db
    .from('expenses').select('id, group_id').eq('id', expenseId).single()
  if (error || !exp) return { error: 'Expense not found', status: 404, groupId: null }

  if (groupToken) {
    const { data: grp } = await db
      .from('groups').select('id').eq('share_token', groupToken).single()
    if (!grp || grp.id !== exp.group_id) return { error: 'Forbidden', status: 403, groupId: null }
  }
  return { error: null, status: 200, groupId: exp.group_id }
}

// POST /api/expenses — create a new expense
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { label, category, payers, splitAmong, splitAmounts, totalAmount, originalCurrency, originalAmount, exchangeRate, expenseDate } = validateExpenseInput(body)

    const groupId: string = typeof body.groupId === 'string' ? body.groupId : ''
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 })

    const groupToken = typeof body.groupToken === 'string' ? body.groupToken : groupId
    checkMutationLimit(groupToken)

    // Verify group exists
    const { data: grp } = await db.from('groups').select('id').eq('id', groupId).single()
    if (!grp) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const primaryPayer = (payers[0] as { memberId: string }).memberId

    const { data: expense, error: expError } = await db
      .from('expenses')
      .insert({ group_id: groupId, paid_by: primaryPayer, amount: totalAmount, label, category, original_currency: originalCurrency, original_amount: originalAmount, exchange_rate: exchangeRate, expense_date: expenseDate })
      .select().single()
    if (expError) throw expError

    const { error: payerError } = await db.from('expense_payers').insert(
      (payers as { memberId: string; amount: number }[]).map(p => ({ expense_id: expense.id, member_id: p.memberId, amount: p.amount }))
    )
    if (payerError) throw payerError

    const splits = (splitAmong as string[]).map((memberId, i) => ({
      expense_id: expense.id, member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : totalAmount / splitAmong.length,
    }))
    const { error: splitError } = await db.from('expense_splits').insert(splits)
    if (splitError) throw splitError

    return NextResponse.json({ id: expense.id })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof RateLimitError)  return NextResponse.json({ error: err.message }, { status: 429 })
    console.error('[POST /api/expenses]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PUT /api/expenses — update an existing expense
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const expenseId = typeof body.expenseId === 'string' ? body.expenseId : ''
    if (!expenseId) return NextResponse.json({ error: 'expenseId required' }, { status: 400 })

    const groupToken = typeof body.groupToken === 'string' ? body.groupToken : undefined
    if (groupToken) checkMutationLimit(groupToken)
    const guard = await resolveAndGuard(expenseId, groupToken)
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const { label, category, payers, splitAmong, splitAmounts, totalAmount, originalCurrency, originalAmount, exchangeRate, expenseDate } = validateExpenseInput(body)
    const primaryPayer = (payers[0] as { memberId: string }).memberId

    const { error: expError } = await db.from('expenses')
      .update({ paid_by: primaryPayer, amount: totalAmount, label, category, original_currency: originalCurrency, original_amount: originalAmount, exchange_rate: exchangeRate, expense_date: expenseDate })
      .eq('id', expenseId)
    if (expError) throw expError

    // Replace payers and splits atomically
    await Promise.all([
      db.from('expense_payers').delete().eq('expense_id', expenseId),
      db.from('expense_splits').delete().eq('expense_id', expenseId),
    ])

    const { error: payerError } = await db.from('expense_payers').insert(
      (payers as { memberId: string; amount: number }[]).map(p => ({ expense_id: expenseId, member_id: p.memberId, amount: p.amount }))
    )
    if (payerError) throw payerError

    const splits = (splitAmong as string[]).map((memberId, i) => ({
      expense_id: expenseId, member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : totalAmount / splitAmong.length,
    }))
    const { error: splitError } = await db.from('expense_splits').insert(splits)
    if (splitError) throw splitError

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof RateLimitError)  return NextResponse.json({ error: err.message }, { status: 429 })
    console.error('[PUT /api/expenses]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/expenses?id=<expenseId>&token=<groupToken>
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const expenseId = searchParams.get('id') ?? ''
    const groupToken = searchParams.get('token') ?? undefined
    if (!expenseId) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (groupToken) checkMutationLimit(groupToken)

    const guard = await resolveAndGuard(expenseId, groupToken)
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status })

    // Cascade delete in parallel, then remove the expense
    await Promise.all([
      db.from('expense_payers').delete().eq('expense_id', expenseId),
      db.from('expense_splits').delete().eq('expense_id', expenseId),
    ])
    const { error } = await db.from('expenses').delete().eq('id', expenseId)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ error: err.message }, { status: 429 })
    console.error('[DELETE /api/expenses]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
