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
type PayerMode = 'single' | 'multiple'
type PageProps = { params: Promise<{ token: string }> }

export default function AddExpensePage({ params }: PageProps) {
  const router = useRouter()
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [group, setGroup] = useState<{ id: string; currency: string } | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<CategoryKey>('general')
  const [expCurrency, setExpCurrency] = useState('')
  const [rates, setRates] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)

  // Payer state
  const [payerMode, setPayerMode] = useState<PayerMode>('single')
  const [singlePayer, setSinglePayer] = useState('')
  const [multiPayerAmounts, setMultiPayerAmounts] = useState<Record<string, string>>({})

  // Split state
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')
  const [equalSet, setEqualSet] = useState<Set<string>>(new Set())
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [customPercents, setCustomPercents] = useState<Record<string, string>>({})

  // Calculator state
  const [showCalculator, setShowCalculator] = useState(false)
  const [calcDisplay, setCalcDisplay] = useState('0')
  const [calcMemory, setCalcMemory] = useState<number | null>(null)
  const [calcOperation, setCalcOperation] = useState<string | null>(null)

  useEffect(() => { params.then(p => setToken(p.token)) }, [params])

  useEffect(() => {
    if (!token) return
    ;(async () => {
      const { data: grp } = await supabase.from('groups').select('*').eq('share_token', token).single()
      if (!grp) { setFetching(false); return }
      setGroup(grp); setExpCurrency(grp.currency)
      const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id)
      const m: Member[] = mems ?? []
      setMembers(m)
      setEqualSet(new Set(m.map(x => x.id)))
      if (m.length > 0) setSinglePayer(m[0].id)
      const share = m.length > 0 ? (100 / m.length).toFixed(1) : '0'
      const amtInit: Record<string, string> = {}; const pctInit: Record<string, string> = {}; const payInit: Record<string, string> = {}
      m.forEach(mem => { amtInit[mem.id] = ''; pctInit[mem.id] = share; payInit[mem.id] = '' })
      setCustomAmounts(amtInit); setCustomPercents(pctInit); setMultiPayerAmounts(payInit)
      const r = await getRates(grp.currency); setRates(r)
      setFetching(false)
    })()
  }, [token])

  const baseCurrency = group?.currency ?? 'JPY'
  const isForeign = expCurrency !== baseCurrency
  // For single payer: convert input amount to base
  const baseAmount = isForeign && rates[expCurrency] ? Number(amount) / rates[expCurrency] : Number(amount)
  const baseSym = CURRENCY_SYMBOLS[baseCurrency] ?? baseCurrency
  const sym = CURRENCY_SYMBOLS[expCurrency] ?? expCurrency

  // Multiple payer total
  const multiPayerTotal = members.reduce((s, m) => s + Number(multiPayerAmounts[m.id] || 0), 0)
  const effectiveBaseAmount = payerMode === 'single' ? baseAmount : multiPayerTotal

  // Build payers array
  const buildPayers = (): { memberId: string; amount: number }[] | null => {
    if (payerMode === 'single') {
      if (!singlePayer || baseAmount <= 0) return null
      return [{ memberId: singlePayer, amount: baseAmount }]
    }
    const entries = members.map(m => ({ memberId: m.id, amount: Number(multiPayerAmounts[m.id] || 0) })).filter(e => e.amount > 0)
    return entries.length > 0 ? entries : null
  }

  // Build splits array
  const buildSplits = (): { memberId: string; amount: number }[] | null => {
    const total = effectiveBaseAmount
    if (splitMode === 'equal') {
      if (equalSet.size === 0 || total <= 0) return null
      const share = total / equalSet.size
      return Array.from(equalSet).map(id => ({ memberId: id, amount: share }))
    }
    if (splitMode === 'amount') {
      const entries = members.map(m => ({ memberId: m.id, amount: Number(customAmounts[m.id] || 0) })).filter(e => e.amount > 0)
      return entries.length ? entries : null
    }
    if (splitMode === 'percent') {
      const entries = members.map(m => ({ memberId: m.id, amount: (Number(customPercents[m.id] || 0) / 100) * total })).filter(e => e.amount > 0.001)
      return entries.length ? entries : null
    }
    return null
  }

  const amountSum = members.reduce((s, m) => s + Number(customAmounts[m.id] || 0), 0)
  const percentSum = members.reduce((s, m) => s + Number(customPercents[m.id] || 0), 0)
  const amountMismatch = splitMode === 'amount' && effectiveBaseAmount > 0 && Math.abs(amountSum - effectiveBaseAmount) > 0.5
  const percentMismatch = splitMode === 'percent' && Math.abs(percentSum - 100) > 0.5
  const multiPayerMismatch = payerMode === 'multiple' && multiPayerTotal <= 0

  const payers = buildPayers()
  const splits = buildSplits()
  const labelOk = label.trim().length > 0
  const canSubmit = !!(labelOk && payers && splits && !amountMismatch && !percentMismatch && !multiPayerMismatch)

  const toggleEqual = (id: string) => setEqualSet(prev => { const next = new Set(prev); if (next.has(id)) { if (next.size === 1) return prev; next.delete(id) } else next.add(id); return next })
  const perPerson = splitMode === 'equal' && equalSet.size > 0 && effectiveBaseAmount > 0 ? effectiveBaseAmount / equalSet.size : 0

  // Calculator functions
  const calcPress = (value: string) => {
    if (value === 'C') {
      setCalcDisplay('0')
      setCalcMemory(null)
      setCalcOperation(null)
    } else if (value === '=') {
      if (calcMemory !== null && calcOperation) {
        const current = Number(calcDisplay)
        let result = 0
        switch (calcOperation) {
          case '+': result = calcMemory + current; break
          case '-': result = calcMemory - current; break
          case '*': result = calcMemory * current; break
          case '/': result = calcMemory / current; break
        }
        setCalcDisplay(result.toString())
        setCalcMemory(null)
        setCalcOperation(null)
      }
    } else if (['+', '-', '*', '/'].includes(value)) {
      setCalcMemory(Number(calcDisplay))
      setCalcOperation(value)
      setCalcDisplay('0')
    } else {
      setCalcDisplay(calcDisplay === '0' ? value : calcDisplay + value)
    }
  }

  const applyCalcResult = () => {
    setAmount(calcDisplay)
    setShowCalculator(false)
  }

  const handleSubmit = async () => {
    if (!canSubmit || !group || !payers || !splits) return
    setLoading(true)
    try {
      await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: group.id,
          payers,
          splitAmong: splits.map(s => s.memberId),
          splitAmounts: splits.map(s => s.amount),
          label: label.trim(), category,
          originalCurrency: isForeign && payerMode === 'single' ? expCurrency : null,
          originalAmount: isForeign && payerMode === 'single' ? Number(amount) : null,
          exchangeRate: isForeign && payerMode === 'single' ? (1 / (rates[expCurrency] ?? 1)) : null,
        }),
      })
      router.push(`/group/${token}`)
    } catch { setLoading(false) }
  }

  if (fetching) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer' }} onClick={() => router.back()}>{t('nav.back')}</a>
        <span className="navbar-title">{t('add.title')}</span>
        <LangPicker />
      </nav>

      <div className="container">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Category */}
          <div>
          <label>{t('add.label')}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* <label>{t('add.category')}</label> */}
            <select
              value={category}
              onChange={e => setCategory(e.target.value as CategoryKey)}
              style={{ width: 140, minWidth: 140, maxWidth: 180 }}
            >
              {CATEGORY_KEYS.map(k => { const cat = CATEGORIES[k]; return (
                <option key={k} value={k}>{cat.emoji} {cat.label}</option>
              )})}
            </select>
            <div style={{ position: 'relative', flex: 1 }}>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder={t('add.labelPlaceholder')} autoFocus />
            </div>
          </div>
          </div>

          {/* Payer section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ margin: 0 }}>{t('add.paidByMode')}</label>

              <div style={{ display: 'flex', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                {(['single', 'multiple'] as PayerMode[]).map(mode => (
                  <button key={mode} onClick={() => setPayerMode(mode)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', border: 'none', borderRight: mode === 'single' ? '1px solid var(--border-2)' : 'none', cursor: 'pointer', background: payerMode === mode ? 'var(--ink)' : 'var(--surface)', color: payerMode === mode ? 'white' : 'var(--ink-2)', transition: 'all 0.12s' }}>
                    {mode === 'single' ? t('add.paidBySingle') : t('add.paidByMultiple')}
                  </button>
                ))}
              </div>
            </div>

            {/* Single payer: currency + amount + who */}
            {payerMode === 'single' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label>{t('add.amount')}</label>
                  <div className="row" style={{ gap: 8 }}>
                    <select value={expCurrency} onChange={e => setExpCurrency(e.target.value)} style={{ width: 90, flexShrink: 0 }}>
                      {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" min="0" step="any" style={{ flex: 1, fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 500 }} />
                      <button
                        onClick={() => setShowCalculator(!showCalculator)}
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 32,
                          height: 32,
                          border: 'none',
                          background: 'var(--surface-2)',
                          borderRadius: 4,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18
                        }}
                        title="Calculator"
                      >
                        🧮
                      </button>
                      {showCalculator && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          zIndex: 1000,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)',
                          padding: 12,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          minWidth: 200
                        }}>
                          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, textAlign: 'right', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 4, marginBottom: 8 }}>
                            {calcDisplay}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
                            {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', 'C', '=', '+'].map(btn => (
                              <button
                                key={btn}
                                onClick={() => calcPress(btn)}
                                style={{
                                  padding: '8px',
                                  fontSize: 14,
                                  fontFamily: 'DM Mono, monospace',
                                  border: '1px solid var(--border-2)',
                                  borderRadius: 4,
                                  background: 'var(--surface)',
                                  cursor: 'pointer',
                                  transition: 'all 0.1s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'var(--surface)'}
                              >
                                {btn}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={applyCalcResult}
                            style={{
                              width: '100%',
                              padding: '8px',
                              background: 'var(--ink)',
                              color: 'white',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontSize: 14
                            }}
                          >
                            Use Amount
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {isForeign && baseAmount > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
                      {t('add.conversionHint', { amount: `${baseSym}${baseAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, currency: baseCurrency })}
                      {rates[expCurrency] ? ` (1 ${expCurrency} = ${(1 / rates[expCurrency]).toFixed(2)} ${baseCurrency})` : ''}
                    </p>
                  )}
                </div>
                <div>
                  <label>{t('add.paidBy')}</label>
                  <select value={singlePayer} onChange={e => setSinglePayer(e.target.value)}>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* Multiple payers: amount per person in base currency */}
            {payerMode === 'multiple' && (
              <div className="card" style={{ padding: '4px 16px' }}>
                {members.map(m => (
                  <div key={m.id} className="check-row" style={{ cursor: 'default' }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{m.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <select value={expCurrency} onChange={e => setExpCurrency(e.target.value)} style={{ width: 70, height: 32, flexShrink: 0, fontSize: 14}}>
                        {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        type="number" min="0" step="any"
                        value={multiPayerAmounts[m.id] ?? ''}
                        onChange={e => setMultiPayerAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                        style={{ width: 150, height: 32, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14 }}
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
                {multiPayerTotal > 0 && (
                  <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      Total: {baseSym}{multiPayerTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Split section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ margin: 0 }}>{t('add.splitAmong')}</label>
              <div style={{ display: 'flex', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                {(['equal', 'amount', 'percent'] as SplitMode[]).map(mode => (
                  <button key={mode} onClick={() => setSplitMode(mode)} style={{ padding: '5px 10px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', border: 'none', borderRight: mode !== 'percent' ? '1px solid var(--border-2)' : 'none', cursor: 'pointer', background: splitMode === mode ? 'var(--ink)' : 'var(--surface)', color: splitMode === mode ? 'white' : 'var(--ink-2)', transition: 'all 0.12s' }}>
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
                {effectiveBaseAmount > 0 && (
                  <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: amountMismatch ? 'var(--danger)' : 'var(--ink-3)' }}>
                      {`${baseSym}${Math.round(amountSum).toLocaleString()} / ${baseSym}${Math.round(effectiveBaseAmount).toLocaleString()}  ` + (amountMismatch ? t('add.totalMismatch', { total: `${baseSym}${Math.round(effectiveBaseAmount - amountSum).toLocaleString()}` }) : '✓')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {splitMode === 'percent' && (
              <div className="card" style={{ padding: '4px 16px' }}>
                {members.map(m => { const pct = Number(customPercents[m.id] || 0); const memberAmt = effectiveBaseAmount > 0 ? (pct / 100) * effectiveBaseAmount : 0; return (
                  <div key={m.id} className="check-row" style={{ cursor: 'default' }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{m.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {memberAmt > 0 && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'DM Mono, monospace' }}>{baseSym}{Math.round(memberAmt).toLocaleString()}</span>}
                      <input type="number" min="0" max="100" step="0.1" value={customPercents[m.id] ?? ''} onChange={e => setCustomPercents(prev => ({ ...prev, [m.id]: e.target.value }))} style={{ width: 64, height: 32, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13 }} placeholder="0" />
                      <span style={{ fontSize: 13, color: 'var(--ink-3)', width: 12 }}>%</span>
                    </div>
                  </div>
                )})}
                <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: percentMismatch ? 'var(--danger)' : 'var(--success)' }}>
                    {`${percentSum.toFixed(1)}%  ` + (percentMismatch ? t('add.percentMismatch') : '✓')}
                  </span>
                </div>
              </div>
            )}
          </div>

          <button className="btn btn-primary" disabled={!canSubmit || loading} onClick={handleSubmit}>
            {loading ? t('add.saving') : t('add.save')}
          </button>
        </div>
      </div>
    </>
  )
}
