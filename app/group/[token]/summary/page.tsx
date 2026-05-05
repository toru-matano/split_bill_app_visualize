'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member, Expense } from '@/lib/supabase'
import { CATEGORIES } from '@/lib/categories'
import { CURRENCY_SYMBOLS } from '@/lib/fx'
import { calculateSettlement } from '@/lib/settle'
import type { Transfer } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import LangPicker from '@/components/LangPicker'

type PageProps = { params: Promise<{ token: string }> }

export default function SummaryPage({ params }: PageProps) {
  const router = useRouter()
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

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
      const { data: exps } = await supabase.from('expenses').select('*, member:paid_by(id,name)').eq('group_id', grp.id).order('created_at', { ascending: true })
      const expList = (exps as Expense[]) ?? []
      setExpenses(expList)
      const { data: splits } = await supabase.from('expense_splits').select('*').in('expense_id', expList.map(e => e.id))
      const result = calculateSettlement({
        expenses: expList.map(e => ({ paid_by: e.paid_by, amount: e.amount })),
        splits: (splits ?? []).map((s: { member_id: string; amount: number }) => ({ member_id: s.member_id, amount: s.amount })),
        members: memberList,
      })
      setTransfers(result)
      setLoading(false)
    })()
  }, [token])

  const copyAsText = () => {
    if (!group) return
    const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
    const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
    const lines = [
      `📋 ${group.name} — ${t('summary.title')}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `${t('group.totalSpent')}: ${sym}${Math.round(total).toLocaleString()}`,
      `${t('group.members')}: ${members.map(m => m.name).join(', ')}`,
      `${t('group.perPerson')}: ${sym}${Math.round(total / members.length).toLocaleString()}`,
      ``,
      `💸 ${t('group.expenses')} (${expenses.length})`,
    ]
    expenses.forEach(e => {
      const payer = e.member as unknown as Member | null
      const cat = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
      lines.push(`  ${cat.emoji} ${e.label || 'Expense'} — ${sym}${Math.round(Number(e.amount)).toLocaleString()} (${payer?.name ?? '?'})`)
    })
    const byCat: Record<string, number> = {}
    expenses.forEach(e => { byCat[e.category] = (byCat[e.category] ?? 0) + Number(e.amount) })
    lines.push(``, `📊 ${t('summary.byCategory')}`)
    Object.entries(byCat).sort(([, a], [, b]) => b - a).forEach(([cat, amt]) => {
      const def = CATEGORIES[cat as keyof typeof CATEGORIES] ?? CATEGORIES.other
      lines.push(`  ${def.emoji} ${def.label}: ${sym}${Math.round(amt).toLocaleString()}`)
    })
    lines.push(``, `👤 ${t('summary.byMember')}`)
    members.forEach(m => {
      const paid = expenses.filter(e => e.paid_by === m.id).reduce((s, e) => s + Number(e.amount), 0)
      lines.push(`  ${m.name}: ${sym}${Math.round(paid).toLocaleString()}`)
    })
    if (transfers.length > 0) {
      lines.push(``, `✅ ${t('summary.toSettleUp')}`)
      transfers.forEach(tr => { lines.push(`  ${tr.fromName} → ${tr.toName}: ${sym}${tr.amount.toLocaleString()}`) })
    } else {
      lines.push(``, `✅ ${t('summary.allSettled')}`)
    }
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>
  if (!group) return null

  const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const byCat: Record<string, number> = {}
  expenses.forEach(e => { byCat[e.category] = (byCat[e.category] ?? 0) + Number(e.amount) })
  const sortedCats = Object.entries(byCat).sort(([, a], [, b]) => b - a)
  const byMember: Record<string, number> = {}
  expenses.forEach(e => { byMember[e.paid_by] = (byMember[e.paid_by] ?? 0) + Number(e.amount) })

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer' }} onClick={() => router.back()}>{t('nav.back')}</a>
        <span className="navbar-title">{t('summary.title')}</span>
        <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={copyAsText}>{copied ? t('summary.copied') : t('summary.copy')}</button>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Hero */}
        <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 6 }}>{group.name}</p>
          <p style={{ fontSize: 40, fontWeight: 700, fontFamily: 'DM Mono, monospace', letterSpacing: '-0.03em', marginBottom: 4 }}>
            {sym}{Math.round(total).toLocaleString()}
          </p>
          <p style={{ fontSize: 14, color: 'var(--ink-2)' }}>
            {expenses.length !== 1 ? t('summary.expenseCountPlural', { count: expenses.length }) : t('summary.expenseCount', { count: 1 })}
            {' · '}
            {t('summary.perPerson', { sym, amount: Math.round(total / members.length).toLocaleString() })}
          </p>
        </div>

        {/* By category */}
        {sortedCats.length > 0 && (
          <div>
            <p className="section-title">{t('summary.byCategory')}</p>
            <div className="card" style={{ padding: '8px 20px' }}>
              {sortedCats.map(([cat, amt]) => {
                const def = CATEGORIES[cat as keyof typeof CATEGORIES] ?? CATEGORIES.other
                const pct = total > 0 ? (amt / total) * 100 : 0
                return (
                  <div key={cat} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 20 }}>{def.emoji}</span>
                      <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{def.label}</span>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500 }}>{sym}{Math.round(amt).toLocaleString()}</span>
                      <span style={{ fontSize: 12, color: 'var(--ink-3)', width: 36, textAlign: 'right' }}>{Math.round(pct)}%</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: def.color, borderRadius: 2, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ paddingBottom: 4 }} />
            </div>
          </div>
        )}

        {/* By member */}
        <div>
          <p className="section-title">{t('summary.byMember')}</p>
          <div className="card" style={{ padding: '4px 20px' }}>
            {members.map(m => {
              const paid = byMember[m.id] ?? 0
              const pct = total > 0 ? (paid / total) * 100 : 0
              const fair = total / members.length
              const diff = paid - fair
              return (
                <div key={m.id} className="expense-item">
                  <div className="expense-avatar">{m.name.slice(0, 2).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="expense-label">{m.name}</p>
                    <p className="expense-meta">{Math.round(pct)}% of total</p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500 }}>{sym}{Math.round(paid).toLocaleString()}</p>
                    <p style={{ fontSize: 11, marginTop: 2, color: diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--ink-3)' }}>
                      {diff > 0 ? `+${sym}${Math.round(diff).toLocaleString()}` : diff < 0 ? `-${sym}${Math.round(Math.abs(diff)).toLocaleString()}` : 'even'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Settlements */}
        <div>
          <p className="section-title">{t('summary.toSettleUp')}</p>
          {transfers.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 28 }}>
              <span style={{ fontSize: 32 }}>🎉</span>
              <p style={{ marginTop: 8, fontWeight: 500 }}>{t('summary.allSettled')}</p>
              <p className="text-muted">{t('summary.allSettledSub')}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transfers.map((tr, i) => (
                <div key={i} className="transfer-item">
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{tr.fromName}</span>
                  <span className="transfer-arrow">→</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{tr.toName}</span>
                  <span className="transfer-amount">{sym}{tr.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Full expense list */}
        <div>
          <p className="section-title">{t('summary.allExpenses')}</p>
          <div className="card" style={{ padding: '4px 20px' }}>
            {expenses.map(e => {
              const payer = e.member as unknown as Member | null
              const cat = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
              const isForeign = e.original_currency && e.original_currency !== group.currency
              return (
                <div key={e.id} className="expense-item">
                  <div className="expense-avatar" style={{ background: cat.color + '18', fontSize: 18 }}>{cat.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="expense-label">{e.label || 'Expense'}</p>
                    <p className="expense-meta">
                      {payer?.name ?? '—'}
                      {isForeign && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>· {CURRENCY_SYMBOLS[e.original_currency!] ?? e.original_currency}{Number(e.original_amount).toLocaleString()} {e.original_currency}</span>}
                    </p>
                  </div>
                  <p className="expense-amount">{sym}{Math.round(Number(e.amount)).toLocaleString()}</p>
                </div>
              )
            })}
          </div>
        </div>

        <button className="btn btn-secondary" onClick={copyAsText}>
          {copied ? t('summary.copiedText') : t('summary.copyText')}
        </button>
      </div>
    </>
  )
}
