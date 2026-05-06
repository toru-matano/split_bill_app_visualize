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

      const { data: exps } = await supabase.from('expenses').select('id').eq('group_id', grp.id)
      const expIds = (exps ?? []).map((e: { id: string }) => e.id)

      const [{ data: payers }, { data: splits }] = await Promise.all([
        supabase.from('expense_payers').select('member_id, amount').in('expense_id', expIds),
        supabase.from('expense_splits').select('member_id, amount').in('expense_id', expIds),
      ])

      // Net balances
      const balances: Record<string, number> = {}
      memberList.forEach(m => { balances[m.id] = 0 });
      (payers ?? []).forEach((p: { member_id: string; amount: number }) => {
        balances[p.member_id] = (balances[p.member_id] ?? 0) + Number(p.amount)
      });
      (splits ?? []).forEach((s: { member_id: string; amount: number }) => {
        balances[s.member_id] = (balances[s.member_id] ?? 0) - Number(s.amount)
      })
      setNetBalances(balances)

      const result = calculateSettlement({
        payers: (payers ?? []).map((p: { member_id: string; amount: number }) => ({ member_id: p.member_id, amount: p.amount })),
        splits: (splits ?? []).map((s: { member_id: string; amount: number }) => ({ member_id: s.member_id, amount: s.amount })),
        members: memberList,
      })
      setTransfers(result)
      setLoading(false)
    })()
  }, [token])

  const sym = CURRENCY_SYMBOLS[group?.currency ?? 'JPY'] ?? '¥'
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">{t('settle.calculating')}</p></div>

  const maxAbs = Math.max(...Object.values(netBalances).map(Math.abs), 1)

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer' }} onClick={() => router.back()}>{t('nav.back')}</a>
        <span className="navbar-title">{t('settle.title')}</span>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
          {transfers.length === 0
            ? <><div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div><h2 style={{ marginBottom: 6 }}>{t('settle.allSettled')}</h2><p className="text-muted">{t('settle.allSettledSub')}</p></>
            : <><div style={{ fontSize: 40, marginBottom: 12 }}>💸</div>
               <h2 style={{ marginBottom: 6 }}>{transfers.length === 1 ? t('settle.transfersNeeded', { count: 1 }) : t('settle.transfersNeededPlural', { count: transfers.length })}</h2>
               <p className="text-muted">Minimum payments to settle all debts</p></>
          }
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="expense-avatar">{m.name.slice(0, 2).toUpperCase()}</div>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</span>
                        </div>
                        <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: net > 0.5 ? 'var(--success)' : net < -0.5 ? 'var(--danger)' : 'var(--ink-3)' }}>
                          {net > 0.5 ? '+' : ''}{sym}{Math.round(net).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ position: 'relative', height: 10, background: 'var(--surface-3)', borderRadius: 5 }}>
                        <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border-2)', zIndex: 1 }} />
                        <div style={{ position: 'absolute', top: 0, height: '100%', borderRadius: 5, width: `${barWidth / 2}%`, left: isPositive ? '50%' : `${50 - barWidth / 2}%`, background: isPositive ? 'var(--success)' : 'var(--danger)', transition: 'width 0.4s ease' }} />
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

        {transfers.length > 0 && (
          <div>
            <p className="section-title">{t('settle.whoPaysWhom')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transfers.map((tr, i) => (
                <div key={i} className="transfer-item">
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--danger-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--danger)', flexShrink: 0 }}>
                    {tr.fromName.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500 }}>{tr.fromName} <span style={{ color: 'var(--ink-3)' }}>→</span> {tr.toName}</p>
                  </div>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--success-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--success)', flexShrink: 0 }}>
                    {tr.toName.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="transfer-amount">{sym}{tr.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="btn btn-secondary" onClick={() => router.push(`/group/${token}`)}>{t('settle.back')}</button>
      </div>
    </>
  )
}
