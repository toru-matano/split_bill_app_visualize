'use client'
import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Group, Member } from '@/lib/supabase'
import { CURRENCY_SYMBOLS, SUPPORTED_CURRENCIES } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import { useGroup } from '@/hooks/useGroup'
import LangPicker from '@/components/LangPicker'
import PushToggle from '@/components/PushToggle'
import { DeleteModal } from '@/components/PopupModal'


const CURRENCIES = SUPPORTED_CURRENCIES.map(c => ({ code: c, symbol: CURRENCY_SYMBOLS[c] ?? c }))

export default function SettingsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const { t } = useI18n()
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('JPY')
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fetching, setFetching] = useState(true)

  const [newMemberName, setNewMemberName] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')

  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  useEffect(() => {
    if (!token) return
    ;(async () => {
      const { data: grp } = await supabase.from('groups').select('*').eq('share_token', token).single()
      if (!grp) { setFetching(false); return }
      setGroup(grp); setName(grp.name); setCurrency(grp.currency)
      setNotificationsEnabled(grp.notifications_enabled ?? false)
      const { data: mems } = await supabase.from('members').select('*').eq('group_id', grp.id).order('created_at', { ascending: true })
      setMembers(mems ?? [])
      setFetching(false)
    })()
  }, [token])

  const handleSave = async () => {
    if (!name.trim() || !token) return
    setSaving(true)
    await fetch(`/api/groups/${token}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), currency, notifications_enabled: notificationsEnabled }),
    })
    setGroup(prev => prev ? { ...prev, name: name.trim(), currency } : prev)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAddMember = async () => {
    const trimmed = newMemberName.trim()
    if (!trimmed || !token) return
    if (members.some(m => m.name.toLowerCase() === trimmed.toLowerCase())) {
      setMemberError(t('settings.duplicateName')); return
    }
    setAddingMember(true); setMemberError('')
    const res = await fetch(`/api/groups/${token}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    if (res.ok) {
      const newMember = await res.json()
      setMembers(prev => [...prev, newMember])
      setNewMemberName('')
    } else {
      const { error } = await res.json()
      setMemberError(error === 'Duplicate name' ? t('settings.duplicateName') : error)
    }
    setAddingMember(false)
  }

  const handleDeleteGroup = async () => {
    if (!group || deleteConfirm !== group.name || !token) return
    console.log(`Deleting group ${token}...`)
    await fetch(`/api/groups/${token}`, { method: 'DELETE' })
    const saved = localStorage.getItem('splitmate_recent_groups')
    if (saved) localStorage.setItem('splitmate_recent_groups', JSON.stringify(JSON.parse(saved).filter((g: any) => g.shareToken !== token)))
    router.push('/')
  }

  if (fetching) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">Loading…</p></div>
  if (!group) return null

  const sym = CURRENCY_SYMBOLS[group.currency] ?? group.currency
  const canDelete = deleteConfirm === group.name

  return (
    <>
      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer' }} onClick={() => router.back()}><i className="fa-solid fa-arrow-left" style={{ fontSize: 13 }} /> {t('settings.back').replace('← ', '')}</a>
        <span className="navbar-title">{t('settings.title')}</span>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Group info */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label>{t('settings.groupName')}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={group.name} />
          </div>

          <div>
            <label>{t('settings.currency')}</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => (
                <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>
              ))}
            </select>
          </div>

          {/* Push Notifications */}
          {group && (
            <div>
              <label style={{ marginBottom: 10, display: 'block' }}>Push Notifications</label>
              <PushToggle groupId={group.id} label="Expense push notifications" />
            </div>
          )}

          <button className="btn btn-primary" disabled={saving || !name.trim()} onClick={handleSave}>
            {saved ? t('settings.saved') : saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>

        {/* Members */}
        <div>
          <p className="section-title">{t('settings.members')} ({members.length})</p>
          <div className="card" style={{ padding: '4px 20px' }}>
            {members.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < members.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', flexShrink: 0 }}>
                  {m.name.slice(0, 2).toUpperCase()}
                </div>
                <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{m.name}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>#{i + 1}</span>
              </div>
            ))}

            <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <input value={newMemberName} onChange={e => { setNewMemberName(e.target.value); setMemberError('') }} onKeyDown={e => e.key === 'Enter' && handleAddMember()} placeholder={t('settings.addMemberPlaceholder')} className="flex-1" />
                <button className="btn btn-secondary" style={{ width: 'auto', flexShrink: 0 }} onClick={handleAddMember} disabled={addingMember || !newMemberName.trim()}>
                  {addingMember ? t('settings.adding') : t('settings.add')}
                </button>
              </div>
              {memberError && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{memberError}</p>}
            </div>
          </div>
        </div>

        {/* Danger zone */}
        <div>
          <p className="section-title" style={{ color: 'var(--danger)' }}>{t('settings.dangerZone')}</p>
          <div className="card" style={{ border: '1px solid rgba(220,38,38,0.2)' }}>
            {!showDelete ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{t('settings.deleteGroup')}</p>
                  <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>{members.length} members · {sym} base</p>
                </div>
                <button className="btn btn-danger" style={{ height: 36, padding: '0 16px', fontSize: 13, flexShrink: 0 }} onClick={() => setShowDelete(true)}>
                  {t('settings.deleteGroup')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>{t('settings.confirmDelete')}</p>
                <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder={t('settings.confirmDeletePlaceholder')} style={{ borderColor: deleteConfirm && !canDelete ? 'var(--danger)' : undefined }} autoFocus />
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowDelete(false); setDeleteConfirm('') }}>Cancel</button>
                  <button className="btn" style={{ flex: 1, background: canDelete ? 'var(--danger)' : 'var(--surface-3)', color: canDelete ? 'white' : 'var(--ink-3)', opacity: deleting ? 0.6 : 1, cursor: canDelete ? 'pointer' : 'default', border: 'none' }} disabled={!canDelete || deleting} onClick={() => setDeleting(true)}>
                    {deleting ? '…' : t('settings.confirmDeleteBtn')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {deleting && (
        <DeleteModal
          label={deleteConfirm}
          confirmTitle={t('group.deleteConfirmTitle')}
          confirmMsg={t('group.deleteConfirmMsg')}
          confirmBtn={t('group.deleteConfirmBtn')}
          cancelBtn={t('group.deleteCancel')}
          onConfirm={handleDeleteGroup}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  )
}
