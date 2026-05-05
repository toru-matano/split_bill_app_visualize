'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member, Expense } from '@/lib/supabase'
import ShareSheet from '@/components/ShareSheet'

const CURRENCY_SYMBOLS: Record<string, string> = { JPY: '¥', USD: '$', EUR: '€', GBP: '£' }

type PageProps = { params: Promise<{ token: string }> }

export default function GroupPage({ params }: PageProps) {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [liveIndicator, setLiveIndicator] = useState(false)
  const groupIdRef = useRef<string | null>(null)

  useEffect(() => {
    params.then(p => setToken(p.token))
  }, [params])

  const loadExpenses = useCallback(async (groupId: string) => {
    const { data: exps } = await supabase
      .from('expenses')
      .select('*, member:paid_by(id,name)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
    setExpenses((exps as Expense[]) ?? [])
  }, [])

  const load = useCallback(async (tok: string) => {
    const { data: grp } = await supabase
      .from('groups').select('*').eq('share_token', tok).single()
    if (!grp) { setLoading(false); return }
    setGroup(grp)
    groupIdRef.current = grp.id

    const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id)
    setMembers(mems ?? [])

    await loadExpenses(grp.id)
    setLoading(false)
  }, [loadExpenses])

  useEffect(() => {
    if (token) load(token)
  }, [token, load])

  // Step 2: Supabase Realtime subscription
  useEffect(() => {
    if (!groupIdRef.current) return

    const groupId = groupIdRef.current
    const channel = supabase
      .channel(`group-expenses-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` },
        () => {
          // Flash live indicator then reload
          setLiveIndicator(true)
          setTimeout(() => setLiveIndicator(false), 1500)
          loadExpenses(groupId)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [group, loadExpenses])

  const deleteExpense = async (id: string) => {
    setDeleting(id)
    await fetch('/api/expenses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expenseId: id }),
    })
    // Realtime will trigger reload; also update optimistically
    setExpenses(prev => prev.filter(e => e.id !== id))
    setDeleting(null)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p className="text-muted">Loading…</p>
    </div>
  )

  if (!group) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>🔍</p>
        <p className="text-muted">Group not found</p>
      </div>
    </div>
  )

  const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const perPerson = members.length > 0 ? total / members.length : 0
  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''

  return (
    <>
      <nav className="navbar">
        <span className="navbar-title">{group.name}</span>

        {/* Live indicator */}
        {liveIndicator && (
          <span style={{
            fontSize: 11, color: 'var(--success)', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--success)', display: 'inline-block',
            }} />
            Updated
          </span>
        )}

        <button className="btn btn-ghost" onClick={() => setShowShare(true)} style={{ flexShrink: 0 }}>
          Share
        </button>
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats */}
        <div className="stat-row">
          <div className="stat-card">
            <p className="stat-label">Total spent</p>
            <p className="stat-value">{sym}{total.toLocaleString()}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Per person</p>
            <p className="stat-value">{sym}{Math.round(perPerson).toLocaleString()}</p>
          </div>
        </div>

        {/* Members */}
        <div>
          <p className="section-title">Members ({members.length})</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map(m => (
              <span key={m.id} className="pill" style={{ borderRadius: 999 }}>{m.name}</span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="row" style={{ gap: 10 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => router.push(`/group/${token}/add`)}
          >
            + Add expense
          </button>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, width: 'auto' }}
            onClick={() => router.push(`/group/${token}/settle`)}
            disabled={expenses.length === 0}
          >
            Settle up
          </button>
        </div>

        {/* Expenses */}
        <div>
          <p className="section-title">Expenses ({expenses.length})</p>
          {expenses.length === 0 ? (
            <div className="card">
              <div className="empty-state">No expenses yet.<br />Add the first one!</div>
            </div>
          ) : (
            <div className="card" style={{ padding: '4px 20px' }}>
              {expenses.map(e => {
                const payer = e.member as unknown as Member | null
                const initials = payer?.name?.slice(0, 2).toUpperCase() ?? '?'
                return (
                  <div key={e.id} className="expense-item">
                    <div className="expense-avatar">{initials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="expense-label">{e.label || 'Expense'}</p>
                      <p className="expense-meta">paid by {payer?.name ?? '—'}</p>
                    </div>
                    <p className="expense-amount">{sym}{Number(e.amount).toLocaleString()}</p>
                    <div style={{ display: 'flex', gap: 6, marginLeft: 8, flexShrink: 0 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ height: 32, padding: '0 10px', fontSize: 12 }}
                        onClick={() => router.push(`/group/${token}/edit/${e.id}`)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => deleteExpense(e.id)}
                        disabled={deleting === e.id}
                      >
                        {deleting === e.id ? '…' : 'Del'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Step 1: Share sheet modal */}
      {showShare && (
        <ShareSheet
          url={shareUrl}
          groupName={group.name}
          onClose={() => setShowShare(false)}
        />
      )}
    </>
  )
}
