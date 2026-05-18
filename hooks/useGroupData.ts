'use client'
/**
 * hooks/useGroupData.ts
 *
 * App Shell data-loading hook.
 *
 * Load sequence (all steps happen AFTER first paint):
 * ──────────────────────────────────────────────────────────────────
 *  T+0ms   Shell HTML served from SW cache, skeleton rendered.
 *          This hook fires its useEffect.
 *
 *  T+1ms   Phase 1 — Cache hydration (synchronous reads from
 *          sessionStorage). If a warm list cache exists it populates
 *          the UI immediately. The skeleton is replaced with real
 *          (potentially stale) content while fresh data loads.
 *
 *  T+?ms   Phase 2 — Concurrent network fetches:
 *            • Group metadata  (Supabase direct — no PII)
 *            • Member names    (GET /api/groups/[token]/members)
 *            • Expense list    (GET /api/expenses?groupId=…)
 *          All three start in parallel. Members and expenses are
 *          independent at the network level; names are resolved in
 *          memory once both arrive.
 *
 *  T+?ms   Phase 3 — Optimistic injection: any expense written by
 *          the add-expense form is spliced in before the Supabase
 *          Realtime INSERT fires.
 *
 *  T+?ms   Phase 4 — Realtime subscription: Supabase channel
 *          re-fetches expenses on INSERT/UPDATE/DELETE.
 *
 * The hook returns a stable object whose shape mirrors what the group
 * page needs, so page components stay declarative.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  readExpenseCache,
  cacheExpenseList,
  invalidateExpenseCache,
} from '@/lib/expense-cache'
import { consumePendingExpense } from '@/lib/optimistic-expenses'
import type { Group, Member, Expense } from '@/lib/supabase'
import type { OptimisticExpense } from '@/lib/optimistic-expenses'
import type { DecryptedExpense } from '@/lib/expenses-api'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GroupDataState = {
  /** True only during the very first load (no cache). Shell renders skeleton. */
  loading: boolean
  /** True when a background refresh is in-flight over cached data */
  refreshing: boolean
  group: Group | null
  members: Member[]
  expenses: (Expense | OptimisticExpense)[]
  /** Realtime activity indicator */
  liveIndicator: boolean
  /** Hard error: group token not found */
  notFound: boolean
  /** Force a full re-fetch (e.g. after a mutation) */
  reload: () => void
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGroupData(token: string | null): GroupDataState {
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [group, setGroup]               = useState<Group | null>(null)
  const [members, setMembers]           = useState<Member[]>([])
  const [expenses, setExpenses]         = useState<(Expense | OptimisticExpense)[]>([])
  const [liveIndicator, setLiveIndicator] = useState(false)
  const [notFound, setNotFound]         = useState(false)
  const [reloadKey, setReloadKey]       = useState(0)

  // Stable refs so callbacks don't re-create on every render
  const groupIdRef  = useRef<string | null>(null)
  const membersRef  = useRef<Member[]>([])
  const groupRef    = useRef<Group | null>(null)

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  // ── Expense enrichment (attach member object for payer name display) ───────
  const enrichExpenses = useCallback(
    (expList: DecryptedExpense[], mems: Member[]): Expense[] =>
      expList.map(e => ({
        ...e,
        member: mems.find(m => m.id === e.paid_by) ?? undefined,
      })) as unknown as Expense[],
    [],
  )

  // ── Re-fetch just expenses (used by Realtime handler) ─────────────────────
  const loadExpenses = useCallback(async (groupId: string) => {
    try {
      const res = await fetch(`/api/expenses?groupId=${encodeURIComponent(groupId)}`)
      if (!res.ok) return
      const expList: DecryptedExpense[] = await res.json()
      cacheExpenseList(groupId, expList as unknown as Expense[])
      const enriched = enrichExpenses(expList, membersRef.current)
      setExpenses(enriched)
    } catch (err) {
      console.warn('[useGroupData] loadExpenses failed:', err)
    }
  }, [enrichExpenses])

  // ── Main load effect ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return

    let cancelled = false

    const run = async () => {
      // ── Phase 1: Hydrate from cache (synchronous, zero latency) ──────────
      // If we have a warm expense cache, render it immediately so the user
      // sees real data as soon as the shell finishes painting.
      const cached = groupIdRef.current
        ? readExpenseCache(groupIdRef.current)
        : null

      if (cached && cached.length > 0 && groupRef.current) {
        const enriched = enrichExpenses(
          cached as unknown as DecryptedExpense[],
          membersRef.current,
        )
        setExpenses(enriched)
        setLoading(false)   // skeleton → real UI instantly
        setRefreshing(true) // show subtle refresh indicator
      }

      // ── Phase 2: Concurrent network fetches ───────────────────────────────
      try {
        // Fetch group metadata + members + expenses in parallel.
        // Group has no PII so it goes direct to Supabase (one fewer hop).
        // Members and expenses are decrypted server-side.
        const [{ data: grp }, membersRes, expensesRes] = await Promise.all([
          supabase.from('groups').select('*').eq('share_token', token).single(),
          fetch(`/api/groups/${token}/members`),
          // We need the group id for expenses — but we can optimistically use
          // the cached groupId if available to start the expense fetch early.
          groupIdRef.current
            ? fetch(`/api/expenses?groupId=${encodeURIComponent(groupIdRef.current)}`)
            : Promise.resolve(null as Response | null),
        ])

        if (cancelled) return

        if (!grp) {
          setNotFound(true)
          setLoading(false)
          setRefreshing(false)
          return
        }

        groupIdRef.current = grp.id
        groupRef.current   = grp as Group
        setGroup(grp as Group)

        // Save to recent groups
        try {
          const recentGroups = JSON.parse(
            localStorage.getItem('splitmate_recent_groups') || '[]'
          )
          if (!recentGroups.some((g: { shareToken: string }) => g.shareToken === token)) {
            recentGroups.unshift({ name: grp.name.trim(), shareToken: token })
            localStorage.setItem(
              'splitmate_recent_groups',
              JSON.stringify(recentGroups.slice(0, 5))
            )
          }
        } catch { /* localStorage unavailable */ }

        // Decode members
        const mems: Member[] = membersRes.ok ? await membersRes.json() : []
        membersRef.current   = mems
        setMembers(mems)

        // If we already fetched expenses with the cached groupId, use that
        // response; otherwise fetch now that we have the real group id.
        let expList: DecryptedExpense[] = []
        if (expensesRes && expensesRes.ok) {
          expList = await expensesRes.json()
        } else {
          const freshRes = await fetch(
            `/api/expenses?groupId=${encodeURIComponent(grp.id)}`
          )
          if (freshRes.ok) expList = await freshRes.json()
        }

        if (cancelled) return

        // Cache the fresh expense list for the next navigation
        cacheExpenseList(grp.id, expList as unknown as Expense[])

        const enriched = enrichExpenses(expList, mems)

        // ── Phase 3: Optimistic injection ─────────────────────────────────
        const optimistic = consumePendingExpense(grp.id)

        setExpenses(prev => {
          const base = enriched
          if (!optimistic) return base
          // Avoid double-insert if Realtime already beat us here
          if (base.some(e => e.id === optimistic.id)) return base
          return [optimistic, ...base]
        })

        setLoading(false)
        setRefreshing(false)
      } catch (err) {
        if (cancelled) return
        console.error('[useGroupData] load error:', err)
        setLoading(false)
        setRefreshing(false)
      }
    }

    run()
    return () => { cancelled = true }
    // reloadKey forces a re-run when reload() is called
  }, [token, reloadKey, enrichExpenses])

  // ── Phase 4: Realtime subscription ────────────────────────────────────────
  useEffect(() => {
    if (!groupIdRef.current) return
    const groupId = groupIdRef.current

    const channel = supabase
      .channel(`group-expenses-${groupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expenses',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          setLiveIndicator(true)
          setTimeout(() => setLiveIndicator(false), 1500)

          // Optimistically flip the pending row to confirmed on INSERT
          if (payload.eventType === 'INSERT') {
            const incomingId = payload.new?.id as string | undefined
            if (incomingId) {
              setExpenses(prev =>
                prev.map(e =>
                  e.id === incomingId
                    ? { ...e, _optimisticStatus: 'confirmed' } as OptimisticExpense
                    : e
                )
              )
            }
          }

          // Re-fetch full list so decrypted fields are up-to-date
          loadExpenses(groupId)
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [group, loadExpenses])

  // ── Poll for optimistic error rollbacks ────────────────────────────────────
  useEffect(() => {
    if (!group) return
    const iv = setInterval(() => {
      setExpenses(prev => {
        const hasError = prev.some(
          e => '_optimisticStatus' in e &&
               (e as OptimisticExpense)._optimisticStatus === 'error'
        )
        if (!hasError) return prev
        return prev.filter(
          e => !(
            '_optimisticStatus' in e &&
            (e as OptimisticExpense)._optimisticStatus === 'error'
          )
        )
      })
    }, 300)
    return () => clearInterval(iv)
  }, [group])

  return {
    loading,
    refreshing,
    group,
    members,
    expenses,
    liveIndicator,
    notFound,
    reload,
  }
}
