'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const CURRENCIES = [
  { code: 'JPY', symbol: '¥' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
]

export default function CreatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [memberInput, setMemberInput] = useState('')
  const [currency, setCurrency] = useState('JPY')
  const [memberError, setMemberError] = useState('')
  const [loading, setLoading] = useState(false)

  const addMember = () => {
    const trimmed = memberInput.trim()
    if (!trimmed) return
    if (members.map(m => m.toLowerCase()).includes(trimmed.toLowerCase())) {
      setMemberError('Name already added')
      return
    }
    setMembers([...members, trimmed])
    setMemberInput('')
    setMemberError('')
  }

  const removeMember = (i: number) => setMembers(members.filter((_, idx) => idx !== i))

  const canSubmit = name.trim().length > 0 && members.length >= 2

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), members, currency }),
      })
      const { shareToken } = await res.json()
      router.push(`/group/${shareToken}`)
    } catch {
      setLoading(false)
    }
  }

  return (
    <>
      <nav className="navbar">
        <span className="navbar-title">New group</span>
      </nav>
      <div className="container">
        <div className="card gap-4" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Group name */}
          <div>
            <label>Group name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Tokyo trip, Weekend BBQ"
              onKeyDown={e => e.key === 'Enter' && document.getElementById('member-input')?.focus()}
              autoFocus
            />
          </div>

          {/* Members */}
          <div>
            <label>Members</label>
            {members.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {members.map((m, i) => (
                  <span key={i} className="pill">
                    {m}
                    <span className="pill-x" onClick={() => removeMember(i)}>✕</span>
                  </span>
                ))}
              </div>
            )}
            <div className="row">
              <input
                id="member-input"
                value={memberInput}
                onChange={e => { setMemberInput(e.target.value); setMemberError('') }}
                onKeyDown={e => e.key === 'Enter' && addMember()}
                placeholder="Type a name and press Enter"
                className="flex-1"
              />
              <button className="btn btn-secondary" onClick={addMember} style={{ width: 'auto', flexShrink: 0 }}>
                Add
              </button>
            </div>
            {memberError && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{memberError}</p>}
            <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
              {members.length === 0 ? 'Add at least 2 members'
                : members.length === 1 ? 'Add at least 1 more'
                : `${members.length} members`}
            </p>
          </div>

          {/* Currency */}
          <div>
            <label>Base currency</label>
            <div className="currency-grid">
              {CURRENCIES.map(c => (
                <button
                  key={c.code}
                  className={`cur-btn${currency === c.code ? ' active' : ''}`}
                  onClick={() => setCurrency(c.code)}
                >
                  {c.code}<br />
                  <span style={{ fontSize: 16 }}>{c.symbol}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn btn-primary"
            disabled={!canSubmit || loading}
            onClick={handleSubmit}
            style={{ marginTop: 4 }}
          >
            {loading ? 'Creating…' : 'Create group →'}
          </button>
        </div>
      </div>
    </>
  )
}
