'use client'

import { use, useEffect, useState, useCallback, useRef } from 'react'
import { consumePendingExpense, failPendingExpense } from '@/lib/optimistic-expenses'
import type { OptimisticExpense } from '@/lib/optimistic-expenses'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member, Expense } from '@/lib/supabase'
import { fetchGroupExpenses } from '@/lib/expenses-api'
import { CATEGORIES } from '@/lib/categories'
import { CURRENCY_SYMBOLS, formatNumber } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import ShareSheet from '@/components/ShareSheet'
import LangPicker from '@/components/LangPicker'
import ExpenseForm from '@/components/ExpenseForm'

export default function GroupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const { t } = useI18n()
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<(Expense | OptimisticExpense)[]>([])
  const [loading, setLoading] = useState(true)
  const [showShare, setShowShare] = useState(false)
  const [liveIndicator, setLiveIndicator] = useState(false)
  const [filterCat, setFilterCat] = useState<string>('all')
  const groupIdRef = useRef<string | null>(null)
  // Keep a ref to members so loadExpenses closure can resolve names
  const membersRef = useRef<Member[]>([])

  // ── Load expenses — no longer joins member name via PostgREST ─────────────
  // Instead we resolve the payer name from the in-memory members array.
  const loadExpenses = useCallback(async (groupId: string) => {
    const expList = await fetchGroupExpenses(groupId)

    // Attach member object so JSX can resolve payer name without a join
    const enriched = expList.map(e => ({
      ...e,
      member: membersRef.current.find(m => m.id === e.paid_by) ?? null,
    }))
    setExpenses(enriched as unknown as Expense[])
  }, [])

  const saveTokenToRecent = (name: string, shareToken: string) => {
    const recentGroups = JSON.parse(localStorage.getItem('splitmate_recent_groups') || '[]')
    if (!recentGroups.map((g: { shareToken: string }) => g.shareToken).includes(shareToken)) {
      recentGroups.unshift({ name: name.trim(), shareToken })
      localStorage.setItem('splitmate_recent_groups', JSON.stringify(recentGroups.slice(0, 5)))
    }
  }

  const removeTokenFromRecent = (shareToken: string) => {
    const recentGroups = JSON.parse(localStorage.getItem('splitmate_recent_groups') || '[]')
    const updated = recentGroups.filter((g: { shareToken: string }) => g.shareToken !== shareToken)
    localStorage.setItem('splitmate_recent_groups', JSON.stringify(updated))
  }

  const load = useCallback(async (tok: string) => {
    // 1. Fetch group (no PII — direct Supabase call fine)
    const { data: grp } = await supabase.from('groups').select('*').eq('share_token', tok).single()
    if (!grp) { removeTokenFromRecent(tok); setLoading(false); return }
    setGroup(grp)
    groupIdRef.current = grp.id
    saveTokenToRecent(grp.name, grp.share_token)

    // 2. Fetch members via API route (server decrypts names)
    const res = await fetch(`/api/groups/${tok}/members`)
    const mems: Member[] = res.ok ? await res.json() : []
    membersRef.current = mems
    setMembers(mems)

    // 3. Load expenses (uses membersRef to resolve names)
    await loadExpenses(grp.id)

    // 4. Inject any optimistic row that arrived from the add-expense form.
    //    The row uses the same UUID that will be sent to the DB, so when the
    //    realtime INSERT fires loadExpenses() replaces it seamlessly.
    const optimistic = consumePendingExpense(grp.id)
    if (optimistic) {
      setExpenses(prev => {
        // Don't double-insert if realtime already beat us here
        if (prev.some(e => e.id === optimistic.id)) return prev
        return [optimistic, ...prev]
      })
    }

    setLoading(false)
  }, [loadExpenses])

  useEffect(() => { if (token) load(token) }, [token, load])

  // Realtime: re-fetch expenses on any change (member names already in state)
  useEffect(() => {
    if (!groupIdRef.current) return
    const groupId = groupIdRef.current
    const channel = supabase
      .channel(`group-expenses-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` }, (payload) => {
        setLiveIndicator(true)
        setTimeout(() => setLiveIndicator(false), 1500)

        if (payload.eventType === 'INSERT') {
          const incomingId = payload.new?.id as string | undefined
          // Mark the matching optimistic row as confirmed before the full reload
          // so the check icon flips to green with zero layout shift.
          if (incomingId) {
            setExpenses(prev => prev.map(e =>
              e.id === incomingId
                ? { ...e, _optimisticStatus: 'confirmed' } as OptimisticExpense
                : e
            ))
          }
        }

        loadExpenses(groupId)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [group, loadExpenses])

  // Poll for rollback signals from the background POST error handler.
  // failPendingExpense() writes a status:'error' entry; we remove that row.
  useEffect(() => {
    if (!group) return
    const iv = setInterval(() => {
      const groupId = group.id
      // Peek without consuming — consumePendingExpense deletes the entry
      setExpenses(prev => {
        const hasError = prev.some(
          e => '_optimisticStatus' in e && (e as OptimisticExpense)._optimisticStatus === 'error'
        )
        if (!hasError) return prev
        return prev.filter(
          e => !('_optimisticStatus' in e && (e as OptimisticExpense)._optimisticStatus === 'error')
        )
      })
    }, 300)
    return () => clearInterval(iv)
  }, [group])


  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">{t('loading.default')}</p></div>
  if (!group) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><div style={{ textAlign: 'center' }}><p style={{ fontSize: 32, marginBottom: 12 }}>🔍</p><p className="text-muted">{t('group.notFound')}</p></div></div>

  const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
  const usedCats = [...new Set(expenses.map(e => e.category).filter(Boolean))]
  const filtered = filterCat === 'all' ? expenses : expenses.filter(e => e.category === filterCat)

  return (
    <>
      <nav className="navbar">
        <span className="navbar-title">
          <button className="btn btn-ghost" onClick={() => router.push('/')} title="Home" style={{ width: 70, height: 42, fontSize: 16, borderWidth: 0 }}>
            <img src="/icon-192.png" alt="icon" style={{ width: 24, height: 'auto' }} />
          </button>
        </span>
        <button className="btn btn-ghost" onClick={() => setShowShare(true)} style={{ flexShrink: 0, width: 70, height: 42, gap: 0 }} title={t('group.share')}>
          <i className="fa-solid fa-share-nodes" style={{ fontSize: 20 }} />
        </button>
        <button className="btn btn-ghost" onClick={() => router.push(`/group/${token}/settings`)} style={{ flexShrink: 0, width: 70, height: 42, padding: 0 }} title="Settings">
          <i className="fa-solid fa-gear" style={{ fontSize: 20 }} />
        </button>
        {liveIndicator && (
          <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            {t('group.updated')}
          </span>
        )}
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1>{group.name}</h1>

        {/* Members list */}
        <div>
          <p className="section-title">{t('group.members')} ({members.length})</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map(m => (
              <span key={m.id} className="pill" style={{ borderRadius: 999, cursor: "pointer" }} onClick={() => router.push(`/group/${token}/member/${m.id}`)}>
                <i className="fa-solid fa-user" style={{ fontSize: 11, color: 'var(--ink-3)' }} />
                {m.name}
              </span>
            ))}
          </div>
        </div>

        {/* Menu buttons */}
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => router.push(`/group/${token}/add`)}>
            <i className="fa-solid fa-plus" style={{ fontSize: 13 }} /> {t('group.addExpense')}
          </button>
          {/* <button className="btn btn-secondary" style={{ flex: 1, width: 'auto' }} onClick={() => router.push(`/group/${token}/summary`)} disabled={expenses.length === 0}>
            <i className="fa-solid fa-chart-bar" style={{ fontSize: 13 }} /> {t('group.viewSummary')}
          </button> */}
          <button className="btn btn-secondary" style={{ flex: 1, width: 'auto' }} onClick={() => router.push(`/group/${token}/settle`)} disabled={expenses.length === 0}>
            <i className="fa-solid fa-scale-balanced" style={{ fontSize: 13 }} /> {t('group.settleUp')}
          </button>
        </div>

        <AdBanner />

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="section-title" style={{ marginBottom: 0 }}>{t('group.expenses')} ({expenses.length})</p>
          </div>

          {usedCats.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={() => setFilterCat('all')} style={{ borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 500, border: '1px solid var(--border-2)', fontFamily: 'inherit', cursor: 'pointer', background: filterCat === 'all' ? 'var(--ink)' : 'var(--surface)', color: filterCat === 'all' ? 'white' : 'var(--ink-2)' }}>
                {t('group.all')}
              </button>
              {usedCats.map(cat => {
                const def = CATEGORIES[cat as keyof typeof CATEGORIES] ?? CATEGORIES.other
                const active = filterCat === cat
                const catLabel = t(`categories.${cat}`) || def.label
                return (
                  <button key={cat} onClick={() => setFilterCat(cat)} style={{ borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 500, border: `1px solid ${active ? def.color : 'var(--border-2)'}`, fontFamily: 'inherit', cursor: 'pointer', background: active ? def.color : 'var(--surface)', color: active ? 'white' : 'var(--ink-2)' }}>
                    {def.emoji} {catLabel}
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
                // const payer = e.member as unknown as Member | null
                const cat = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
                // const catLabel = t(`categories.${e.category}`) || cat.label
                const isForeign = e.original_currency && e.original_currency !== group.currency
                return (
                  <div
                    key={e.id}
                    className="expense-item"
                    style={{
                      opacity: '_optimisticStatus' in e && (e as OptimisticExpense)._optimisticStatus === 'pending' ? 0.6 : 1,
                      transition: 'opacity 0.3s ease',
                    }}
                  >
                    <div className="expense-avatar" style={{ background: cat.color + '18', fontSize: 18 }}>{cat.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="expense-label">{e.label || 'Expense'}</p>
                      <p className="expense-meta">
                        {e.expense_date}
                        {isForeign && (
                          <span style={{ marginLeft: 6, color: 'var(--accent)', fontWeight: 500 }}>
                            · {CURRENCY_SYMBOLS[e.original_currency!] ?? e.original_currency}{formatNumber(e.original_amount ?? 0)} {e.original_currency}
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="expense-amount">{sym}{formatNumber(e.amount ?? 0)}</p>
                    {/* ── Validation status icon ── */}
                    {'_optimisticStatus' in e ? (
                      <i
                        className="fa-regular fa-circle-check"
                        title={(e as OptimisticExpense)._optimisticStatus === 'confirmed' ? 'Saved' : 'Saving…'}
                        style={{
                          fontSize: 16,
                          flexShrink: 0,
                          transition: 'color 0.4s ease',
                          color: (e as OptimisticExpense)._optimisticStatus === 'confirmed'
                            ? 'var(--success)'
                            : 'var(--ink-3)',
                        }}
                      />
                    ) : (
                      <i
                        className="fa-regular fa-circle-check"
                        title="Saved"
                        style={{ fontSize: 16, flexShrink: 0, color: 'var(--success)' }}
                      />
                    )}
                    <div style={{ display: 'flex', gap: 6, marginLeft: 8, flexShrink: 0 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ height: 32, padding: '0 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
                        onClick={() => router.push(`/group/${token}/edit/${e.id}`)}
                        disabled={'_optimisticStatus' in e && (e as OptimisticExpense)._optimisticStatus === 'pending'}
                      >
                        <i className="fa-solid fa-pen" style={{ fontSize: 11 }} /> {t('group.edit')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Encrypted group indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
          <i className="fa-solid fa-lock"/>
          <p style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>{t('group.encryptedSub')}</p>
        </div>

      </div>

      {showShare && <ShareSheet url={shareUrl} groupName={group.name} onClose={() => setShowShare(false)} />}
    </>
  )
}

function AdBanner() {
  const { t } = useI18n()
  return (
    <div style={{ borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-2)', background: 'var(--surface-2)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 2 }}>{t('ad.label')}</p>
        <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t('ad.placeholder')}</p>
      </div>
      <span style={{ fontSize: 20 }}>📢</span>
    </div>
  )
}
