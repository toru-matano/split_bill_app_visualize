'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { calculateSettlement } from '@/lib/settle'
import type { Group, Member, Transfer } from '@/lib/supabase'
import { CURRENCY_SYMBOLS } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import LangPicker from '@/components/LangPicker'

type PageProps = { params: Promise<{ token: string }> }

export default function SettlePage({ params }: PageProps) {
  const router = useRouter()
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [netBalances, setNetBalances] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { params.then(p => setToken(p.token)) }, [params])

  useEffect(() => {
    if (!token) return
    ;(async () => {
      const { data: grp } = await supabase.from('groups').select('*').eq('share_token', token).single()
      if (!grp) { setLoading(false); return }
      setGroup(grp)

      const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id)
      const memberList: Member[] = mems ?? []
      setMembers(memberList)

      const { data: exps } = await supabase.from('expenses').select('*').eq('group_id', grp.id)
      const { data: splits } = await supabase.from('expense_splits').select('*')
        .in('expense_id', (exps ?? []).map((e: { id: string }) => e.id))

      // Compute true net balances (paid - owed per person)
      const balances: Record<string, number> = {}
      memberList.forEach(m => { balances[m.id] = 0 });
      (exps ?? []).forEach((e: { paid_by: string; amount: number }) => {
        balances[e.paid_by] = (balances[e.paid_by] ?? 0) + Number(e.amount)
      });
      (splits ?? []).forEach((s: { member_id: string; amount: number }) => {
        balances[s.member_id] = (balances[s.member_id] ?? 0) - Number(s.amount)
      })
      setNetBalances(balances)

      const result = calculateSettlement({
        expenses: (exps ?? []).map((e: { paid_by: string; amount: number }) => ({ paid_by: e.paid_by, amount: e.amount })),
        splits: (splits ?? []).map((s: { member_id: string; amount: number }) => ({ member_id: s.member_id, amount: s.amount })),
        members: memberList,
      })
      setTransfers(result)
      setLoading(false)
    })()
  }, [token])

  const sym = CURRENCY_SYMBOLS[group?.currency ?? 'JPY'] ?? '¥'

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">{t('settle.calculating')}</p></div>

  // Chart data
  const maxAbs = Math.max(...Object.values(netBalances).map(Math.abs), 1)

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer' }} onClick={() => router.back()}>{t('nav.back')}</a>
        <span className="navbar-title">{t('settle.title')}</span>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Hero summary */}
        <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
          {transfers.length === 0 ? (
            <><div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div><h2 style={{ marginBottom: 6 }}>{t('settle.allSettled')}</h2><p className="text-muted">{t('settle.allSettledSub')}</p></>
          ) : (
            <><div style={{ fontSize: 40, marginBottom: 12 }}>💸</div>
            <h2 style={{ marginBottom: 6 }}>{transfers.length === 1 ? t('settle.transfersNeeded', { count: 1 }) : t('settle.transfersNeededPlural', { count: transfers.length })}</h2>
            <p className="text-muted">Minimum payments to settle all debts</p></>
          )}
        </div>

        {/* Balance chart */}
        <div>
          <p className="section-title">{t('settle.balanceChart')}</p>
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {members.map(m => {
                const net = netBalances[m.id] ?? 0
                const isPositive = net >= 0
                const barWidth = Math.abs(net) / maxAbs * 100
                return (
                  <div key={m.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</span>
                      <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: net > 0.5 ? 'var(--success)' : net < -0.5 ? 'var(--danger)' : 'var(--ink-3)' }}>
                        {net > 0.5 ? '+' : ''}{sym}{Math.round(net).toLocaleString()}
                      </span>
                    </div>
                    {/* Diverging bar — centre is 0 */}
                    <div style={{ position: 'relative', height: 10, background: 'var(--surface-3)', borderRadius: 5 }}>
                      {/* Zero line */}
                      <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border-2)', zIndex: 1 }} />
                      {/* Bar */}
                      <div style={{
                        position: 'absolute',
                        top: 0, height: '100%', borderRadius: 5,
                        width: `${barWidth / 2}%`,
                        left: isPositive ? '50%' : `${50 - barWidth / 2}%`,
                        background: isPositive ? 'var(--success)' : 'var(--danger)',
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--danger)' }}>owes</span>
                      <span style={{ fontSize: 10, color: 'var(--success)' }}>gets back</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Transfer list */}
        {transfers.length > 0 && (
          <div>
            <p className="section-title">{t('settle.whoPaysWhom')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transfers.map((t2, i) => (
                <div key={i} className="transfer-item">
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--danger-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--danger)', flexShrink: 0 }}>
                    {t2.fromName.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500 }}>{t2.fromName} <span style={{ color: 'var(--ink-3)' }}>→</span> {t2.toName}</p>
                  </div>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--success-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--success)', flexShrink: 0 }}>
                    {t2.toName.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="transfer-amount">{sym}{t2.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Net balances table */}
        <div>
          <p className="section-title">{t('settle.memberBalances')}</p>
          <div className="card" style={{ padding: '4px 20px' }}>
            {members.map(m => {
              const net = netBalances[m.id] ?? 0
              return (
                <div key={m.id} className="expense-item">
                  <div className="expense-avatar">{m.name.slice(0, 2).toUpperCase()}</div>
                  <p style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{m.name}</p>
                  <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500, color: net > 0.5 ? 'var(--success)' : net < -0.5 ? 'var(--danger)' : 'var(--ink-3)' }}>
                    {net > 0.5 ? `+${sym}${Math.round(net).toLocaleString()}` : net < -0.5 ? `-${sym}${Math.round(Math.abs(net)).toLocaleString()}` : `${sym}0`}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        <button className="btn btn-secondary" onClick={() => router.push(`/group/${token}`)}>
          {t('settle.back')}
        </button>
      </div>
    </>
  )
}
