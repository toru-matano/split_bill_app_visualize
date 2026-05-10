/**
 * lib/expenses-api.ts
 *
 * Client-side helpers that call server-side API routes.
 * All decryption happens server-side — these return plain objects.
 */

export type DecryptedExpense = {
  id                : string
  group_id          : string
  paid_by           : string
  category          : string
  created_at        : string
  label             : string
  amount            : number
  expense_date      : string | null
  original_amount   : number | null
  original_currency : string | null
  exchange_rate     : number | null
}

export type PayerRow = { expense_id: string; member_id: string; amount: number }
export type SplitRow = { expense_id: string; member_id: string; amount: number }

export type GroupSplitsResult = {
  payers : PayerRow[]
  splits : SplitRow[]
}

/**
 * Fetch all decrypted expenses for a group.
 * Replaces: supabase.from('expenses').select('*').eq('group_id', id)
 */
export async function fetchGroupExpenses(groupId: string): Promise<DecryptedExpense[]> {
  const res = await fetch(`/api/expenses?groupId=${encodeURIComponent(groupId)}`)
  if (!res.ok) {
    console.error('[fetchGroupExpenses] failed', res.status)
    return []
  }
  return res.json()
}

/**
 * Fetch a single decrypted expense by ID (edit form pre-fill).
 * Replaces: supabase.from('expenses').select('*').eq('id', expenseId).single()
 */
export async function fetchExpense(expenseId: string): Promise<DecryptedExpense | null> {
  const res = await fetch(`/api/expenses?expenseId=${encodeURIComponent(expenseId)}`)
  if (!res.ok) { console.error('[fetchExpense] failed', res.status); return null }
  return res.json()
}

/**
 * Fetch decrypted payer rows and split rows for all expenses in a group.
 * Replaces:
 *   supabase.from('expense_payers').select('member_id, amount').in('expense_id', ids)
 *   supabase.from('expense_splits').select('member_id, amount').in('expense_id', ids)
 *
 * Returns { payers, splits } — same shape expected by computeBalances().
 */
export async function fetchGroupSplits(groupId: string): Promise<GroupSplitsResult> {
  const res = await fetch(`/api/expenses/splits?groupId=${encodeURIComponent(groupId)}`)
  if (!res.ok) { console.error('[fetchGroupSplits] failed', res.status); return { payers: [], splits: [] } }
  return res.json()
}
