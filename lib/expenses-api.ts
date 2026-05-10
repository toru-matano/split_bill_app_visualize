/**
 * lib/expenses-api.ts
 *
 * Client-side helpers that call the server-side GET /api/expenses endpoint.
 * All decryption happens server-side; these functions return plain objects
 * identical in shape to what the old direct Supabase calls returned.
 *
 * Import these instead of calling supabase.from('expenses') directly.
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
 * Fetch a single decrypted expense by ID (used by the edit form pre-fill).
 * Replaces: supabase.from('expenses').select('*').eq('id', expenseId).single()
 */
export async function fetchExpense(expenseId: string): Promise<DecryptedExpense | null> {
  const res = await fetch(`/api/expenses?expenseId=${encodeURIComponent(expenseId)}`)
  if (!res.ok) {
    console.error('[fetchExpense] failed', res.status)
    return null
  }
  return res.json()
}
