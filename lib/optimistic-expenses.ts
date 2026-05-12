/**
 * lib/optimistic-expenses.ts
 *
 * A module-level singleton that carries one pending expense across a
 * client-side navigation (form → group page).  No React context, no
 * localStorage — just an in-memory Map that survives the router.push().
 *
 * The expense ID is generated client-side with crypto.randomUUID() and
 * sent in the POST body.  Postgres accepts it as-is (DEFAULT gen_random_uuid()
 * is only applied when no id is provided), so the optimistic row and the real
 * DB row share the same UUID.  When the realtime INSERT fires, React's key
 * reconciliation sees the same id → in-place update, zero flash.
 */

import type { Expense } from '@/lib/supabase'

export type OptimisticExpense = Expense & {
  /** 'pending'  — POST in-flight, not yet confirmed by DB             */
  /** 'confirmed'— realtime INSERT received, swap to real row complete */
  /** 'error'    — POST failed, row should be removed + form restored  */
  _optimisticStatus: 'pending' | 'confirmed' | 'error'
}

// Keyed by groupId so concurrent tabs don't stomp each other.
const _pending = new Map<string, OptimisticExpense>()

export function setPendingExpense(groupId: string, exp: OptimisticExpense): void {
  _pending.set(groupId, exp)
}

/**
 * Read and remove the pending expense for a group.
 * Returns null if nothing is waiting (normal page loads).
 */
export function consumePendingExpense(groupId: string): OptimisticExpense | null {
  const exp = _pending.get(groupId) ?? null
  _pending.delete(groupId)
  return exp
}

/**
 * Mark a previously-injected optimistic row as failed so the group page
 * can remove it.  Called from the fire-and-forget POST error handler.
 */
export function failPendingExpense(groupId: string, id: string): void {
  // The group page polls this on the next render cycle via a shared ref.
  // We re-use the same map with status = 'error' so the page can filter it out.
  _pending.set(groupId, {
    ...(_pending.get(groupId) ?? ({} as OptimisticExpense)),
    id,
    _optimisticStatus: 'error',
  })
}
