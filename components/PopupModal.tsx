'use client'

export function DeleteModal({
  onConfirm, onCancel, label,
  confirmTitle, confirmMsg, confirmBtn, cancelBtn,
}: {
  onConfirm: () => void; onCancel: () => void; label: string
  confirmTitle: string; confirmMsg: string; confirmBtn: string; cancelBtn: string
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24, maxWidth: 340, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
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