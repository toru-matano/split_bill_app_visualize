'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Group, Member } from '@/lib/supabase'
import { getPrefetchPromise, setPrefetchPromise } from '@/lib/expense-cache'

type GroupData = { group: Group; members: Member[] }

type UseGroupResult =
  | { loading: true;  group: null; members: Member[] }
  | { loading: false; group: null; members: Member[] }
  | { loading: false; group: Group; members: Member[] }

/**
 * Fetch group + members for a share token.
 * - Resolves from an in-flight prefetch promise if one was started on hover
 * - Uses Supabase embedded select to get group + members in a single query
 * - Results are cancellation-safe via the `cancelled` flag
 */
export function useGroup(token: string | null): UseGroupResult {
  const [state, setState] = useState<UseGroupResult>({ loading: true, group: null, members: [] })

  useEffect(() => {
    if (!token) return
    setState({ loading: true, group: null, members: [] })
    let cancelled = false

    ;(async () => {
      // Resolve from prefetch if available (hover pre-warm)
      let data: GroupData | null = null
      const prefetch = getPrefetchPromise(token)
      if (prefetch) {
        data = await prefetch
      } else {
        data = await fetchGroupData(token)
      }

      if (cancelled) return
      if (!data) { setState({ loading: false, group: null, members: [] }); return }
      setState({ loading: false, group: data.group, members: data.members })
    })()

    return () => { cancelled = true }
  }, [token])

  return state
}

/**
 * Fetch group + members in a single round trip using embedded select.
 * Exported so the prefetch helper can call it.
 */
export async function fetchGroupData(token: string): Promise<GroupData | null> {
  // Single query: group with members embedded
  const { data: grp } = await supabase
    .from('groups')
    .select('*, members(*)')
    .eq('share_token', token)
    .single()

  if (!grp) return null

  const { members: rawMembers, ...groupFields } = grp as Group & { members: Member[] }
  const members: Member[] = Array.isArray(rawMembers)
    ? [...rawMembers].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : []

  return { group: groupFields as Group, members }
}

/**
 * Prime the prefetch cache for a token — call on hover before navigation.
 * The result is stored in the module-level map so useGroup resolves instantly.
 */
export function primeGroupCache(token: string): void {
  if (!token || getPrefetchPromise(token)) return
  const promise = fetchGroupData(token)
  setPrefetchPromise(token, promise)
}
