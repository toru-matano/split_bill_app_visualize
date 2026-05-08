'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Group, Member } from '@/lib/supabase'

type UseGroupResult =
  | { loading: true;  group: null; members: Member[] }
  | { loading: false; group: null; members: Member[] }
  | { loading: false; group: Group; members: Member[] }

/**
 * Resolves share_token -> group + members.
 * Eliminates the repeated boilerplate across every page.
 */
export function useGroup(token: string | null): UseGroupResult {
  const [state, setState] = useState<UseGroupResult>({ loading: true, group: null, members: [] })

  useEffect(() => {
    if (!token) return
    setState({ loading: true, group: null, members: [] })
    let cancelled = false
    ;(async () => {
      const { data: grp } = await supabase
        .from('groups').select('*').eq('share_token', token).single()
      if (cancelled) return
      if (!grp) { setState({ loading: false, group: null, members: [] }); return }

      const { data: mems } = await supabase
        .from('members').select('*').eq('group_id', grp.id).order('created_at', { ascending: true })
      if (cancelled) return
      setState({ loading: false, group: grp as Group, members: (mems as Member[]) ?? [] })
    })()
    return () => { cancelled = true }
  }, [token])

  return state
}
