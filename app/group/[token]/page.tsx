'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member, Expense } from '@/lib/supabase'
import { CATEGORIES } from '@/lib/categories'
import { CURRENCY_SYMBOLS } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import ShareSheet from '@/components/ShareSheet'
import LangPicker from '@/components/LangPicker'

type PageProps = { params: Promise<{ token: string }> }

export default function GroupPage({ params }: PageProps) {
  const router = useRouter()
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [liveIndicator, setLiveIndicator] = useState(false)
  const [filterCat, setFilterCat] = useState<string>('all')
  const groupIdRef = useRef<string | null>(null)

  useEffect(() => { params.then(p => setToken(p.token)) }, [params])

  const loadExpenses = useCallback(async (groupId: string) => {
    const { data: exps } = await supabase
      .from('expenses')
      .select('*, member:paid_by(id,name)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
    setExpenses((exps as Expense[]) ?? [])
  }, [])

  const saveTokenToRecent = (name: string, shareToken: string) => {
    const recentGroups = JSON.parse(localStorage.getItem('splitmate_recent_groups') || '[]')
    if (!recentGroups.map((g: any) => g.shareToken).includes(shareToken)) {
      recentGroups.unshift({ name: name.trim(), shareToken })
      localStorage.setItem('splitmate_recent_groups', JSON.stringify(recentGroups.slice(0, 5)))
    }
  }

  const removeTokenFromRecent = (shareToken: string) => {
    const recentGroups = JSON.parse(localStorage.getItem('splitmate_recent_groups') || '[]')
    const updated = recentGroups.filter((g: any) => g.shareToken !== shareToken)
    localStorage.setItem('splitmate_recent_groups', JSON.stringify(updated))
  }

  const load = useCallback(async (tok: string) => {
    const { data: grp } = await supabase.from('groups').select('*').eq('share_token', tok).single()
    if (!grp) {
      removeTokenFromRecent(tok)
      setLoading(false)
      return
    }
    
    setGroup(grp)
    groupIdRef.current = grp.id
    
    // Update recent groups in localStorage
    saveTokenToRecent(grp.name, grp.share_token)
    
    const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id)
    setMembers(mems ?? [])
    await loadExpenses(grp.id)
    setLoading(false)
  }, [loadExpenses])

  useEffect(() => {
    if (token) load(token)
  }, [token, load])
  
  // Realtime
  useEffect(() => {
    if (!groupIdRef.current) return
    const groupId = groupIdRef.current
    const channel = supabase
      .channel(`group-expenses-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` }, () => {
        setLiveIndicator(true)
        setTimeout(() => setLiveIndicator(false), 1500)
        loadExpenses(groupId)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [group, loadExpenses])

  const deleteExpense = async (id: string) => {
    setDeleting(id)
    await fetch('/api/expenses', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expenseId: id }) })
    setExpenses(prev => prev.filter(e => e.id !== id))
    setDeleting(null)
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>
  if (!group) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><div style={{ textAlign: 'center' }}><p style={{ fontSize: 32, marginBottom: 12 }}>🔍</p><p className="text-muted">{t('group.notFound')}</p></div></div>

  const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  // const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  // const perPerson = members.length > 0 ? total / members.length : 0
  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
  const usedCats = [...new Set(expenses.map(e => e.category).filter(Boolean))]
  const filtered = filterCat === 'all' ? expenses : expenses.filter(e => e.category === filterCat)

  return (
    <>
      <nav className="navbar">
        <span className="navbar-title">{group.name}</span>
        {liveIndicator && (
          <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            {t('group.updated')}
          </span>
        )}
        <button className="btn btn-ghost" onClick={() => setShowShare(true)} style={{ flexShrink: 0 }}>{t('group.share')}</button>
        <button className="btn btn-ghost" onClick={() => router.push(`/group/${token}/settings`)} style={{ flexShrink: 0, fontSize: 18, padding: "0 8px" }}>⚙️</button>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats */}
        {/* <div className="stat-row">
          <div className="stat-card">
            <p className="stat-label">{t('group.totalSpent')}</p>
            <p className="stat-value">{sym}{Math.round(total).toLocaleString()}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">{t('group.perPerson')}</p>
            <p className="stat-value">{sym}{Math.round(perPerson).toLocaleString()}</p>
          </div>
        </div> */}

        {/* Members */}
        <div>
          <p className="section-title">{t('group.members')} ({members.length})</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map(m => <span key={m.id} className="pill" style={{ borderRadius: 999 }}>{m.name}</span>)}
          </div>
        </div>

        {/* Actions */}
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => router.push(`/group/${token}/add`)}>
            {t('group.addExpense')}
          </button>
          <button className="btn btn-secondary" style={{ flex: 1, width: 'auto' }} onClick={() => router.push(`/group/${token}/summary`)} disabled={expenses.length === 0}>
            {t('group.viewSummary')}
          </button>
          <button className="btn btn-secondary" style={{ flex: 1, width: 'auto' }} onClick={() => router.push(`/group/${token}/settle`)} disabled={expenses.length === 0}>
            {t('group.settleUp')}
          </button>
        </div>

        {/* Ad slot */}
        <AdBanner />

        {/* Expenses */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="section-title" style={{ marginBottom: 0 }}>{t('group.expenses')} ({expenses.length})</p>
          </div>

          {/* Category filter chips */}
          {usedCats.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={() => setFilterCat('all')} style={{ borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 500, border: '1px solid var(--border-2)', fontFamily: 'inherit', cursor: 'pointer', background: filterCat === 'all' ? 'var(--ink)' : 'var(--surface)', color: filterCat === 'all' ? 'white' : 'var(--ink-2)' }}>
                {t('group.all')}
              </button>
              {usedCats.map(cat => {
                const def = CATEGORIES[cat as keyof typeof CATEGORIES] ?? CATEGORIES.other
                const active = filterCat === cat
                return (
                  <button key={cat} onClick={() => setFilterCat(cat)} style={{ borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${active ? def.color : 'var(--border-2)'}`, fontFamily: 'inherit', cursor: 'pointer', background: active ? def.color : 'var(--surface)', color: active ? 'white' : 'var(--ink-2)' }}>
                    {def.emoji} {def.label.split(' ')[0]}
                  </button>
                )
              })}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="card"><div className="empty-state">{t('group.noExpenses')}</div></div>
          ) : (
            <div className="card" style={{ padding: '4px 20px' }}>
              {filtered.map(e => {
                const payer = e.member as unknown as Member | null
                const cat = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
                const isForeign = e.original_currency && e.original_currency !== group.currency
                return (
                  <div key={e.id} className="expense-item">
                    <div className="expense-avatar" style={{ background: cat.color + '18', fontSize: 18 }}>{cat.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="expense-label">{e.label || 'Expense'}</p>
                      <p className="expense-meta">
                        {payer?.name ?? '—'} · {new Date(e.created_at).toISOString().split('T')[0]}
                        {isForeign && (
                          <span style={{ marginLeft: 6, color: 'var(--accent)', fontWeight: 500 }}>
                            · {CURRENCY_SYMBOLS[e.original_currency!] ?? e.original_currency}{Number(e.original_amount).toLocaleString()} {e.original_currency}
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="expense-amount">{sym}{Math.round(Number(e.amount)).toLocaleString()}</p>
                    <div style={{ display: 'flex', gap: 6, marginLeft: 8, flexShrink: 0 }}>
                      <button className="btn btn-ghost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} onClick={() => router.push(`/group/${token}/edit/${e.id}`)}>
                        {t('group.edit')}
                      </button>
                      <button className="btn btn-danger" onClick={() => deleteExpense(e.id)} disabled={deleting === e.id}>
                        {deleting === e.id ? t('group.deleting') : t('group.delete')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showShare && <ShareSheet url={shareUrl} groupName={group.name} onClose={() => setShowShare(false)} />}
    </>
  )
}

function AdBanner() {
  return (
    <div style={{ borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-2)', background: 'var(--surface-2)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 2 }}>Advertisement</p>
        <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>Replace with Google AdSense &lt;ins&gt; tag</p>
      </div>
      <span style={{ fontSize: 20 }}>📢</span>
    </div>
  )
}
