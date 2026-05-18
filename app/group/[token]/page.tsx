'use client'
/**
 * app/group/[token]/page.tsx  (App Shell refactor)
 *
 * Rendering contract
 * ──────────────────
 * 1. SW serves cached shell HTML — skeleton renders instantly (<16 ms).
 * 2. useGroupData() fires Phase 1: warms from sessionStorage cache if
 *    available, so returning users see real data before any network round-trip.
 * 3. Phase 2 concurrent fetches (group + members + expenses) run in the
 *    background; state updates trigger a smooth transition from skeleton
 *    → stale data → fresh data with no full-page reload or layout shift.
 *
 * This component is now a pure presentation layer: all loading orchestration
 * lives in useGroupData, all skeleton rendering in AppShellSkeleton.
 */

import { use, useEffect, useState } from 'react'
import type { OptimisticExpense } from '@/lib/optimistic-expenses'
import { useRouter } from 'next/navigation'
import type { Expense } from '@/lib/supabase'
import { CATEGORIES } from '@/lib/categories'
import { CURRENCY_SYMBOLS, formatNumber } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import { useGroupData } from '@/hooks/useGroupData'
import ShareSheet from '@/components/ShareSheet'
import LangPicker from '@/components/LangPicker'
import AppShellSkeleton from '@/components/AppShellSkeleton'
import Link from 'next/link'

export default function GroupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router    = useRouter()
  const { t }     = useI18n()

  const {
    loading,
    refreshing,
    group,
    members,
    expenses,
    liveIndicator,
    notFound,
  } = useGroupData(token)

  const [showShare,  setShowShare]  = useState(false)
  const [filterCat,  setFilterCat]  = useState<string>('all')

  // ── Prefetch high-traffic routes ──────────────────────────────────────────
  // These fire after first paint so they never compete with critical data.
  useEffect(() => {
    if (!token) return
    router.prefetch(`/group/${token}/add`)
    router.prefetch(`/group/${token}/settle`)
  }, [token, router])

  useEffect(() => {
    if (!token || expenses.length === 0) return
    expenses.slice(0, 5).forEach(e =>
      router.prefetch(`/group/${token}/edit/${e.id}`)
    )
  }, [token, expenses, router])

  // ── Render guards ─────────────────────────────────────────────────────────
  // Shell skeleton: shown on first load (no cache) and while refreshing with
  // no data yet. Passes groupName so the title renders immediately when the
  // group row is known but expenses haven't arrived yet.
  if (loading) return <AppShellSkeleton groupName={group?.name} />

  if (notFound || !group) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>🔍</p>
          <p className="text-muted">{t('group.notFound')}</p>
        </div>
      </div>
    )
  }

  const sym       = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const shareUrl  = typeof window !== 'undefined' ? window.location.href : ''
  const usedCats  = [...new Set(expenses.map(e => e.category).filter(Boolean))]
  const filtered  = filterCat === 'all'
    ? expenses
    : expenses.filter(e => e.category === filterCat)

  return (
    <>
      {/* ── Navbar ── */}
      <nav className="navbar">
        <span className="navbar-title">
          <button
            className="btn btn-ghost"
            onClick={() => router.push('/')}
            title="Home"
            style={{ width: 70, height: 42, fontSize: 16, borderWidth: 0 }}
          >
            <img src="/icon-192.png" alt="icon" style={{ width: 24, height: 'auto' }} />
          </button>
        </span>

        <button
          className="btn btn-ghost"
          onClick={() => setShowShare(true)}
          style={{ flexShrink: 0, width: 70, height: 42, gap: 0 }}
          title={t('group.share')}
        >
          <i className="fa-solid fa-share-nodes" style={{ fontSize: 20 }} />
        </button>

        <button
          className="btn btn-ghost"
          onClick={() => router.push(`/group/${token}/settings`)}
          style={{ flexShrink: 0, width: 70, height: 42, padding: 0 }}
          title="Settings"
        >
          <i className="fa-solid fa-gear" style={{ fontSize: 20 }} />
        </button>

        {/* Live update indicator */}
        {liveIndicator && (
          <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            {t('group.updated')}
          </span>
        )}

        {/* Background-refresh indicator — subtle, non-blocking */}
        {refreshing && !liveIndicator && (
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 400, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--ink-3)', display: 'inline-block',
              animation: 'pulse 1s ease-in-out infinite',
            }} />
          </span>
        )}

        <LangPicker />
      </nav>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1>{group.name}</h1>

        {/* ── Members ── */}
        <div>
          <p className="section-title">{t('group.members')} ({members.length})</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map(m => (
              <span
                key={m.id}
                className="pill"
                style={{ borderRadius: 999, cursor: 'pointer' }}
                onClick={() => router.push(`/group/${token}/member/${m.id}`)}
              >
                <i className="fa-solid fa-user" style={{ fontSize: 11, color: 'var(--ink-3)' }} />
                {m.name}
              </span>
            ))}
          </div>
        </div>

        {/* ── Action buttons ── */}
        <div className="row" style={{ gap: 10 }}>
          <Link
            className="btn btn-primary"
            style={{ flex: 1, textDecoration: 'none' }}
            href={`/group/${token}/add`}
          >
            <i className="fa-solid fa-plus" style={{ fontSize: 13 }} />
            {t('group.addExpense')}
          </Link>
          <Link
            className="btn btn-secondary"
            style={{
              flex: 1, width: 'auto', textDecoration: 'none',
              pointerEvents: expenses.length === 0 ? 'none' : 'auto',
              opacity: expenses.length === 0 ? 0.4 : 1,
            }}
            href={`/group/${token}/settle`}
          >
            <i className="fa-solid fa-scale-balanced" style={{ fontSize: 13 }} />
            {t('group.settleUp')}
          </Link>
        </div>

        <AdBanner />

        {/* ── Expense list ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="section-title" style={{ marginBottom: 0 }}>
              {t('group.expenses')} ({expenses.length})
            </p>
          </div>

          {/* Category filter pills */}
          {usedCats.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                onClick={() => setFilterCat('all')}
                style={{
                  borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 500,
                  border: '1px solid var(--border-2)', fontFamily: 'inherit', cursor: 'pointer',
                  background: filterCat === 'all' ? 'var(--ink)' : 'var(--surface)',
                  color:      filterCat === 'all' ? 'white' : 'var(--ink-2)',
                }}
              >
                {t('group.all')}
              </button>
              {usedCats.map(cat => {
                const def    = CATEGORIES[cat as keyof typeof CATEGORIES] ?? CATEGORIES.other
                const active = filterCat === cat
                const label  = t(`categories.${cat}`) || def.label
                return (
                  <button
                    key={cat}
                    onClick={() => setFilterCat(cat)}
                    style={{
                      borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 500,
                      border: `1px solid ${active ? def.color : 'var(--border-2)'}`,
                      fontFamily: 'inherit', cursor: 'pointer',
                      background: active ? def.color : 'var(--surface)',
                      color:      active ? 'white' : 'var(--ink-2)',
                    }}
                  >
                    {def.emoji} {label}
                  </button>
                )
              })}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="card">
              <div className="empty-state">{t('group.noExpenses')}</div>
            </div>
          ) : (
            <div className="card" style={{ padding: '4px 20px' }}>
              {filtered.map(e => {
                const cat      = CATEGORIES[e.category as keyof typeof CATEGORIES] ?? CATEGORIES.other
                const isForeign = e.original_currency && e.original_currency !== group.currency
                const isPending = '_optimisticStatus' in e &&
                                  (e as OptimisticExpense)._optimisticStatus === 'pending'
                const isConfirmed = '_optimisticStatus' in e &&
                                    (e as OptimisticExpense)._optimisticStatus === 'confirmed'

                return (
                  <div
                    key={e.id}
                    className="expense-item"
                    style={{ opacity: isPending ? 0.6 : 1, transition: 'opacity 0.3s ease' }}
                  >
                    <div className="expense-avatar" style={{ background: cat.color + '18', fontSize: 18 }}>
                      {cat.emoji}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="expense-label">{e.label || 'Expense'}</p>
                      <p className="expense-meta">
                        {e.expense_date}
                        {isForeign && (
                          <span style={{ marginLeft: 6, color: 'var(--accent)', fontWeight: 500 }}>
                            · {CURRENCY_SYMBOLS[e.original_currency!] ?? e.original_currency}
                            {formatNumber(e.original_amount ?? 0)} {e.original_currency}
                          </span>
                        )}
                      </p>
                    </div>

                    <p className="expense-amount">{sym}{formatNumber(e.amount ?? 0)}</p>

                    {/* Optimistic status icon */}
                    {'_optimisticStatus' in e ? (
                      <i
                        className="fa-regular fa-circle-check"
                        title={isConfirmed ? 'Saved' : 'Saving…'}
                        style={{
                          fontSize: 16, flexShrink: 0, transition: 'color 0.4s ease',
                          color: isConfirmed ? 'var(--success)' : 'var(--ink-3)',
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
                      <Link
                        className="btn btn-ghost"
                        href={`/group/${token}/edit/${e.id}`}
                        style={{
                          height: 32, padding: '0 10px', fontSize: 12,
                          display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none',
                          pointerEvents: isPending ? 'none' : 'auto',
                        }}
                      >
                        <i className="fa-solid fa-pen" style={{ fontSize: 11 }} />
                        {t('group.edit')}
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Encrypted badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'var(--surface-2)',
          borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
        }}>
          <i className="fa-solid fa-lock" />
          <p style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
            {t('group.encryptedSub')}
          </p>
        </div>
      </div>

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

function AdBanner() {
  const { t } = useI18n()
  return (
    <div style={{
      borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-2)',
      background: 'var(--surface-2)', padding: '12px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 2 }}>
          {t('ad.label')}
        </p>
        <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t('ad.placeholder')}</p>
      </div>
      <span style={{ fontSize: 20 }}>📢</span>
    </div>
  )
}
