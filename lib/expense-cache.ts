/**
 * Client-side expense cache — three responsibilities:
 *
 * 1. Draft cache   (sessionStorage, 30s TTL)
 *    Written by ExpenseForm immediately on save, before the network call.
 *    Group page reads and displays it instantly; cleared on Realtime confirm.
 *
 * 2. List cache    (sessionStorage, 5min TTL — stale-while-revalidate)
 *    Written after every fresh Supabase fetch on the group page.
 *    On next navigation, stale list renders immediately while fresh fetch runs.
 *
 * 3. Group prefetch cache  (module-level Map)
 *    primeGroupCache(token) fires the supabase fetch early (on hover).
 *    useGroup reads from the in-flight promise instead of starting a new one.
 */

import type { Expense } from './supabase'

// ─── Keys ────────────────────────────────────────────────────────────────────

const DRAFT_KEY   = 'splitmate_expense_draft'
const LIST_KEY    = (gid: string) => `splitmate_expenses_${gid}`
const DRAFT_TTL   = 30_000       // 30 seconds
const LIST_TTL    = 5 * 60_000   // 5 minutes

// ─── Types ───────────────────────────────────────────────────────────────────

export type DraftExpense = {
  id: string          // optimistic UUID (crypto.randomUUID())
  group_id: string
  label: string
  amount: number
  category: string
  paid_by: string
  expense_date: string | null
  created_at: string
  original_currency: string | null
  original_amount: number | null
  exchange_rate: number | null
  member?: { id: string; name: string }
}

// ─── Draft cache (optimistic add/edit) ───────────────────────────────────────

export function writeDraft(expense: DraftExpense): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ expense, savedAt: Date.now() }))
  } catch { /* quota */ }
}

export function readDraft(): DraftExpense | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const { expense, savedAt } = JSON.parse(raw)
    return Date.now() - savedAt < DRAFT_TTL ? (expense as DraftExpense) : null
  } catch { return null }
}

export function clearDraft(): void {
  if (typeof sessionStorage === 'undefined') return
  try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
}

// ─── Expense list cache (stale-while-revalidate) ─────────────────────────────

export function cacheExpenseList(groupId: string, list: Expense[]): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(LIST_KEY(groupId), JSON.stringify({ list, cachedAt: Date.now() }))
  } catch { /* quota */ }
}

export function readExpenseCache(groupId: string): Expense[] | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(LIST_KEY(groupId))
    if (!raw) return null
    const { list, cachedAt } = JSON.parse(raw)
    return Date.now() - cachedAt < LIST_TTL ? (list as Expense[]) : null
  } catch { return null }
}

export function invalidateExpenseCache(groupId: string): void {
  if (typeof sessionStorage === 'undefined') return
  try { sessionStorage.removeItem(LIST_KEY(groupId)) } catch { /* noop */ }
}

// ─── Group prefetch cache ─────────────────────────────────────────────────────
// Used by the home page (hover prefetch) and useGroup hook

type GroupData = { group: import('./supabase').Group; members: import('./supabase').Member[] }

const _prefetchMap = new Map<string, Promise<GroupData | null>>()

export function getPrefetchPromise(token: string): Promise<GroupData | null> | undefined {
  return _prefetchMap.get(token)
}

export function setPrefetchPromise(token: string, promise: Promise<GroupData | null>): void {
  _prefetchMap.set(token, promise)
  // Auto-expire after 30s so stale promises don't accumulate
  setTimeout(() => _prefetchMap.delete(token), 30_000)
}
