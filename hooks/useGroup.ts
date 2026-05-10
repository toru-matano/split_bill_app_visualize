'use client'
/**
 * hooks/useGroup.ts  (REFACTORED)
 *
 * What changed:
 *  - Members are NO LONGER fetched directly from Supabase on the client.
 *    The `members` table has no `name` column anymore — it lives encrypted
 *    in `member_secure_data` which is server-only.
 *  - Instead, we call GET /api/groups/[token]/members which runs server-side,
 *    decrypts the names, and returns plain { id, name, group_id, created_at }.
 *  - The Group fetch is unchanged (groups table has no PII).
 *  - The returned shape is identical to before, so every page that uses
 *    this hook (summary, settle, member detail) requires zero further changes.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Group, Member } from '@/lib/supabase'

type UseGroupResult =
  | { loading: true;  group: null;  members: Member[] }
  | { loading: false; group: null;  members: Member[] }
  | { loading: false; group: Group; members: Member[] }

export function useGroup(token: string | null): UseGroupResult {
  const [state, setState] = useState<UseGroupResult>({ loading: true, group: null, members: [] })

  useEffect(() => {
    if (!token) return
    setState({ loading: true, group: null, members: [] })
    let cancelled = false

    ;(async () => {
      // 1. Fetch group metadata (no PII — direct Supabase call is fine)
      const { data: grp } = await supabase
        .from('groups').select('*').eq('share_token', token).single()
      if (cancelled) return
      if (!grp) { setState({ loading: false, group: null, members: [] }); return }

      // 2. Fetch members via server API route — names are decrypted server-side
      const res = await fetch(`/api/groups/${token}/members`)
      if (cancelled) return

      const members: Member[] = res.ok ? await res.json() : []

      setState({ loading: false, group: grp as Group, members })
    })()

    return () => { cancelled = true }
  }, [token])

  return state
}
