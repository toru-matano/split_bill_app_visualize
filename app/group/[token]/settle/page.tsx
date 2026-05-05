'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { calculateSettlement } from '@/lib/settle'
import type { Group, Member, Transfer } from '@/lib/supabase'

const CURRENCY_SYMBOLS: Record<string, string> = { JPY: '¥', USD: '$', EUR: '€', GBP: '£' }

type PageProps = { params: Promise<{ token: string }> }

export default function SettlePage({ params }: PageProps) {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    params.then(p => setToken(p.token))
  }, [params])

  useEffect(() => {
    if (!token) return
    ;(async () => {
      const { data: grp } = await supabase.from('groups').select('*').eq('share_token', token).single()
      if (!grp) { setLoading(false); return }
      setGroup(grp)

      const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id)
      const memberList = mems ?? []
      setMembers(memberList)

      const { data: exps } = await supabase.from('expenses').select('*').eq('group_id', grp.id)
      const { data: splits } = await supabase
        .from('expense_splits')
        .select('*')
        .in('expense_id', (exps ?? []).map((e: { id: string }) => e.id))

      const result = calculateSettlement({
        expenses: (exps ?? []).map((e: { paid_by: string; amount: number }) => ({
          paid_by: e.paid_by,
          amount: e.amount,
        })),
        splits: (splits ?? []).map((s: { member_id: string; amount: number }) => ({
          member_id: s.member_id,
          amount: s.amount,
        })),
        members: memberList,
      })

      setTransfers(result)
      setLoading(false)
    })()
  }, [token])

  const sym = CURRENCY_SYMBOLS[group?.currency ?? 'JPY'] ?? '¥'

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p className="text-muted">Calculating…</p>
    </div>
  )

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32 }} onClick={() => router.back()}>← Back</a>
        <span className="navbar-title">Settle up</span>
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Summary */}
        <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
          {transfers.length === 0 ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <h2 style={{ marginBottom: 6 }}>All settled!</h2>
              <p className="text-muted">Everyone's balance is even.</p>
            </>
          ) : (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>💸</div>
              <h2 style={{ marginBottom: 6 }}>
                {transfers.length} transfer{transfers.length > 1 ? 's' : ''} needed
              </h2>
              <p className="text-muted">Minimum payments to settle all debts</p>
            </>
          )}
        </div>

        {/* Transfer list */}
        {transfers.length > 0 && (
          <div>
            <p className="section-title">Who pays whom</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transfers.map((t, i) => (
                <div key={i} className="transfer-item">
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{t.fromName}</span>
                  <span className="transfer-arrow">→</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{t.toName}</span>
                  <span className="transfer-amount">{sym}{t.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-person balances */}
        <div>
          <p className="section-title">Member balances</p>
          <div className="card" style={{ padding: '4px 20px' }}>
            {members.map(m => {
              const paid = transfers.filter(t => t.to === m.id).reduce((s, t) => s + t.amount, 0)
              const owes = transfers.filter(t => t.from === m.id).reduce((s, t) => s + t.amount, 0)
              const net = paid - owes
              return (
                <div key={m.id} className="expense-item">
                  <div className="expense-avatar">{m.name.slice(0, 2).toUpperCase()}</div>
                  <p style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{m.name}</p>
                  <p style={{
                    fontFamily: 'DM Mono, monospace',
                    fontSize: 14,
                    fontWeight: 500,
                    color: net > 0 ? 'var(--success)' : net < 0 ? 'var(--danger)' : 'var(--ink-3)',
                  }}>
                    {net > 0 ? `+${sym}${net.toLocaleString()}` : net < 0 ? `-${sym}${Math.abs(net).toLocaleString()}` : `${sym}0`}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        <button
          className="btn btn-secondary"
          onClick={() => router.push(`/group/${token}`)}
        >
          Back to group
        </button>
      </div>
    </>
  )
}
