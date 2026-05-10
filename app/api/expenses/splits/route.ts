import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { decrypt } from '@/lib/crypto'

const db = supabaseServer

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    if (!groupId) {
      return NextResponse.json({ error: 'groupId required' }, { status: 400 })
    }

    // ── 1. Resolve all expense IDs for this group ─────────────────────────
    const { data: expenseRows, error: expErr } = await db
      .from('expenses')
      .select('id')
      .eq('group_id', groupId)
    if (expErr) throw expErr
    if (!expenseRows?.length) {
      return NextResponse.json({ payers: [], splits: [] })
    }
    const expenseIds = expenseRows.map(e => e.id)

    // ── 2. Fetch encrypted payer rows ─────────────────────────────────────
    const { data: payerSecure, error: payerErr } = await db
      .from('expense_payer_secure_data')
      .select('expense_id, member_id, amount')
      .in('expense_id', expenseIds)
    if (payerErr) throw payerErr

    // ── 3. Fetch encrypted split rows ─────────────────────────────────────
    const { data: splitSecure, error: splitErr } = await db
      .from('expense_split_secure_data')
      .select('expense_id, member_id, amount')
      .in('expense_id', expenseIds)
    if (splitErr) throw splitErr

    // ── 4. Decrypt amounts ─────────────────────────────────────────────────
    const payers = (payerSecure ?? []).map(row => ({
      expense_id : row.expense_id,
      member_id  : row.member_id,
      amount     : parseFloat(decrypt(row.amount)),
    }))

    const splits = (splitSecure ?? []).map(row => ({
      expense_id : row.expense_id,
      member_id  : row.member_id,
      amount     : parseFloat(decrypt(row.amount)),
    }))

    return NextResponse.json({ payers, splits })
  } catch (err) {
    console.error('[GET /api/expenses/splits]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
