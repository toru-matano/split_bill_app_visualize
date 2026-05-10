'use client'
import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchGroupExpenses, fetchGroupSplits, type DecryptedExpense } from '@/lib/expenses-api'
import { CATEGORIES } from '@/lib/categories'
import { CURRENCY_SYMBOLS, formatNumber } from '@/lib/fx'
import { computeBalances } from '@/lib/settle'
import { useI18n } from '@/lib/i18n'
import { useGroup } from '@/hooks/useGroup'
import LangPicker from '@/components/LangPicker'

type PageProps = { params: Promise<{ token: string; memberId: string }> }
type SplitRow = { expense_id: string; amount: number }
type TransferRecord = { id: string; from_member_id: string; to_member_id: string; amount: number; note: string | null; transfer_date: string }

export default function MemberDetailPage({ params }: PageProps) {
  const { token, memberId } = use(params)
  const router = useRouter()
  const { t } = useI18n()
  const { loading: groupLoading, group, members } = useGroup(token)

  const [expenses, setExpenses]         = useState<DecryptedExpense[]>([])
  const [memberSplits, setMemberSplits] = useState<SplitRow[]>([])
  const [transfers, setTransfers]       = useState<TransferRecord[]>([])
  const [netBalance, setNetBalance]     = useState(0)
  const [dataLoading, setDataLoading]   = useState(true)
  const [tab, setTab]                   = useState<'expenses' | 'transfers'>('expenses')

  useEffect(() => {
    if (!group || members.length === 0) return
    ;(async () => {
      // ── Fetch all decrypted data from server API ───────────────────────
      const [expList, { payers: allPayers, splits: allSplits }, { data: trs }] = await Promise.all([
        fetchGroupExpenses(group.id),
        fetchGroupSplits(group.id),
        supabase.from('transfer_records').select('*').eq('group_id', group.id)
          .or(`from_member_id.eq.${memberId},to_member_id.eq.${memberId}`)
          .order('transfer_date', { ascending: false }),
      ])

      setExpenses(expList)
      if (expList.length === 0) { setDataLoading(false); return }

      const bal = computeBalances(allPayers, allSplits, members)
      setNetBalance(bal[memberId] ?? 0)
      setMemberSplits(allSplits.filter(s => s.member_id === memberId))
      setTransfers((trs ?? []) as TransferRecord[])
      setDataLoading(false)
    })()
  }, [group, members, memberId])

  const loading = groupLoading || dataLoading
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>
  if (!group) return null

  const member = members.find(m => m.id === memberId)
  if (!member) return <div style={{ padding: 24, textAlign: 'center' }}><p className="text-muted">Member not found</p></div>

  const sym            = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const paidExpenses   = expenses.filter(e => e.paid_by === memberId)
  const totalPaid      = paidExpenses.reduce((s, e) => s + e.amount, 0)
  const totalOwes      = memberSplits.reduce((s, sp) => s + Number(sp.amount), 0)
  const groupTotal     = expenses.reduce((s, e) => s + e.amount, 0)
  const fair           = members.length > 0 ? groupTotal / members.length : 0
  const splitSet       = new Set(memberSplits.map(s => s.expense_id))
  const involvedExpenses = expenses.filter(e => e.paid_by === memberId || splitSet.has(e.id))
  const memberName     = (id: string) => members.find(m => m.id === id)?.name ?? id
  const maxBar         = Math.max(totalPaid, totalOwes, 1)

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => router.push(`/group/${token}/summary`)}>
          <i className="fa-solid fa-arrow-left" style={{ fontSize: 13 }} /> Back
        </a>
        <span className="navbar-title">{member.name}</span>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Hero */}
        <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: 'var(--ink-2)', margin: '0 auto 14px', border: '2px solid var(--border)' }}>
            {member.name.slice(0, 2).toUpperCase()}
          </div>
          <h2 style={{ marginBottom: 4 }}>{member.name}</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 20 }}>{group.name}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { label: 'Paid',    value: sym + formatNumber(totalPaid), color: 'var(--success)' },
              { label: 'Owes',   value: sym + formatNumber(totalOwes), color: 'var(--danger)' },
              { label: 'Balance', value: (netBalance > 0 ? '+' : '') + sym + formatNumber(Math.abs(netBalance)), color: netBalance > 0.5 ? 'var(--success)' : netBalance < -0.5 ? 'var(--danger)' : 'var(--ink-3)' },
            ].map(stat => (
              <div key={stat.label} style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', padding: '12px 8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</p>
                <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color: stat.color }}>{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Balance bar */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Net position</span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: netBalance > 0.5 ? '#dcfce7' : netBalance < -0.5 ? '#fee2e2' : 'var(--surface-2)', color: netBalance > 0.5 ? 'var(--success)' : netBalance < -0.5 ? 'var(--danger)' : 'var(--ink-3)' }}>
              {netBalance > 0.5 ? `Gets back ${sym}${formatNumber(netBalance)}` : netBalance < -0.5 ? `Owes ${sym}${formatNumber(Math.abs(netBalance))}` : 'Settled'}
            </span>
          </div>
          {[{ label: 'Paid', amount: totalPaid, color: 'var(--success)' }, { label: 'Owes', amount: totalOwes, color: 'var(--danger)' }].map(row => (
            <div key={row.label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.label}</span>
                <span style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--ink-2)' }}>{sym}{formatNumber(row.amount)}</span>
              </div>
              <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(row.amount / maxBar) * 100}%`, background: row.color, borderRadius: 3, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {(['expenses', 'transfers'] as const).map((tabKey, i) => (
            <button key={tabKey} onClick={() => setTab(tabKey)} style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', border: 'none', borderRight: i === 0 ? '1px solid var(--border-2)' : 'none', cursor: 'pointer', background: tab === tabKey ? 'var(--ink)' : 'var(--surface)', color: tab === tabKey ? 'white' : 'var(--ink-2)', transition: 'all 0.12s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <i className={`fa-solid ${tabKey === 'expenses' ? 'fa-receipt' : 'fa-arrow-right-arrow-left'}`} style={{ fontSize: 12 }} />
              {tabKey === 'expenses' ? `Net (${involvedExpenses.length})` : `Transfers (${transfers.length})`}
            </button>
          ))}
        </div>

        {/* Balance tab */}
        {tab === 'expenses' && (
          involvedExpenses.length === 0
            ? <div className="card" style={{ textAlign: 'center', padding: 28 }}><p style={{ color: 'var(--ink-3)', fontSize: 14 }}>No expenses yet</p></div>
            : <div className="card" style={{ padding: '4px 20px' }}>
                {involvedExpenses.map(e => {
                  const isPayer  = e.paid_by === memberId
                  const splitRow = memberSplits.find(s => s.expense_id === e.id)
                  const cat      = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
                  const amount   = isPayer ? e.amount : 0
                  const dateStr  = e.expense_date ?? new Date(e.created_at).toISOString().split('T')[0]
                  return (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0', borderBottom: '1px solid var(--border)' }}>
                      <div className="expense-avatar" style={{ background: cat.color + '18', fontSize: 18 }}>{cat.emoji}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13.5, fontWeight: 500 }}>{e.label || 'Expense'}</p>
                        <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>{dateStr}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {splitRow && <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: isPayer ? 'var(--success)' : 'var(--danger)' }}>{sym}{formatNumber(amount - Number(splitRow.amount))}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
        )}

        {/* Transfers tab */}
        {tab === 'transfers' && (
          transfers.length === 0
            ? <div className="card" style={{ textAlign: 'center', padding: 28 }}>
                <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>No transfers recorded</p>
                <button className="btn btn-secondary" style={{ marginTop: 12, fontSize: 13 }} onClick={() => router.push(`/group/${token}/settle`)}>Record a transfer</button>
              </div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {transfers.map(tr => {
                  const isSender = tr.from_member_id === memberId
                  return (
                    <div key={tr.id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: isSender ? '#fee2e2' : '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className={`fa-solid ${isSender ? 'fa-arrow-up' : 'fa-arrow-down'}`} style={{ fontSize: 14, color: isSender ? 'var(--danger)' : 'var(--success)' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                          {isSender ? <>Paid to <strong>{memberName(tr.to_member_id)}</strong></> : <>Received from <strong>{memberName(tr.from_member_id)}</strong></>}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(tr.transfer_date).toLocaleDateString()}{tr.note ? ` · ${tr.note}` : ''}</p>
                      </div>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 15, color: isSender ? 'var(--danger)' : 'var(--success)' }}>
                        {isSender ? '-' : '+'}{sym}{Number(tr.amount).toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>
        )}

      </div>
    </>
  )
}
