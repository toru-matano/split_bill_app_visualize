'use client'
import { useEffect } from 'react'

// ─── SuccessPopup ─────────────────────────────────────────────────────────────
// Single shared implementation — was previously duplicated in ExpenseForm and settle/page.tsx

export function SuccessPopup({ message, onClose, durationMs = 2500 }: {
  message: string
  onClose: () => void
  durationMs?: number
}) {
  useEffect(() => {
    const t = setTimeout(onClose, durationMs)
    return () => clearTimeout(t)
  }, [onClose, durationMs])

  return (
    <div style={{
      position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, background: '#22c55e', color: 'white',
      padding: '12px 24px', borderRadius: 12,
      boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
      fontSize: 14, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 8,
      animation: 'slideDown 0.3s ease',
      whiteSpace: 'nowrap',
    }}>
      ✓ {message}
    </div>
  )
}

// ─── ErrorPopup ───────────────────────────────────────────────────────────────

export function ErrorPopup({ message, onClose, durationMs = 3500 }: {
  message: string
  onClose: () => void
  durationMs?: number
}) {
  useEffect(() => {
    const t = setTimeout(onClose, durationMs)
    return () => clearTimeout(t)
  }, [onClose, durationMs])

  return (
    <div style={{
      position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, background: '#dc2626', color: 'white',
      padding: '12px 24px', borderRadius: 12,
      boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
      fontSize: 14, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 8,
      animation: 'slideDown 0.3s ease',
      whiteSpace: 'nowrap',
    }}>
      ✕ {message}
    </div>
  )
}

// ─── DeleteModal ──────────────────────────────────────────────────────────────

export function DeleteModal({
  onConfirm, onCancel, label,
  confirmTitle, confirmMsg, confirmBtn, cancelBtn,
}: {
  onConfirm: () => void
  onCancel: () => void
  label: string
  confirmTitle: string
  confirmMsg: string
  confirmBtn: string
  cancelBtn: string
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.45)',
      zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)',
        padding: 24, maxWidth: 340, width: '100%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 12 }}>🗑️</div>
        <h2 style={{ textAlign: 'center', marginBottom: 6, fontSize: 17 }}>{confirmTitle}</h2>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', marginBottom: 4 }}>{label}</p>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', marginBottom: 24 }}>{confirmMsg}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>{cancelBtn}</button>
          <button
            className="btn"
            style={{ flex: 1, background: 'var(--danger)', color: 'white', border: 'none' }}
            onClick={onConfirm}
          >{confirmBtn}</button>
        </div>
      </div>
    </div>
  )
}
