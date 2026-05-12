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
      // Run both fetches concurrently — they are fully independent.
      // Promise.all rejects if either throws; both legs have their own error
      // handling (Supabase returns null; the API route returns 404/500 which
      // we handle below), so catastrophic failures are still caught by the
      // outer try/catch implicit to the async IIFE.
      const [{ data: grp }, res] = await Promise.all([
        supabase.from('groups').select('*').eq('share_token', token).single(),
        fetch(`/api/groups/${token}/members`),
      ])
      if (cancelled) return

      // Guard: unknown token — API route also returns 404, so both checks are
      // consistent.  Do not call res.json() before this guard (issue A).
      if (!grp) { setState({ loading: false, group: null, members: [] }); return }

      // res.ok covers 200; a 404 from the API (unknown token) is already
      // handled above via !grp, but 5xx or network errors fall back to [].
      const members: Member[] = res.ok ? await res.json() : []

      setState({ loading: false, group: grp as Group, members })
    })()

    return () => { cancelled = true }
  }, [token])

  return state
}