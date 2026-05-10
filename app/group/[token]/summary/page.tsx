'use client'
import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Member } from '@/lib/supabase'
import type { Transfer } from '@/lib/supabase'
import { fetchGroupExpenses, fetchGroupSplits, type DecryptedExpense } from '@/lib/expenses-api'
import { CATEGORIES } from '@/lib/categories'
import { CURRENCY_SYMBOLS, formatNumber, thresholdMismatch } from '@/lib/fx'
import { computeBalances, calculateSettlement } from '@/lib/settle'
import { useI18n } from '@/lib/i18n'
import { useGroup } from '@/hooks/useGroup'
import LangPicker from '@/components/LangPicker'

type PageProps = { params: Promise<{ token: string }> }

export default function SummaryPage({ params }: PageProps) {
  const { token } = use(params)
  const router = useRouter()
  const { t } = useI18n()
  const { loading: groupLoading, group, members } = useGroup(token)

  const [expenses, setExpenses]       = useState<DecryptedExpense[]>([])
  const [transfers, setTransfers]     = useState<Transfer[]>([])
  const [netBalances, setNetBalances] = useState<Record<string, number>>({})
  const [dataLoading, setDataLoading] = useState(true)
  const [copied, setCopied]           = useState(false)

  useEffect(() => {
    if (!group || members.length === 0) return
    ;(async () => {
      // ── Fetch decrypted expenses and splits from server API ───────────
      const [expList, { payers: payerRows, splits: splitRows }] = await Promise.all([
        fetchGroupExpenses(group.id),
        fetchGroupSplits(group.id),
      ])
      setExpenses(expList)

      if (expList.length === 0) { setDataLoading(false); return }

      const bal = computeBalances(payerRows, splitRows, members)
      setNetBalances(bal)
      setTransfers(calculateSettlement({ payers: payerRows, splits: splitRows, members }))
      setDataLoading(false)
    })()
  }, [group, members])

  const loading = groupLoading || dataLoading

  const copyAsText = () => {
    if (!group) return
    const sym   = CURRENCY_SYMBOLS[group.currency] ?? group.currency
    const total = expenses.reduce((s, e) => s + e.amount, 0)
    const lines = [
      `📋 ${group.name} — ${t('summary.title')}`, `━━━━━━━━━━━━━━━━━━━━`,
      `${t('group.totalSpent')}: ${sym}${formatNumber(total)}`,
      `${t('group.members')}: ${members.map(m => m.name).join(', ')}`,
      `${t('group.perPerson')}: ${sym}${formatNumber(total / members.length)}`,
      ``, `💸 ${t('group.expenses')} (${expenses.length})`,
    ]
    expenses.forEach(e => {
      const payer = members.find(m => m.id === e.paid_by)
      const cat   = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
      lines.push(`  ${cat.emoji} ${e.label || 'Expense'} — ${sym}${formatNumber(Number(e.amount))} (${payer?.name ?? '?'})`)
    })
    const byCat: Record<string, number> = {}
    expenses.forEach(e => { byCat[e.category] = (byCat[e.category] ?? 0) + e.amount })
    lines.push(``, `📊 ${t('summary.byCategory')}`)
    Object.entries(byCat).sort(([, a], [, b]) => b - a).forEach(([cat, amt]) => {
      const def = CATEGORIES[cat as keyof typeof CATEGORIES] ?? CATEGORIES.other
      lines.push(`  ${def.emoji} ${def.label}: ${sym}${formatNumber(amt)}`)
    })
    if (transfers.length > 0) {
      lines.push(``, `✅ ${t('summary.toSettleUp')}`)
      transfers.forEach(tr => lines.push(`  ${tr.fromName} → ${tr.toName}: ${sym}${formatNumber(tr.amount)}`))
    } else {
      lines.push(``, `✅ ${t('summary.allSettled')}`)
    }
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>
  if (!group) return null

  const sym        = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const total      = expenses.reduce((s, e) => s + e.amount, 0)
  const byCat: Record<string, number> = {}
  expenses.forEach(e => { byCat[e.category] = (byCat[e.category] ?? 0) + e.amount })
  const sortedCats = Object.entries(byCat).sort(([, a], [, b]) => b - a)
  const maxAbs     = Math.max(...Object.values(netBalances).map(Math.abs), 1)

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => router.push(`/group/${token}`)}>
          <i className="fa-solid fa-arrow-left" style={{ fontSize: 13 }} /> Back
        </a>
        <span className="navbar-title">{t('summary.title')}</span>
        <button className="btn btn-ghost" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }} onClick={copyAsText}>
          <i className="fa-solid fa-copy" style={{ fontSize: 13 }} />{copied ? t('summary.copied') : t('summary.copy')}
        </button>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 6 }}>{group.name}</p>
          <p style={{ fontSize: 40, fontWeight: 700, fontFamily: 'DM Mono, monospace', letterSpacing: '-0.03em', marginBottom: 4 }}>
            {sym}{formatNumber(total)}
          </p>
        </div>

        {/* Member balance rows — each is a link to the member detail page */}
        <div>
          <p className="section-title">{t('summary.byMember')}</p>
          <div className="card" style={{ padding: '4px 20px' }}>
            {members.map(m => {
              const net  = netBalances[m.id] ?? 0
              const pct  = Math.abs(net / total) * 100
              const barW = net / maxAbs * 50
              // const involvedCount = expenses.filter(e => e.paid_by === m.id).length
              return (
                <div key={m.id} onClick={() => router.push(`/group/${token}/member/${m.id}`)}
                  style={{ padding: '14px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div className="expense-avatar">{m.name.slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</p>
                      <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>{Math.round(pct)}%</p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color: net > thresholdMismatch ? 'var(--success)' : net < -thresholdMismatch ? 'var(--danger)' : 'var(--ink-3)' }}>
                        {sym}{formatNumber(net)}
                      </p>
                      <p style={{ fontSize: 10, color: net > thresholdMismatch ? 'var(--success)' : net < -thresholdMismatch ? 'var(--danger)' : 'var(--ink-3)' }}>
                        {net > thresholdMismatch ? t('settle.getsBack') : net < -thresholdMismatch ? t('settle.owes') : 'even'}
                      </p>
                    </div>
                    <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }} />
                  </div>
                  <div style={{ position: 'relative', height: 6, background: 'var(--surface-3)', borderRadius: 3 }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border-2)', zIndex: 1 }} />
                    <div style={{ position: 'absolute', top: 0, height: '100%', borderRadius: 3, width: `${Math.abs(barW)}%`, left: `${Math.min(barW, 0) + 50}%`, background: net >= 0 ? 'var(--success)' : 'var(--danger)', transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* By category */}
        {sortedCats.length > 0 && (
          <div>
            <p className="section-title">{t('summary.byCategory')}</p>
            <div className="card" style={{ padding: '8px 20px' }}>
              {sortedCats.map(([cat, amt]) => {
                const def      = CATEGORIES[cat as keyof typeof CATEGORIES] ?? CATEGORIES.other
                const pct      = total > 0 ? (amt / total) * 100 : 0
                const catLabel = t(`categories.${cat}`) || def.label
                return (
                  <div key={cat} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 20 }}>{def.emoji}</span>
                      <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{catLabel}</span>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500 }}>{sym}{formatNumber(amt)}</span>
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

        {/* Full expense list */}
        <div>
          <p className="section-title">
            {t('summary.allExpenses')}
            : {expenses.length !== 1 ? t('summary.expenseCountPlural', { count: expenses.length }) : t('summary.expenseCount', { count: 1 })}
          </p>
          <div className="card" style={{ padding: '4px 20px' }}>
            {expenses.map(e => {
              const cat       = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
              const isForeign = e.original_currency && e.original_currency !== group.currency
              return (
                <div key={e.id} className="expense-item">
                  <div className="expense-avatar" style={{ background: cat.color + '18', fontSize: 18 }}>{cat.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="expense-label">{e.label || 'Expense'}</p>
                    <p className="expense-meta">
                      {e.expense_date}
                      {isForeign && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>· {CURRENCY_SYMBOLS[e.original_currency!] ?? e.original_currency}{formatNumber(Number(e.original_amount))} {e.original_currency}</span>}
                    </p>
                  </div>
                  <p className="expense-amount">{sym}{formatNumber(Number(e.amount))}</p>
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
