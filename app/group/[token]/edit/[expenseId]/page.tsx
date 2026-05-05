'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member } from '@/lib/supabase'

const CURRENCY_SYMBOLS: Record<string, string> = { JPY: '¥', USD: '$', EUR: '€', GBP: '£' }

type PageProps = { params: Promise<{ token: string; expenseId: string }> }

export default function EditExpensePage({ params }: PageProps) {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [expenseId, setExpenseId] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [splitAmong, setSplitAmong] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    params.then(p => {
      setToken(p.token)
      setExpenseId(p.expenseId)
    })
  }, [params])

  useEffect(() => {
    if (!token || !expenseId) return
    ;(async () => {
      // Load group
      const { data: grp } = await supabase
        .from('groups').select('*').eq('share_token', token).single()
      if (!grp) { setFetching(false); return }
      setGroup(grp)

      // Load members
      const { data: mems } = await supabase
        .from('members').select('*').eq('group_id', grp.id)
      setMembers(mems ?? [])

      // Load existing expense
      const { data: exp } = await supabase
        .from('expenses').select('*').eq('id', expenseId).single()
      if (!exp) { setFetching(false); return }

      setLabel(exp.label ?? '')
      setAmount(String(exp.amount))
      setPaidBy(exp.paid_by)

      // Load existing splits
      const { data: splits } = await supabase
        .from('expense_splits').select('member_id').eq('expense_id', expenseId)
      setSplitAmong(new Set((splits ?? []).map((s: { member_id: string }) => s.member_id)))

      setFetching(false)
    })()
  }, [token, expenseId])

  const toggleSplit = (id: string) => {
    setSplitAmong(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const perPerson = splitAmong.size > 0 && amount
    ? Number(amount) / splitAmong.size
    : 0

  const canSubmit = label.trim() && Number(amount) > 0 && paidBy && splitAmong.size > 0

  const handleSubmit = async () => {
    if (!canSubmit || !expenseId) return
    setLoading(true)
    try {
      await fetch('/api/expenses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseId,
          paidBy,
          amount: Number(amount),
          label: label.trim(),
          splitAmong: Array.from(splitAmong),
        }),
      })
      router.push(`/group/${token}`)
    } catch {
      setLoading(false)
    }
  }

  if (fetching) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p className="text-muted">Loading…</p>
    </div>
  )

  const sym = CURRENCY_SYMBOLS[group?.currency ?? 'JPY'] ?? '¥'

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer' }}
          onClick={() => router.back()}>← Back</a>
        <span className="navbar-title">Edit expense</span>
      </nav>

      <div className="container">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div>
            <label>What was it for?</label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Dinner, Train tickets, Hotel"
              autoFocus
            />
          </div>

          <div>
            <label>Amount ({sym})</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              min="0"
              step="1"
              style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 500 }}
            />
          </div>

          <div>
            <label>Paid by</label>
            <select value={paidBy} onChange={e => setPaidBy(e.target.value)}>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>
              Split among
              {perPerson > 0 && (
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8, color: 'var(--ink-3)' }}>
                  — {sym}{Math.round(perPerson).toLocaleString()} each
                </span>
              )}
            </label>
            <div className="card" style={{ padding: '4px 16px' }}>
              {members.map(m => (
                <label key={m.id} className="check-row"
                  style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, cursor: 'pointer', marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={splitAmong.has(m.id)}
                    onChange={() => toggleSplit(m.id)}
                  />
                  <span style={{ fontSize: 14, color: 'var(--ink)' }}>{m.name}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            className="btn btn-primary"
            disabled={!canSubmit || loading}
            onClick={handleSubmit}
          >
            {loading ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </>
  )
}
