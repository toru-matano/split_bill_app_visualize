'use client'
import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { computeBalances, settleFromBalances } from '@/lib/settle'
import type { Transfer } from '@/lib/supabase'
import { CURRENCY_SYMBOLS } from '@/lib/fx'
import { useI18n } from '@/lib/i18n'
import { useGroup } from '@/hooks/useGroup'
import LangPicker from '@/components/LangPicker'
import { DeleteModal, SuccessPopup } from '@/components/PopupModal'

type PageProps = { params: Promise<{ token: string }> }

type TransferRecord = {
  id: string
  group_id: string
  from_member_id: string
  to_member_id: string
  amount: number
  note: string | null
  transfer_date: string
  created_at: string
}


const todayStr = () => new Date().toISOString().split('T')[0]

export default function SettlePage({ params }: PageProps) {
  const { token } = use(params)
  const router = useRouter()
  const { t } = useI18n()
  const { loading: groupLoading, group, members } = useGroup(token)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [transferRecords, setTransferRecords] = useState<TransferRecord[]>([])
  const [baseBalances, setBaseBalances] = useState<Record<string, number>>({})
  const [netBalances, setNetBalances] = useState<Record<string, number>>({})
  const [dataLoading, setDataLoading] = useState(true)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // Add form state
  const [showForm, setShowForm] = useState(false)
  const [fromMember, setFromMember] = useState('')
  const [toMember, setToMember] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [transferDate, setTransferDate] = useState(todayStr())
  const [submitting, setSubmitting] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)

  const applyTransferRecords = useCallback((base: Record<string, number>, records: TransferRecord[]): Record<string, number> => {
    const bal = { ...base }
    records.forEach(tr => {
      bal[tr.from_member_id] = (bal[tr.from_member_id] ?? 0) + Number(tr.amount)
      bal[tr.to_member_id] = (bal[tr.to_member_id] ?? 0) - Number(tr.amount)
    })
    return bal
  }, [])

  useEffect(() => {
    if (!group || members.length === 0) return
    if (members.length >= 2) { setFromMember(members[0].id); setToMember(members[1].id) }
    ;(async () => {
      const { data: exps } = await supabase.from('expenses').select('id').eq('group_id', group.id)
      const expIds = (exps ?? []).map((e: { id: string }) => e.id)

      const [payersRes, splitsRes, trsRes] = await Promise.all([
        expIds.length
          ? supabase.from('expense_payers').select('member_id, amount').in('expense_id', expIds)
          : Promise.resolve({ data: [] as { member_id: string; amount: number }[] }),
        expIds.length
          ? supabase.from('expense_splits').select('member_id, amount').in('expense_id', expIds)
          : Promise.resolve({ data: [] as { member_id: string; amount: number }[] }),
        supabase.from('transfer_records').select('*').eq('group_id', group.id).order('transfer_date', { ascending: false }),
      ])

      const base = computeBalances(payersRes.data ?? [], splitsRes.data ?? [], members)
      setBaseBalances(base)
      const records: TransferRecord[] = (trsRes.data ?? []) as TransferRecord[]
      setTransferRecords(records)
      const net = applyTransferRecords(base, records)
      setNetBalances(net)
      setTransfers(settleFromBalances(net, members))
      setDataLoading(false)
    })()
  }, [group, members, applyTransferRecords])

  const loading = groupLoading || dataLoading
  const sym = CURRENCY_SYMBOLS[group?.currency ?? 'JPY'] ?? '¥'
  const maxAbs = Math.max(...Object.values(netBalances).map(Math.abs), 1)
  const memberName = (id: string) => members.find(m => m.id === id)?.name ?? id

  const handleSubmit = async () => {
    if (!group || !fromMember || !toMember || !amount || fromMember === toMember) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupToken: token,
          fromMemberId: fromMember,
          toMemberId: toMember,
          amount: Number(amount),
          note: note.trim() || null,
          transferDate,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const newRecords = [data, ...transferRecords]
        setTransferRecords(newRecords)
        const net = applyTransferRecords(baseBalances, newRecords)
        setNetBalances(net); setTransfers(settleFromBalances(net, members))
        setSuccessMsg(`Recorded: ${memberName(fromMember)} → ${memberName(toMember)} ${sym}${Number(amount).toLocaleString()}`)
        setShowSuccess(true)
        setAmount(''); setNote(''); setShowForm(false)
      }
    } catch { }
    setSubmitting(false)
  }

  const startEdit = (record: TransferRecord) => {
    setEditingId(record.id)
    setEditFrom(record.from_member_id)
    setEditTo(record.to_member_id)
    setEditAmount(String(record.amount))
    setEditNote(record.note ?? '')
    setEditDate(record.transfer_date)
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async () => {
    if (!editingId || !editFrom || !editTo || !editAmount || editFrom === editTo) return
    setEditSaving(true)
    const { data, error } = await supabase.from('transfer_records')
      .update({ from_member_id: editFrom, to_member_id: editTo, amount: Number(editAmount), note: editNote.trim() || null, transfer_date: editDate })
      .eq('id', editingId).select().single()
    if (!error && data) {
      const newRecords = transferRecords.map(r => r.id === editingId ? data : r)
      setTransferRecords(newRecords)
      const net = applyTransferRecords(baseBalances, newRecords)
      setNetBalances(net); setTransfers(settleFromBalances(net, members))
      setSuccessMsg('Transfer updated')
      setShowSuccess(true)
      setEditingId(null)
    }
    setEditSaving(false)
  }

  const handleDelete = async (id: string) => {
    setDeleteTarget(null)
    // if (!confirm('Delete this transfer record?')) return
    await fetch(`/api/transfers?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`, { method: 'DELETE' })
    const newRecords = transferRecords.filter(r => r.id !== id)
    setTransferRecords(newRecords)
    const net = applyTransferRecords(baseBalances, newRecords)
    setNetBalances(net); setTransfers(settleFromBalances(net, members))
  }
  
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p className="text-muted">{t('settle.calculating')}</p></div>

  return (
    <>
      {showSuccess && <SuccessPopup message={successMsg} onClose={() => setShowSuccess(false)} />}
      <style>{`@keyframes slideDown { from { opacity:0; transform: translateX(-50%) translateY(-12px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }`}</style>

      <nav className="navbar">
        <a className="btn-ghost btn" style={{ width: 'auto', height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => router.back()}>
          <i className="fa-solid fa-arrow-left" style={{ fontSize: 13 }} /> Back
        </a>
        <span className="navbar-title">{t('settle.title')}</span>
        <LangPicker />
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Hero */}
        <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
          {transfers.length === 0
            ? <><div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div><h2 style={{ marginBottom: 6 }}>{t('settle.allSettled')}</h2><p className="text-muted">{t('settle.allSettledSub')}</p></>
            : <><div style={{ fontSize: 40, marginBottom: 12 }}>💸</div>
               <h2 style={{ marginBottom: 6 }}>{transfers.length === 1 ? t('settle.transfersNeeded', { count: 1 }) : t('settle.transfersNeededPlural', { count: transfers.length })}</h2>
               <p className="text-muted">{t('settle.minimumPayments')}</p></>
          }
        </div>

        {/* Balance chart */}
        <div>
          <p className="section-title">{t('settle.balanceChart')}</p>
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {members.map(m => {
                const net = netBalances[m.id] ?? 0
                const isPositive = net >= 0
                const barWidth = Math.abs(net) / maxAbs * 100
                return (
                  <div key={m.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="expense-avatar">{m.name.slice(0, 2).toUpperCase()}</div>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</span>
                      </div>
                      <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: net > 0.5 ? 'var(--success)' : net < -0.5 ? 'var(--danger)' : 'var(--ink-3)' }}>
                        {net > 0.5 ? '+' : ''}{sym}{Math.round(net).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ position: 'relative', height: 10, background: 'var(--surface-3)', borderRadius: 5 }}>
                      <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border-2)', zIndex: 1 }} />
                      <div style={{ position: 'absolute', top: 0, height: '100%', borderRadius: 5, width: `${barWidth / 2}%`, left: isPositive ? '50%' : `${50 - barWidth / 2}%`, background: isPositive ? 'var(--success)' : 'var(--danger)', transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--danger)' }}>{t('settle.owes')}</span>
                      <span style={{ fontSize: 10, color: 'var(--success)' }}>{t('settle.getsBack')}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Who pays whom */}
        {transfers.length > 0 && (
          <div>
            <p className="section-title">{t('settle.whoPaysWhom')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transfers.map((tr, i) => (
                <div key={i} className="transfer-item">
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--danger-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--danger)', flexShrink: 0 }}>
                    {tr.fromName.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 500 }}>{tr.fromName} <span style={{ color: 'var(--ink-3)' }}>→</span> {tr.toName}</p>
                  </div>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--success-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--success)', flexShrink: 0 }}>
                    {tr.toName.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="transfer-amount">{sym}{tr.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Record transfer form */}
        {!showForm ? (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <i className="fa-solid fa-plus" style={{ fontSize: 12 }} /> {t('settle.recordTransfer')}
          </button>
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              <i className="fa-solid fa-pen"/>
              {t('settle.newTransfer')}
            </h3>
            <div>
              <label>{t('settle.fromWhoPaid')}</label>
              <select value={fromMember} onChange={e => setFromMember(e.target.value)}>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label>{t('settle.toWhoReceived')}</label>
              <select value={toMember} onChange={e => setToMember(e.target.value)}>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {fromMember === toMember && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{t('settle.senderReceiverDifferent')}</p>}
            </div>
            <div>
              <label>{t('settle.amountLabel')} ({sym})</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" min="0" step="any" style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 500 }} />
            </div>
            <div>
              <label>{t('settle.dateLabel')}</label>
              <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} />
            </div>
            <div>
              <label>{t('settle.noteLabel')}</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('settle.notePlaceholder')} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>{t('settle.cancel')}</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={!fromMember || !toMember || !amount || fromMember === toMember || submitting} onClick={handleSubmit}>
              {submitting ? t('settle.saving') : t('settle.recordTransfer')}
              </button>
            </div>

          </div>
        )}

        {/* Transfer history with edit */}
        <p className="section-title">{t('settle.paymentHistory', { count: transferRecords.length })}</p>
        {transferRecords.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>{t('settle.noTransfers')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {transferRecords.map(record => (
              <div key={record.id}>
                {editingId === record.id ? (
                  /* ── Inline edit form ── */
                  <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 15 }}>
                      <i className="fa-solid fa-pen"/>
                      {t('settle.editTransfer')}
                    </h3>
                    <div>
                      <label>{t('settle.fromWhoPaid')}</label>
                      <select value={editFrom} onChange={e => setEditFrom(e.target.value)}>
                      {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>{t('settle.toWhoReceived')}</label>
                      <select value={editTo} onChange={e => setEditTo(e.target.value)}>
                      {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      {editFrom === editTo && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{t('settle.senderReceiverDifferent')}</p>}
                    </div>
                    <div>
                      <label>{t('settle.amountLabel')} ({sym})</label>
                      <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} placeholder="0" min="0" step="any" style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 500 }} />
                    </div>
                    <div>
                      <label>{t('settle.dateLabel')}</label>
                      <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                    </div>
                    <div>
                      <label>{t('settle.noteLabel')}</label>
                      <input value={editNote} onChange={e => setEditNote(e.target.value)} placeholder={t('settle.notePlaceholder')} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary" style={{ flex: 1 }} onClick={cancelEdit}>{t('settle.cancel')}</button>
                      <button className="btn btn-primary" style={{ flex: 1 }} disabled={!editFrom || !editTo || !editAmount || editFrom === editTo || editSaving} onClick={saveEdit}>
                      {editSaving ? t('settle.saving') : t('settle.recordTransfer')}
                      </button>
                    </div>
                    <button
                      className="btn"
                      onClick={() => setDeleteTarget({ id: record.id, label: `${memberName(record.from_member_id)} → ${memberName(record.to_member_id)}` })}
                      style={{ flex: 1, color: 'white', background: 'var(--danger)', border: 'none', cursor: 'pointer',}}
                    >
                      {t('settle.deleteConfirmBtn')}
                    </button>
                  </div>
                ) : (
                  /* ── Read view ── */
                  <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--danger-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--danger)', flexShrink: 0 }}>
                      {memberName(record.from_member_id).slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                        {memberName(record.from_member_id)} <span style={{ color: 'var(--ink-3)' }}>→</span> {memberName(record.to_member_id)}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {new Date(record.transfer_date).toLocaleDateString()}{record.note ? ` · ${record.note}` : ''}
                      </p>
                    </div>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--success-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--success)', flexShrink: 0 }}>
                      {memberName(record.to_member_id).slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, marginLeft: 8 }}>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 14, color: 'var(--success)' }}>
                        {sym}{Number(record.amount).toLocaleString()}
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => startEdit(record)}
                          style={{ fontSize: 11, color: 'var(--ink-2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <i className="fa-solid fa-pen" style={{ fontSize: 10 }} /> Edit
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <button className="btn btn-secondary" onClick={() => router.push(`/group/${token}`)}>{t('settle.back')}</button>
      </div>

      {deleteTarget && (
        <DeleteModal
          label={deleteTarget.label}
          confirmTitle={t('settle.deleteConfirmTitle')}
          confirmMsg={t('settle.deleteConfirmMsg')}
          confirmBtn={t('settle.deleteConfirmBtn')}
          cancelBtn={t('settle.deleteCancel')}
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

    </>
  )
}
