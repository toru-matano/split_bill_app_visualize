'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member, Expense } from '@/lib/supabase'
import { CATEGORIES } from '@/lib/categories'
import { CURRENCY_SYMBOLS } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import LangPicker from '@/components/LangPicker'

type PageProps = { params: Promise<{ token: string; memberId: string }> }

type SplitRow = { expense_id: string; amount: number }
type TransferRecord = { id: string; from_member_id: string; to_member_id: string; amount: number; note: string | null; transfer_date: string }

export default function MemberDetailPage({ params }: PageProps) {
  const router = useRouter()
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [allMembers, setAllMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [paidExpenses, setPaidExpenses] = useState<Expense[]>([])
  const [splits, setSplits] = useState<SplitRow[]>([])
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [netBalance, setNetBalance] = useState(0)
  const [tab, setTab] = useState<'expenses' | 'transfers'>('expenses')

  useEffect(() => { params.then(p => { setToken(p.token); setMemberId(p.memberId) }) }, [params])

  useEffect(() => {
    if (!token || !memberId) return
    ;(async () => {
      const { data: grp } = await supabase.from('groups').select('*').eq('share_token', token).single()
      if (!grp) { setLoading(false); return }
      setGroup(grp)

      const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id)
      const memberList: Member[] = mems ?? []
      setAllMembers(memberList)
      setMember(memberList.find(m => m.id === memberId) ?? null)

      const { data: exps } = await supabase
        .from('expenses').select('*, member:paid_by(id,name)')
        .eq('group_id', grp.id).order('created_at', { ascending: false })
      const expList = (exps as Expense[]) ?? []
      setExpenses(expList)
      setPaidExpenses(expList.filter(e => e.paid_by === memberId))

      const expIds = expList.map(e => e.id)
      const safeIds = expIds.length ? expIds : ['__none__']

      const { data: memberSplits } = await supabase
        .from('expense_splits').select('expense_id, amount')
        .eq('member_id', memberId).in('expense_id', safeIds)
      setSplits(memberSplits ?? [])

      const [{ data: allPayers }, { data: allSplits }] = await Promise.all([
        supabase.from('expense_payers').select('member_id, amount').in('expense_id', safeIds),
        supabase.from('expense_splits').select('member_id, amount').in('expense_id', safeIds),
      ])
      let bal = 0
      ;(allPayers ?? []).forEach((p: { member_id: string; amount: number }) => { if (p.member_id === memberId) bal += Number(p.amount) });
      (allSplits ?? []).forEach((s: { member_id: string; amount: number }) => { if (s.member_id === memberId) bal -= Number(s.amount) })
      setNetBalance(bal)

      // Transfers involving this member
      try {
        const { data: trs } = await supabase
          .from('transfer_records').select('*').eq('group_id', grp.id)
          .or(`from_member_id.eq.${memberId},to_member_id.eq.${memberId}`)
          .order('transfer_date', { ascending: false })
        setTransfers(trs ?? [])
      } catch { setTransfers([]) }

      setLoading(false)
    })()
  }, [token, memberId])

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>
  if (!group || !member) return null

  const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const totalPaid = paidExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const totalOwes = splits.reduce((s, sp) => s + Number(sp.amount), 0)
  const groupTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const fair = allMembers.length > 0 ? groupTotal / allMembers.length : 0

  const splitSet = new Set(splits.map(s => s.expense_id))
  const involvedExpenses = expenses.filter(e => e.paid_by === memberId || splitSet.has(e.id))

  const memberName = (id: string) => allMembers.find(m => m.id === id)?.name ?? id

  // Compute bar scale
  const maxBar = Math.max(totalPaid, totalOwes, 1)

  return (
    <>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />

      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => router.back()}>
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
              { label: 'Paid', value: sym + Math.round(totalPaid).toLocaleString(), color: 'var(--success)' },
              { label: 'Owes', value: sym + Math.round(totalOwes).toLocaleString(), color: 'var(--danger)' },
              {
                label: 'Balance',
                value: (netBalance > 0 ? '+' : '') + sym + Math.round(Math.abs(netBalance)).toLocaleString(),
                color: netBalance > 0.5 ? 'var(--success)' : netBalance < -0.5 ? 'var(--danger)' : 'var(--ink-3)',
              },
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
            <span style={{
              fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
              background: netBalance > 0.5 ? '#dcfce7' : netBalance < -0.5 ? '#fee2e2' : 'var(--surface-2)',
              color: netBalance > 0.5 ? 'var(--success)' : netBalance < -0.5 ? 'var(--danger)' : 'var(--ink-3)',
            }}>
              {netBalance > 0.5 ? `Gets back ${sym}${Math.round(netBalance).toLocaleString()}` : netBalance < -0.5 ? `Owes ${sym}${Math.round(Math.abs(netBalance)).toLocaleString()}` : 'Settled'}
            </span>
          </div>

          {/* Two-sided bar: paid vs owes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Paid', amount: totalPaid, color: 'var(--success)' },
              { label: 'Owes', amount: totalOwes, color: 'var(--danger)' },
            ].map(row => (
              <div key={row.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.label}</span>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--ink-2)' }}>{sym}{Math.round(row.amount).toLocaleString()}</span>
                </div>
                <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(row.amount / maxBar) * 100}%`, background: row.color, borderRadius: 3, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 10 }}>
            Fair share: {sym}{Math.round(fair).toLocaleString()} · {paidExpenses.length} expense{paidExpenses.length !== 1 ? 's' : ''} paid
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {(['expenses', 'transfers'] as const).map((tabKey, i) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              style={{
                flex: 1, padding: '10px', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                border: 'none', borderRight: i === 0 ? '1px solid var(--border-2)' : 'none',
                cursor: 'pointer',
                background: tab === tabKey ? 'var(--ink)' : 'var(--surface)',
                color: tab === tabKey ? 'white' : 'var(--ink-2)',
                transition: 'all 0.12s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <i className={`fa-solid ${tabKey === 'expenses' ? 'fa-receipt' : 'fa-arrow-right-arrow-left'}`} style={{ fontSize: 12 }} />
              {tabKey === 'expenses' ? `Expenses (${involvedExpenses.length})` : `Transfers (${transfers.length})`}
            </button>
          ))}
        </div>

        {/* Expense history tab */}
        {tab === 'expenses' && (
          <div>
            {involvedExpenses.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 28 }}>
                <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>No expenses yet</p>
              </div>
            ) : (
              <div className="card" style={{ padding: '4px 20px' }}>
                {involvedExpenses.map(e => {
                  const isPayer = e.paid_by === memberId
                  const splitRow = splits.find(s => s.expense_id === e.id)
                  const cat = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
                  const catLabel = t(`categories.${e.category}`) || cat.label
                  const payer = e.member as unknown as Member | null
                  const dateStr = e.expense_date ?? new Date(e.created_at).toISOString().split('T')[0]

                  return (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0', borderBottom: '1px solid var(--border)' }}>
                      <div className="expense-avatar" style={{ background: cat.color + '18', fontSize: 18 }}>{cat.emoji}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13.5, fontWeight: 500 }}>{e.label || 'Expense'}</p>
                        <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                          {catLabel} · {dateStr}
                          {isPayer
                            ? <span style={{ marginLeft: 6, color: 'var(--success)', fontWeight: 500 }}>· paid</span>
                            : <span style={{ marginLeft: 6 }}>· via {payer?.name ?? '—'}</span>
                          }
                        </p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {isPayer && (
                          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>
                            +{sym}{Math.round(Number(e.amount)).toLocaleString()}
                          </p>
                        )}
                        {splitRow && (
                          <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: isPayer ? 400 : 700, color: isPayer ? 'var(--ink-3)' : 'var(--danger)' }}>
                            -{sym}{Math.round(Number(splitRow.amount)).toLocaleString()}
                          </p>
                        )}
                        {isPayer && splitRow && (
                          <p style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>
                            net {(Number(e.amount) - Number(splitRow.amount)) >= 0 ? '+' : ''}{sym}{Math.round(Number(e.amount) - Number(splitRow.amount)).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Transfers tab */}
        {tab === 'transfers' && (
          <div>
            {transfers.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 28 }}>
                <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>No transfers recorded</p>
                <button className="btn btn-secondary" style={{ marginTop: 12, fontSize: 13 }} onClick={() => router.push(`/group/${token}/settle`)}>
                  Record a transfer
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {transfers.map(tr => {
                  const isSender = tr.from_member_id === memberId
                  return (
                    <div key={tr.id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: isSender ? '#fee2e2' : '#dcfce7',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <i className={`fa-solid ${isSender ? 'fa-arrow-up' : 'fa-arrow-down'}`}
                          style={{ fontSize: 14, color: isSender ? 'var(--danger)' : 'var(--success)' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                          {isSender
                            ? <>Paid to <strong>{memberName(tr.to_member_id)}</strong></>
                            : <>Received from <strong>{memberName(tr.from_member_id)}</strong></>
                          }
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {new Date(tr.transfer_date).toLocaleDateString()}{tr.note ? ` · ${tr.note}` : ''}
                        </p>
                      </div>
                      <span style={{
                        fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 15,
                        color: isSender ? 'var(--danger)' : 'var(--success)',
                      }}>
                        {isSender ? '-' : '+'}{sym}{Number(tr.amount).toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <button className="btn btn-secondary" onClick={() => router.push(`/group/${token}/summary`)}>
          <i className="fa-solid fa-arrow-left" style={{ fontSize: 12 }} /> Back to summary
        </button>
      </div>
    </>
  )
}
