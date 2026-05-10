'use client'

import { useI18n } from '@/lib/i18n'
import { useState } from 'react'

export function DeleteModal({
  onConfirm, onCancel, label,
  confirmTitle, confirmMsg, confirmBtn, cancelBtn, strictMode = false,
}: {
  onConfirm: () => void; onCancel: () => void; label: string
  confirmTitle: string; confirmMsg: string; confirmBtn: string; cancelBtn: string, strictMode?: boolean
}) {
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const { t } = useI18n()
  const canDelete = deleteConfirm === label
  const [deleting, setDeleting] = useState(false)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24, maxWidth: 340, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 12 }}>🗑️</div>
        <h2 style={{ textAlign: 'center', marginBottom: 6, fontSize: 17 }}>{confirmTitle}</h2>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', marginBottom: 4 }}>{label}</p>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', marginBottom: 24 }}>{confirmMsg}</p>
        { strictMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>{t('settings.confirmDelete')}</p>
            <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder={t('settings.confirmDeletePlaceholder')} style={{ borderColor: deleteConfirm && !canDelete ? 'var(--danger)' : undefined }} autoFocus />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>{cancelBtn}</button>
              <button className="btn"
                style={{ flex: 1, background: canDelete ? 'var(--danger)' : 'var(--surface-3)', color: canDelete ? 'white' : 'var(--ink-3)', opacity: deleting ? 0.6 : 1, cursor: canDelete ? 'pointer' : 'default', border: 'none' }}
                disabled={!canDelete || deleting}
                onClick={() => { onConfirm(); setDeleting(true); }}
              >
                {deleting ? '…' : confirmBtn}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>{cancelBtn}</button>
            <button
              className="btn"
              style={{ flex: 1, background: 'var(--danger)', color: 'white', border: 'none' }}
              onClick={onConfirm}
            >{confirmBtn}</button>
          </div>
        )}
      </div>
    </div>
  )
}