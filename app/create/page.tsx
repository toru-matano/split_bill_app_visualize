'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n'
import LangPicker from '@/components/LangPicker'

const CURRENCIES = [{ code: 'JPY', symbol: '¥' }, { code: 'USD', symbol: '$' }, { code: 'EUR', symbol: '€' }, { code: 'GBP', symbol: '£' }]

export default function CreatePage() {
  const router = useRouter()
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [memberInput, setMemberInput] = useState('')
  const [currency, setCurrency] = useState('JPY')
  const [memberError, setMemberError] = useState('')
  const [loading, setLoading] = useState(false)

  const addMember = () => {
    const trimmed = memberInput.trim()
    if (!trimmed) return
    if (members.map(m => m.toLowerCase()).includes(trimmed.toLowerCase())) { setMemberError(t('create.duplicateName')); return }
    setMembers([...members, trimmed]); setMemberInput(''); setMemberError('')
  }

  const canSubmit = name.trim().length > 0 && members.length >= 2
  const memberHint = members.length === 0 ? t('create.memberHint0') : members.length === 1 ? t('create.memberHint1') : t('create.memberHintN', { count: members.length })

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    try {
      const res = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), members, currency }) })
      const { shareToken } = await res.json()
      router.push(`/group/${shareToken}`)
    } catch { setLoading(false) }
  }

  return (
    <>
      <nav className="navbar">
        <span className="navbar-title">{t('create.title')}</span>
        <LangPicker />
      </nav>
      <div className="container">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label>{t('create.groupName')}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('create.groupNamePlaceholder')} onKeyDown={e => e.key === 'Enter' && document.getElementById('member-input')?.focus()} autoFocus />
          </div>
          <div>
            <label>{t('create.members')}</label>
            {members.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {members.map((m, i) => (
                  <span key={i} className="pill">{m}<span className="pill-x" onClick={() => setMembers(members.filter((_, idx) => idx !== i))}>✕</span></span>
                ))}
              </div>
            )}
            <div className="row">
              <input id="member-input" value={memberInput} onChange={e => { setMemberInput(e.target.value); setMemberError('') }} onKeyDown={e => e.key === 'Enter' && addMember()} placeholder={t('create.memberPlaceholder')} className="flex-1" />
              <button className="btn btn-secondary" onClick={addMember} style={{ width: 'auto', flexShrink: 0 }}>{t('create.addMember')}</button>
            </div>
            {memberError && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{memberError}</p>}
            <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>{memberHint}</p>
          </div>
          <div>
            <label>{t('create.currency')}</label>
            <div className="currency-grid">
              {CURRENCIES.map(c => (
                <button key={c.code} className={`cur-btn${currency === c.code ? ' active' : ''}`} onClick={() => setCurrency(c.code)}>
                  {c.code}<br /><span style={{ fontSize: 16 }}>{c.symbol}</span>
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" disabled={!canSubmit || loading} onClick={handleSubmit} style={{ marginTop: 4 }}>
            {loading ? t('create.submitting') : t('create.submit')}
          </button>
        </div>
      </div>
    </>
  )
}
