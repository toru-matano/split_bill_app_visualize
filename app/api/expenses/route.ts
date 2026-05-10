import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError, validateExpenseInput } from '@/lib/validation'
import { encrypt, decrypt, decryptIfPresent } from '@/lib/crypto'

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

/** Decrypt a single expense_secure_data row and merge with a base expense row. */
function mergeDecrypted(
  base: { id: string; group_id: string; paid_by: string; category: string; created_at: string },
  secure: {
    label: unknown
    amount: unknown
    original_amount: unknown
    original_currency: unknown
    exchange_rate: unknown
    expense_date: unknown
  } | null,
) {
  if (!secure) {
    // Secure row missing — return base with empty fields rather than crashing
    return { ...base, label: '', amount: 0, expense_date: null,
      original_amount: null, original_currency: null, exchange_rate: null }
  }
  return {
    ...base,
    label             : decryptIfPresent(secure.label as string) ?? '',
    amount            : parseFloat(decrypt(secure.amount as string)),
    expense_date      : decryptIfPresent(secure.expense_date as string),
    original_amount   : decryptIfPresent(secure.original_amount as string)
                          ? parseFloat(decrypt(secure.original_amount as string))
                          : null,
    original_currency : decryptIfPresent(secure.original_currency as string),
    exchange_rate     : decryptIfPresent(secure.exchange_rate as string)
                          ? parseFloat(decrypt(secure.exchange_rate as string))
                          : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — fetch and decrypt expenses
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId   = searchParams.get('groupId')
    const expenseId = searchParams.get('expenseId')

    if (!groupId && !expenseId) {
      return NextResponse.json({ error: 'groupId or expenseId required' }, { status: 400 })
    }

    if (expenseId) {
      // ── Single expense (edit pre-fill) ─────────────────────────────────
      const { data: base, error: baseErr } = await db
        .from('expenses')
        .select('id, group_id, paid_by, category, created_at')
        .eq('id', expenseId)
        .single()
      if (baseErr || !base) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const { data: secure } = await db
        .from('expense_secure_data')
        .select('label, amount, original_amount, original_currency, exchange_rate, expense_date')
        .eq('expense_id', expenseId)
        .single()

      return NextResponse.json(mergeDecrypted(base, secure))
    }

    // ── All expenses for a group (group page, summary, member detail) ─────
    const { data: baseRows, error: baseErr } = await db
      .from('expenses')
      .select('id, group_id, paid_by, category, created_at')
      .eq('group_id', groupId!)
      .order('created_at', { ascending: false })
    if (baseErr) throw baseErr
    if (!baseRows?.length) return NextResponse.json([])

    const expenseIds = baseRows.map(e => e.id)
    const { data: secureRows, error: secureErr } = await db
      .from('expense_secure_data')
      .select('expense_id, label, amount, original_amount, original_currency, exchange_rate, expense_date')
      .in('expense_id', expenseIds)
    if (secureErr) throw secureErr

    const secureMap = new Map((secureRows ?? []).map(r => [r.expense_id, r]))

    const result = baseRows.map(base => mergeDecrypted(base, secureMap.get(base.id) ?? null))
    return NextResponse.json(result)

  } catch (err) {
    console.error('[GET /api/expenses]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — create expense with encrypted fields
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      label, category, payers, splitAmong, splitAmounts,
      totalAmount, originalCurrency, originalAmount, exchangeRate, expenseDate,
     } = validateExpenseInput(body)

    const groupId: string = typeof body.groupId === 'string' ? body.groupId : ''
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 })

    // Verify group exists
    const { data: grp } = await db.from('groups').select('id').eq('id', groupId).single()
    if (!grp) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const primaryPayer = (payers[0] as { memberId: string }).memberId

    const { data: expense, error: expError } = await db
      .from('expenses')
      .insert({ group_id: groupId, paid_by: primaryPayer, category })
      .select('id')
      .single()
    if (expError) throw expError

    // Insert encrypted fields into secure table
    const { error: secureError } = await db
      .from('expense_secure_data')
      .insert({
        expense_id            : expense.id,
        label             : label ? encrypt(label) : null,
        amount            : encrypt(String(totalAmount)),
        expense_date      : expenseDate ? encrypt(expenseDate) : null,
        original_amount   : originalAmount != null ? encrypt(String(originalAmount)) : null,
        original_currency : originalCurrency ? encrypt(originalCurrency) : null,
        exchange_rate     : exchangeRate != null ? encrypt(String(exchangeRate)) : null,
      })
    if (secureError) throw secureError

    // Insert payers and splits (amounts are operational data, not PII)
    const { error: payerError } = await db
      .from('expense_payers')
      .insert(
        (payers as { memberId: string; amount: number }[]).map(p => ({
          expense_id: expense.id,
          member_id: p.memberId,
          amount: p.amount,
        }))
    )
    if (payerError) throw payerError

    const splits = (splitAmong as string[]).map((memberId, i) => ({
      expense_id: expense.id,
      member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : totalAmount / splitAmong.length,
    }))
    const { error: splitError } = await db.from('expense_splits').insert(splits)
    if (splitError) throw splitError

    return NextResponse.json({ id: expense.id })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
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
    const guard = await resolveAndGuard(expenseId, groupToken)
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const {
      label, category, payers, splitAmong, splitAmounts,
      totalAmount, originalCurrency, originalAmount, exchangeRate, expenseDate,
    } = validateExpenseInput(body)

    const primaryPayer = (payers[0] as { memberId: string }).memberId

    const { error: expError } = await db
      .from('expenses')
      .update({ paid_by: primaryPayer, category })
      .eq('id', expenseId)
    if (expError) throw expError

    // Upsert encrypted fields
    const { error: secureError } = await db
      .from('expense_secure_data')
      .upsert({
        expense_id            : expenseId,
        label             : label ? encrypt(label) : null,
        amount            : encrypt(String(totalAmount)),
        expense_date      : expenseDate ? encrypt(expenseDate) : null,
        original_amount   : originalAmount != null ? encrypt(String(originalAmount)) : null,
        original_currency : originalCurrency ? encrypt(originalCurrency) : null,
        exchange_rate     : exchangeRate != null ? encrypt(String(exchangeRate)) : null,
      })
    if (secureError) throw secureError

    // Replace payers and splits
    await Promise.all([
      db.from('expense_payers').delete().eq('expense_id', expenseId),
      db.from('expense_splits').delete().eq('expense_id', expenseId),
    ])

    const { error: payerError } = await db.from('expense_payers').insert(
      (payers as { memberId: string; amount: number }[]).map(p => ({
        expense_id: expenseId, member_id: p.memberId, amount: p.amount,
      }))
    )
    if (payerError) throw payerError

    const splits = (splitAmong as string[]).map((memberId, i) => ({
      expense_id: expenseId,
      member_id: memberId,
      amount: splitAmounts ? Number(splitAmounts[i]) : totalAmount / splitAmong.length,
    }))
    const { error: splitError } = await db.from('expense_splits').insert(splits)
    if (splitError) throw splitError

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[PUT /api/expenses]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/expenses?id=<expenseId>&token=<groupToken>
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const expenseId  = searchParams.get('id') ?? ''
    const groupToken = searchParams.get('token') ?? undefined
    if (!expenseId) return NextResponse.json({ error: 'id required' }, { status: 400 })

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
    console.error('[DELETE /api/expenses]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
