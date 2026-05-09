'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Member } from '@/lib/supabase'
import { CATEGORIES, CATEGORY_KEYS, type CategoryKey } from '@/lib/categories'
import { getRates, SUPPORTED_CURRENCIES, CURRENCY_SYMBOLS } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import { useGroup } from '@/hooks/useGroup'
import LangPicker from '@/components/LangPicker'
import { DeleteModal, SuccessPopup } from '@/components/PopupModal'
import { writeDraft, invalidateExpenseCache } from '@/lib/expense-cache'
import type { DraftExpense } from '@/lib/expense-cache'

// ─── Types ────────────────────────────────────────────────────────────────────

type SplitMode = 'equal' | 'amount' | 'percent'
type PayerMode = 'single' | 'multiple'

export type ExpenseFormMode =
  | { type: 'add'; token: string }
  | { type: 'edit'; token: string; expenseId: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().split('T')[0]

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExpenseForm({ mode }: { mode: ExpenseFormMode }) {
  const router = useRouter()
  const { t, locale } = useI18n()

  const isEdit = mode.type === 'edit'
  const { token } = mode
  const expenseId = isEdit ? mode.expenseId : null

  // ── Group & members (single-query via useGroup) ──
  const { loading: groupLoading, group, members } = useGroup(token)
  const [rates, setRates] = useState<Record<string, number>>({})
  const [fetching, setFetching] = useState(true)

  // ── Form fields ──
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<CategoryKey>('general')
  const [expCurrency, setExpCurrency] = useState('')
  const [expenseDate, setExpenseDate] = useState(todayStr())

  // ── Payer state ──
  const [payerMode, setPayerMode] = useState<PayerMode>('single')
  const [singlePayer, setSinglePayer] = useState('')
  const [multiPayerAmounts, setMultiPayerAmounts] = useState<Record<string, string>>({})

  // ── Split state ──
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')
  const [equalSet, setEqualSet] = useState<Set<string>>(new Set())
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [customPercents, setCustomPercents] = useState<Record<string, string>>({})

  // ── Calculator state ──
  const [showCalculator, setShowCalculator] = useState(false)
  const [calcDisplay, setCalcDisplay] = useState('0')
  const [calcMemory, setCalcMemory] = useState<number | null>(null)
  const [calcOperation, setCalcOperation] = useState<string | null>(null)

  // ── UI state ──
  const [loading, setLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)

  // ─── Delete expense (optimistic: navigate first, delete in background) ────
  const [deleting, setDeleting] = useState<string | null>(null)

  const deleteExpense = async (id: string) => {
    setDeleting(id)
    setDeleteTarget(null)
    // Navigate immediately for snappy UX
    router.push(`/group/${token}`)
    // Fire DELETE in background — group page Realtime will confirm
    fetch(`/api/expenses?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token ?? '')}`, {
      method: 'DELETE',
    }).catch(console.error)
    // Invalidate cache so the group page won't show the deleted item from cache
    invalidateExpenseCache(id)
    console.log('Expense delete requested:', id)
    setDeleting(null)
  }

  // ─── Load group + members (+ expense data when editing) ───────────────────

  useEffect(() => {
    if (!group || members.length === 0) return
    ;(async () => {
      const memberList = members

      if (isEdit && expenseId) {
        // ── Edit: pre-fill from existing expense + payers/splits in parallel ──
        const [{ data: exp }, { data: payerRows }, { data: splitRows }] = await Promise.all([
          supabase.from('expenses').select('*').eq('id', expenseId).single(),
          supabase.from('expense_payers').select('member_id, amount').eq('expense_id', expenseId),
          supabase.from('expense_splits').select('member_id, amount').eq('expense_id', expenseId),
        ])

        if (!exp) { setFetching(false); return }

        setLabel(exp.label ?? '')
        setCategory((exp.category as CategoryKey) ?? 'general')
        if (exp.expense_date) setExpenseDate(exp.expense_date)

        if (exp.original_currency && exp.original_amount) {
          setExpCurrency(exp.original_currency)
          setAmount(String(exp.original_amount))
        } else {
          setExpCurrency(group.currency)
          setAmount(String(exp.amount))
        }

        // Pre-fill payers
        if (payerRows?.length) {
          if (payerRows.length === 1) {
            setPayerMode('single')
            setSinglePayer(payerRows[0].member_id)
          } else {
            setPayerMode('multiple')
            const payMap: Record<string, string> = {}
            payerRows.forEach(p => { payMap[p.member_id] = String(p.amount) })
            setMultiPayerAmounts(payMap)
          }
        }

        // Pre-fill splits
        if (splitRows?.length) {
          setEqualSet(new Set(splitRows.map((s: { member_id: string }) => s.member_id)))
          const total = splitRows.reduce((s: number, x: { amount: number }) => s + Number(x.amount), 0)
          const amtMap: Record<string, string> = {}
          const pctMap: Record<string, string> = {}
          splitRows.forEach((s: { member_id: string; amount: number }) => {
            amtMap[s.member_id] = Number(s.amount).toFixed(2)
            pctMap[s.member_id] = total > 0 ? ((Number(s.amount) / total) * 100).toFixed(1) : '0'
          })
          memberList.forEach(m => { amtMap[m.id] ??= ''; pctMap[m.id] ??= '0' })
          setCustomAmounts(amtMap)
          setCustomPercents(pctMap)

          const amounts = splitRows.map((s: { amount: number }) => Number(s.amount)).filter((a: number) => a > 0)
          const isEqual = amounts.length > 1 && amounts.every((a: number) => Math.abs(a - amounts[0]) < 0.5)
          if (!isEqual) setSplitMode('amount')
        } else {
          const amtInit: Record<string, string> = {}
          const pctInit: Record<string, string> = {}
          memberList.forEach(m => { amtInit[m.id] = ''; pctInit[m.id] = (100 / memberList.length).toFixed(1) })
          setEqualSet(new Set(memberList.map(m => m.id)))
          setCustomAmounts(amtInit)
          setCustomPercents(pctInit)
        }

      } else {
        // ── Add: sensible defaults ──
        setExpCurrency(group.currency)
        setEqualSet(new Set(memberList.map(x => x.id)))
        if (memberList.length > 0) setSinglePayer(memberList[0].id)

        const share = memberList.length > 0 ? (100 / memberList.length).toFixed(1) : '0'
        const amtInit: Record<string, string> = {}
        const pctInit: Record<string, string> = {}
        const payInit: Record<string, string> = {}
        memberList.forEach(m => { amtInit[m.id] = ''; pctInit[m.id] = share; payInit[m.id] = '' })
        setCustomAmounts(amtInit)
        setCustomPercents(pctInit)
        setMultiPayerAmounts(payInit)
      }

      setRates(await getRates(group.currency))
      setFetching(false)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, members, isEdit, expenseId])

  // ─── Derived values ───────────────────────────────────────────────────────

  const baseCurrency = group?.currency ?? 'JPY'
  const isForeign = expCurrency !== baseCurrency
  const baseAmount = isForeign && rates[expCurrency] ? Number(amount) / rates[expCurrency] : Number(amount)
  const baseSym = CURRENCY_SYMBOLS[baseCurrency] ?? baseCurrency
  const currSym = CURRENCY_SYMBOLS[expCurrency] ?? expCurrency

  // FIX: convert multiPayerTotal to base currency before comparing
  const multiPayerTotalInExp = members.reduce((s, m) => s + Number(multiPayerAmounts[m.id] || 0), 0)
  const multiPayerBaseTotal = isForeign && rates[expCurrency]
    ? multiPayerTotalInExp / rates[expCurrency]
    : multiPayerTotalInExp
  const effectiveBaseAmount = payerMode === 'single' ? baseAmount : multiPayerBaseTotal

  // ─── Build payers / splits ────────────────────────────────────────────────

  const buildPayers = (): { memberId: string; amount: number }[] | null => {
    if (payerMode === 'single') {
      if (!singlePayer || baseAmount <= 0) return null
      return [{ memberId: singlePayer, amount: baseAmount }]
    }
    const entries = members
      .map(m => ({ memberId: m.id, amount: Number(multiPayerAmounts[m.id] || 0) }))
      .filter(e => e.amount > 0)
    return entries.length ? entries : null
  }

  const buildSplits = (): { memberId: string; amount: number }[] | null => {
    const total = effectiveBaseAmount
    if (splitMode === 'equal') {
      if (equalSet.size === 0 || total <= 0) return null
      const share = total / equalSet.size
      return Array.from(equalSet).map(id => ({ memberId: id, amount: share }))
    }
    if (splitMode === 'amount') {
      const entries = members
        .map(m => ({ memberId: m.id, amount: Number(customAmounts[m.id] || 0) }))
        .filter(e => e.amount > 0)
      return entries.length ? entries : null
    }
    if (splitMode === 'percent') {
      const entries = members
        .map(m => ({ memberId: m.id, amount: (Number(customPercents[m.id] || 0) / 100) * total }))
        .filter(e => e.amount > 0.001)
      return entries.length ? entries : null
    }
    return null
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  const amountSum = members.reduce((s, m) => s + Number(customAmounts[m.id] || 0), 0)
  const percentSum = members.reduce((s, m) => s + Number(customPercents[m.id] || 0), 0)
  const amountMismatch = splitMode === 'amount' && effectiveBaseAmount > 0 && Math.abs(amountSum - effectiveBaseAmount) > 0.5
  const percentMismatch = splitMode === 'percent' && Math.abs(percentSum - 100) > 0.5
  // FIX: compare in base currency, not expense currency
  const multiPayerMismatch = payerMode === 'multiple' && (multiPayerBaseTotal <= 0 || Math.abs(multiPayerBaseTotal - baseAmount) > 0.5)

  const payers = buildPayers()
  const splits = buildSplits()
  const canSubmit = !!(label.trim() && Number(amount) > 0 && payers && splits && !amountMismatch && !percentMismatch && !multiPayerMismatch)

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const toggleEqual = (id: string) => setEqualSet(prev => {
    const next = new Set(prev)
    if (next.has(id)) { if (next.size === 1) return prev; next.delete(id) } else next.add(id)
    return next
  })
  const perPerson = splitMode === 'equal' && equalSet.size > 0 && effectiveBaseAmount > 0
    ? effectiveBaseAmount / equalSet.size : 0

  // ─── Calculator ───────────────────────────────────────────────────────────

  const calcPress = (value: string) => {
    if (value === 'C') {
      setCalcDisplay('0'); setCalcMemory(null); setCalcOperation(null)
    } else if (value === '=') {
      if (calcMemory !== null && calcOperation) {
        const cur = Number(calcDisplay)
        let res = 0
        switch (calcOperation) {
          case '+': res = calcMemory + cur; break
          case '-': res = calcMemory - cur; break
          case '*': res = calcMemory * cur; break
          case '/': res = cur !== 0 ? calcMemory / cur : 0; break
        }
        setCalcDisplay(String(parseFloat(res.toFixed(10))))
        setCalcMemory(null); setCalcOperation(null)
      }
    } else if (['+', '-', '*', '/'].includes(value)) {
      setCalcMemory(Number(calcDisplay)); setCalcOperation(value); setCalcDisplay('0')
    } else {
      setCalcDisplay(calcDisplay === '0' ? value : calcDisplay + value)
    }
  }

  const resetCalculator = () => {
    setCalcDisplay('0'); setCalcMemory(null); setCalcOperation(null)
    setShowCalculator(false)
  }

  // ─── Optimistic cache-on-save ─────────────────────────────────────────────

  const buildDraft = (resolvedPayers: { memberId: string; amount: number }[]): DraftExpense => ({
    id: expenseId ?? crypto.randomUUID(),
    group_id: group!.id,
    label: label.trim(),
    amount: effectiveBaseAmount,
    category,
    paid_by: resolvedPayers[0]?.memberId ?? singlePayer,
    expense_date: expenseDate,
    created_at: new Date().toISOString(),
    original_currency: isForeign ? expCurrency : null,
    original_amount: isForeign ? Number(amount) : null,
    exchange_rate: isForeign ? (1 / (rates[expCurrency] ?? 1)) : null,
    member: members.find(m => m.id === (resolvedPayers[0]?.memberId ?? singlePayer))
      ? { id: resolvedPayers[0]?.memberId, name: members.find(m => m.id === resolvedPayers[0]?.memberId)?.name ?? '' }
      : undefined,
  })

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit || !group || !payers || !splits) return
    setLoading(true)

    const commonPayload = {
      payers,
      splitAmong: splits.map(s => s.memberId),
      splitAmounts: splits.map(s => s.amount),
      label: label.trim(), category, expenseDate,
      originalCurrency: isForeign && payerMode === 'single' ? expCurrency : null,
      originalAmount:   isForeign && payerMode === 'single' ? Number(amount) : null,
      exchangeRate:     isForeign && payerMode === 'single' ? (1 / (rates[expCurrency] ?? 1)) : null,
      groupToken: token,
    }

    try {
      // 1. Write optimistic draft so the group page renders it instantly
      writeDraft(buildDraft(payers))
      // Invalidate stale list cache so the group page doesn't show old data
      if (group.id) invalidateExpenseCache(group.id)

      // 2. Reset calculator state for next use
      resetCalculator()

      // 3. Navigate immediately — don't wait for the network
      setShowSuccess(true)
      setTimeout(() => router.push(`/group/${token}`), 600)

      // 4. Fire the actual network request in background
      fetch('/api/expenses', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { ...commonPayload, expenseId }
            : { ...commonPayload, groupId: group.id }
        ),
      }).then(async res => {
        if (!res.ok) {
          // Network call failed — show error on the group page via cache bust
          invalidateExpenseCache(group.id)
          console.error('Expense save failed:', await res.text())
        }
        // Push notification — fire and forget
        const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
        const payerName = members.find(m => m.id === payers[0]?.memberId)?.name ?? 'Someone'
        fetch('/api/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupId: group.id,
            title: isEdit ? 'Expense updated' : 'New expense added',
            body: isEdit
              ? `"${label.trim()}" was edited — ${sym}${Math.round(baseAmount).toLocaleString()}`
              : `${payerName} added "${label.trim()}" — ${sym}${Math.round(baseAmount).toLocaleString()}`,
            url: `/group/${token}`,
          }),
        }).catch(() => {})
      }).catch(err => {
        invalidateExpenseCache(group.id)
        console.error('Expense save network error:', err)
      })

    } catch {
      setLoading(false)
    }
  }

  // ─── Loading state ────────────────────────────────────────────────────────

  if (groupLoading || fetching) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p className="text-muted">Loading…</p>
    </div>
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {showSuccess && (
        <SuccessPopup
          message={isEdit ? 'Changes saved!' : 'Expense saved!'}
          onClose={() => setShowSuccess(false)}
        />
      )}
      <style>{`@keyframes slideDown { from { opacity:0; transform: translateX(-50%) translateY(-12px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }`}</style>

      <nav className="navbar">
        <a
          className="btn-ghost btn"
          style={{ width: 'auto', height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => router.back()}
        >
          <i className="fa-solid fa-arrow-left" style={{ fontSize: 13 }} /> Back
        </a>
        <span className="navbar-title">{isEdit ? t('edit.title') : t('add.title')}</span>
        <LangPicker />
      </nav>

      <div className="container">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Category + Date + Label ── */}
          <div>
            <label>{t('add.label')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as CategoryKey)}
                style={{ width: 140, minWidth: 140, maxWidth: 180 }}
              >
                {CATEGORY_KEYS.map(k => {
                  const cat = CATEGORIES[k]
                  const catLabel = t(`categories.${k}`) || cat.label
                  return <option key={k} value={k}>{cat.emoji} {catLabel}</option>
                })}
              </select>
              <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} lang={locale} />
            </div>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={t('add.labelPlaceholder')}
              autoFocus
            />
          </div>

          {/* ── Amount + Currency + Calculator ── */}
          <div>
            <label>{t('add.amount')}</label>
            <div className="row" style={{ gap: 8 }}>
              <select
                value={expCurrency}
                onChange={e => setExpCurrency(e.target.value)}
                style={{ width: 90, flexShrink: 0 }}
              >
                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="number" value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="0" min="0" step="any"
                  style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 500 }}
                />
                <button
                  onClick={() => setShowCalculator(v => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, border: 'none', background: 'var(--surface-2)', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Calculator"
                >
                  <i className="fa-solid fa-calculator" style={{ fontSize: 15 }} />
                </button>
                {showCalculator && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 1000, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 200 }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, textAlign: 'right', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 4, marginBottom: 8 }}>{calcDisplay}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
                      {['7','8','9','/','4','5','6','*','1','2','3','-','0','C','=','+'].map(btn => (
                        <button
                          key={btn} onClick={() => calcPress(btn)}
                          style={{ padding: '8px', fontSize: 14, fontFamily: 'DM Mono, monospace', border: '1px solid var(--border-2)', borderRadius: 4, background: 'var(--surface)', cursor: 'pointer' }}
                          onMouseOver={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                          onMouseOut={e => (e.currentTarget.style.background = 'var(--surface)')}
                        >{btn}</button>
                      ))}
                    </div>
                    <button
                      onClick={() => { setAmount(calcDisplay); resetCalculator() }}
                      style={{ width: '100%', padding: '8px', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}
                    >Use Amount</button>
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

          {/* ── Who paid ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ margin: 0 }}>{t('add.paidByMode')}</label>
              <div style={{ display: 'flex', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                {(['single', 'multiple'] as PayerMode[]).map((m, i) => (
                  <button
                    key={m} onClick={() => setPayerMode(m)}
                    style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', border: 'none', borderRight: i === 0 ? '1px solid var(--border-2)' : 'none', cursor: 'pointer', background: payerMode === m ? 'var(--ink)' : 'var(--surface)', color: payerMode === m ? 'white' : 'var(--ink-2)', transition: 'all 0.12s' }}
                  >
                    {m === 'single' ? t('add.paidBySingle') : t('add.paidByMultiple')}
                  </button>
                ))}
              </div>
            </div>

            {payerMode === 'single' && (
              <div>
                <label>{t('add.paidBy')}</label>
                <select value={singlePayer} onChange={e => setSinglePayer(e.target.value)}>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}

            {payerMode === 'multiple' && (
              <div className="card" style={{ padding: '4px 16px' }}>
                {members.map(m => (
                  <div key={m.id} className="check-row" style={{ cursor: 'default' }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{m.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{currSym}</span>
                      <input
                        type="number" min="0" step="any"
                        value={multiPayerAmounts[m.id] ?? ''}
                        onChange={e => setMultiPayerAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                        style={{ width: 120, height: 32, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14 }}
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
                <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: multiPayerMismatch ? 'var(--danger)' : 'var(--ink-3)' }}>
                    {multiPayerTotalInExp > 0
                      ? `${currSym}${multiPayerTotalInExp.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${currSym}${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}  ${multiPayerMismatch ? `⚠ ${t('add.totalMismatch', { total: `${baseSym}${Math.round(Math.abs(baseAmount - multiPayerBaseTotal)).toLocaleString()}` })}` : '✓'}`
                      : `⚠ ${t('add.paidByAmountHint', { total: `${currSym}${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}` })}`
                    }
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ── Split among ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ margin: 0 }}>{t('add.splitAmong')}</label>
              <div style={{ display: 'flex', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                {(['equal', 'amount', 'percent'] as SplitMode[]).map((m, i) => (
                  <button
                    key={m} onClick={() => setSplitMode(m)}
                    style={{ padding: '5px 10px', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', border: 'none', borderRight: i < 2 ? '1px solid var(--border-2)' : 'none', cursor: 'pointer', background: splitMode === m ? 'var(--ink)' : 'var(--surface)', color: splitMode === m ? 'white' : 'var(--ink-2)', transition: 'all 0.12s' }}
                  >
                    {t(`add.split${m.charAt(0).toUpperCase() + m.slice(1)}` as 'add.splitEqual')}
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
                    {perPerson > 0 && equalSet.has(m.id) && (
                      <span style={{ fontSize: 13, color: 'var(--ink-3)', fontFamily: 'DM Mono, monospace' }}>
                        {baseSym}{Math.round(perPerson).toLocaleString()}
                      </span>
                    )}
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
                      <input
                        type="number" min="0" step="any"
                        value={customAmounts[m.id] ?? ''}
                        onChange={e => setCustomAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                        style={{ width: 80, height: 32, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13 }}
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
                {effectiveBaseAmount > 0 && (
                  <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: amountMismatch ? 'var(--danger)' : 'var(--ink-3)' }}>
                      {`${baseSym}${Math.round(amountSum).toLocaleString()} / ${baseSym}${Math.round(effectiveBaseAmount).toLocaleString()}  `}
                      {amountMismatch ? t('add.totalMismatch', { total: `${baseSym}${Math.round(effectiveBaseAmount - amountSum).toLocaleString()}` }) : '✓'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {splitMode === 'percent' && (
              <div className="card" style={{ padding: '4px 16px' }}>
                {members.map(m => {
                  const pct = Number(customPercents[m.id] || 0)
                  const memberAmt = effectiveBaseAmount > 0 ? (pct / 100) * effectiveBaseAmount : 0
                  return (
                    <div key={m.id} className="check-row" style={{ cursor: 'default' }}>
                      <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{m.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {memberAmt > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'DM Mono, monospace' }}>
                            {baseSym}{Math.round(memberAmt).toLocaleString()}
                          </span>
                        )}
                        <input
                          type="number" min="0" max="100" step="0.1"
                          value={customPercents[m.id] ?? ''}
                          onChange={e => setCustomPercents(prev => ({ ...prev, [m.id]: e.target.value }))}
                          style={{ width: 64, height: 32, textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 13 }}
                          placeholder="0"
                        />
                        <span style={{ fontSize: 13, color: 'var(--ink-3)', width: 12 }}>%</span>
                      </div>
                    </div>
                  )
                })}
                <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: percentMismatch ? 'var(--danger)' : 'var(--success)' }}>
                    {`${percentSum.toFixed(1)}%  `}{percentMismatch ? t('add.percentMismatch') : '✓'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ── Submit ── */}
          <button className="btn btn-primary" disabled={!canSubmit || loading} onClick={handleSubmit}>
            {loading
              ? (isEdit ? t('edit.saving') : t('add.saving'))
              : (isEdit ? t('edit.save') : t('add.save'))
            }
          </button>

          {/* ── Delete (edit mode only) ── */}
          {isEdit && expenseId && (
            <button
              className="btn"
              style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => setDeleteTarget({ id: expenseId, label: label || 'Expense' })}
              disabled={deleting === expenseId}
            >
              {deleting === expenseId
              ? t('group.deleting')
              : (
                <>
                  <i className="fa-solid fa-trash" style={{ fontSize: 13 }} />
                  {t('group.delete')}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {deleteTarget && (
        <DeleteModal
          label={deleteTarget.label}
          confirmTitle={t('group.deleteConfirmTitle')}
          confirmMsg={t('group.deleteConfirmMsg')}
          confirmBtn={t('group.deleteConfirmBtn')}
          cancelBtn={t('group.deleteCancel')}
          onConfirm={() => deleteExpense(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
