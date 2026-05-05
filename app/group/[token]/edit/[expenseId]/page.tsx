'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member } from '@/lib/supabase'
import { CATEGORIES, CATEGORY_KEYS, type CategoryKey } from '@/lib/categories'
import { getRates, SUPPORTED_CURRENCIES, CURRENCY_SYMBOLS } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import LangPicker from '@/components/LangPicker'

type SplitMode = 'equal' | 'amount' | 'percent'
type PageProps = { params: Promise<{ token: string; expenseId: string }> }

export default function EditExpensePage({ params }: PageProps) {
  const router = useRouter()
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [expenseId, setExpenseId] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [category, setCategory] = useState<CategoryKey>('other')
  const [expCurrency, setExpCurrency] = useState('')
  const [rates, setRates] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')
  const [equalSet, setEqualSet] = useState<Set<string>>(new Set())
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [customPercents, setCustomPercents] = useState<Record<string, string>>({})

  useEffect(() => { params.then(p => { setToken(p.token); setExpenseId(p.expenseId) }) }, [params])

  useEffect(() => {
    if (!token || !expenseId) return
    ;(async () => {
      const { data: grp } = await supabase.from('groups').select('*').eq('share_token', token).single()
      if (!grp) { setFetching(false); return }
      setGroup(grp)
      const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id)
      const memberList: Member[] = mems ?? []
      setMembers(memberList)
      const { data: exp } = await supabase.from('expenses').select('*').eq('id', expenseId).single()
      if (!exp) { setFetching(false); return }
      setLabel(exp.label ?? '')
      setCategory((exp.category as CategoryKey) ?? 'other')
      setPaidBy(exp.paid_by)
      if (exp.original_currency && exp.original_amount) {
        setExpCurrency(exp.original_currency); setAmount(String(exp.original_amount))
      } else {
        setExpCurrency(grp.currency); setAmount(String(exp.amount))
      }
      const { data: splits } = await supabase.from('expense_splits').select('member_id, amount').eq('expense_id', expenseId)
      if (splits && splits.length > 0) {
        // Detect mode: check if all splits are equal
        const splitIds = splits.map((s: { member_id: string }) => s.member_id)
        setEqualSet(new Set(splitIds))
        const amtMap: Record<string, string> = {}
        const pctMap: Record<string, string> = {}
        const total = splits.reduce((s: number, x: { amount: number }) => s + Number(x.amount), 0)
        splits.forEach((s: { member_id: string; amount: number }) => {
          amtMap[s.member_id] = String(Number(s.amount).toFixed(2))
          pctMap[s.member_id] = total > 0 ? ((Number(s.amount) / total) * 100).toFixed(1) : '0'
        })
        memberList.forEach(m => { if (!amtMap[m.id]) amtMap[m.id] = ''; if (!pctMap[m.id]) pctMap[m.id] = '0' })
        setCustomAmounts(amtMap); setCustomPercents(pctMap)
      } else {
        const init = new Set(memberList.map(m => m.id)); setEqualSet(init)
        const amtInit: Record<string, string> = {}; const pctInit: Record<string, string> = {}
        memberList.forEach(m => { amtInit[m.id] = ''; pctInit[m.id] = (100 / memberList.length).toFixed(1) })
        setCustomAmounts(amtInit); setCustomPercents(pctInit)
      }
      const r = await getRates(grp.currency); setRates(r)
      setFetching(false)
    })()
  }, [token, expenseId])

  const baseCurrency = group?.currency ?? 'JPY'
  const isForeign = expCurrency !== baseCurrency
  const baseAmount = isForeign && rates[expCurrency] ? Number(amount) / rates[expCurrency] : Number(amount)
  const baseSym = CURRENCY_SYMBOLS[baseCurrency] ?? baseCurrency

  const computeSplits = () => {
    if (splitMode === 'equal') { if (equalSet.size === 0) return null; const share = baseAmount / equalSet.size; return Array.from(equalSet).map(id => ({ memberId: id, amount: share })) }
    if (splitMode === 'amount') { const entries = members.map(m => ({ memberId: m.id, amount: Number(customAmounts[m.id] || 0) })).filter(e => e.amount > 0); return entries.length ? entries : null }
    if (splitMode === 'percent') { const entries = members.map(m => ({ memberId: m.id, amount: (Number(customPercents[m.id] || 0) / 100) * baseAmount })).filter(e => e.amount > 0.001); return entries.length ? entries : null }
    return null
  }

  const amountSum = members.reduce((s, m) => s + Number(customAmounts[m.id] || 0), 0)
  const percentSum = members.reduce((s, m) => s + Number(customPercents[m.id] || 0), 0)
  const amountMismatch = splitMode === 'amount' && baseAmount > 0 && Math.abs(amountSum - baseAmount) > 0.5
  const percentMismatch = splitMode === 'percent' && Math.abs(percentSum - 100) > 0.5
  const splits = computeSplits()
  const canSubmit = !!(label.trim() && Number(amount) > 0 && paidBy && splits && !amountMismatch && !percentMismatch)

  const toggleEqual = (id: string) => setEqualSet(prev => { const next = new Set(prev); if (next.has(id)) { if (next.size === 1) return prev; next.delete(id) } else next.add(id); return next })
  const perPerson = splitMode === 'equal' && equalSet.size > 0 && baseAmount > 0 ? baseAmount / equalSet.size : 0

  const handleSubmit = async () => {
    if (!canSubmit || !expenseId || !splits) return
    setLoading(true)
    try {
      await fetch('/api/expenses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseId, paidBy, amount: baseAmount, label: label.trim(), splitAmong: splits.map(s => s.memberId), splitAmounts: splits.map(s => s.amount), category, originalCurrency: isForeign ? expCurrency : null, originalAmount: isForeign ? Number(amount) : null, exchangeRate: isForeign ? (1 / (rates[expCurrency] ?? 1)) : null }),
      })
      router.push(`/group/${token}`)
    } catch { setLoading(false) }
  }

  if (fetching) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer' }} onClick={() => router.back()}>{t('nav.back')}</a>
        <span className="navbar-title">{t('edit.title')}</span>
        <LangPicker />
      </nav>
      <div className="container">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Category */}
          <div>
            <label>{t('add.category')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {CATEGORY_KEYS.map(k => { const cat = CATEGORIES[k]; const active = category === k; return (<button key={k} onClick={() => setCategory(k)} style={{ border: `1px solid ${active ? cat.color : 'var(--border-2)'}`, borderRadius: 'var(--radius-sm)', padding: '10px 6px 8px', background: active ? cat.color + '18' : 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}><span style={{ fontSize: 22 }}>{cat.emoji}</span><span style={{ fontSize: 11, fontWeight: 500, color: active ? cat.color : 'var(--ink-3)' }}>{cat.label.split(' ')[0]}</span></button>) })}
            </div>
          </div>
          {/* Label */}
          <div>
            <label>{t('add.label')}</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder={t('add.labelPlaceholder')} autoFocus />
          </div>
          {/* Amount + currency */}
          <div>
            <label>{t('add.amount')}</label>
            <div className="row" style={{ gap: 8 }}>
              <select value={expCurrency} onChange={e => setExpCurrency(e.target.value)} style={{ width: 90, flexShrink: 0 }}>
                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" min="0" step="any" style={{ flex: 1, fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 500 }} />
            </div>
            {isForeign && baseAmount > 0 && <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>≈ {baseSym}{baseAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}</p>}
          </div>
          {/* Paid by */}
          <div>
            <label>{t('add.paidBy')}</label>
            <select value={paidBy} onChange={e => setPaidBy(e.target.value)}>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {/* Split */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ margin: 0 }}>{t('add.splitAmong')}</label>
              <div style={{ display: 'flex', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                {(['equal', 'amount', 'percent'] as SplitMode[]).map(mode => (
                  <button key={mode} onClick={() => setSplitMode(mode)} style={{ padding: '5px 10px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', border: 'none', borderRight: mode !== 'percent' ? '1px solid var(--border-2)' : 'none', cursor: 'pointer', background: splitMode === mode ? 'var(--ink)' : 'var(--surface)', color: splitMode === mode ? 'white' : 'var(--ink-2)' }}>
                    {t(`add.split${mode.charAt(0).toUpperCase() + mode.slice(1)}` as 'add.splitEqual')}
                  </button>
                ))}
              </div>
            </div>
            {splitMode === 'equal' && (
              <div className="card" style={{ padding: '4px 16px' }}>
                {members.map(m => (
                  <label key={m.id} className="check-row" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, cursor: 'pointer', marginBottom: 0 }}>
                    <input type="checkbox" checked={equalSet.has(m.id)} onChange={() => toggleEqual(m.id)} />
                    <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{m.name}</span>
                    {perPerson > 0 && equalSet.has(m.id) && <span style={{ fontSize: 13, color: 'var(--ink-3)', fontFamily: 'DM Mono, monospace' }}>{baseSym}{Math.round(perPerson).toLocaleString()}</span>}
                  </label>
                ))}
              </div>
            )}
            {splitMode === 'amount' && (
              <div className="card" style={{ padding: '4px 16px' }}>
                {members.map(m => (
                  <div key={m.id} className="check-row" style={{ cursor: 'default' }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{m.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{baseSym}</span>
                      <input type="number" min="0" step="any" value={customAmounts[m.id] ?? ''} onChange={e => setCustomAmounts(prev => ({ ...prev, [m.id]: e.target.value }))} style={{ width: 80, height: 32, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13 }} placeholder="0" />
                    </div>
                  </div>
                ))}
                {baseAmount > 0 && <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}><span style={{ fontSize: 12, color: amountMismatch ? 'var(--danger)' : 'var(--ink-3)' }}>{amountMismatch ? t('add.totalMismatch', { total: `${baseSym}${Math.round(baseAmount).toLocaleString()}` }) : `${baseSym}${Math.round(amountSum).toLocaleString()} / ${baseSym}${Math.round(baseAmount).toLocaleString()}`}</span></div>}
              </div>
            )}
            {splitMode === 'percent' && (
              <div className="card" style={{ padding: '4px 16px' }}>
                {members.map(m => { const pct = Number(customPercents[m.id] || 0); const memberAmt = baseAmount > 0 ? (pct / 100) * baseAmount : 0; return (
                  <div key={m.id} className="check-row" style={{ cursor: 'default' }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{m.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {memberAmt > 0 && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'DM Mono, monospace' }}>{baseSym}{Math.round(memberAmt).toLocaleString()}</span>}
                      <input type="number" min="0" max="100" step="0.1" value={customPercents[m.id] ?? ''} onChange={e => setCustomPercents(prev => ({ ...prev, [m.id]: e.target.value }))} style={{ width: 64, height: 32, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13 }} placeholder="0" />
                      <span style={{ fontSize: 13, color: 'var(--ink-3)', width: 12 }}>%</span>
                    </div>
                  </div>
                ) })}
                <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}><span style={{ fontSize: 12, color: percentMismatch ? 'var(--danger)' : 'var(--success)' }}>{percentMismatch ? t('add.percentMismatch') : `${percentSum.toFixed(1)}% ✓`}</span></div>
              </div>
            )}
          </div>
          <button className="btn btn-primary" disabled={!canSubmit || loading} onClick={handleSubmit}>
            {loading ? t('edit.saving') : t('edit.save')}
          </button>
        </div>
      </div>
    </>
  )
}
