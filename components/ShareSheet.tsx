'use client'
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useI18n } from '@/lib/i18n'

type Props = { url: string; groupName: string; onClose: () => void }

export default function ShareSheet({ url, groupName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: 220, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } })
    }
  }, [url])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const copyLink = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const nativeShare = () => {
    navigator.share({ title: t('share.nativeTitle', { name: groupName }), text: t('share.nativeText'), url }).catch(() => {})
  }

  const downloadQR = () => {
    const dataUrl = canvasRef.current?.toDataURL('image/png')
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl; a.download = `${groupName}-qr.png`; a.click()
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 env(safe-area-inset-bottom)' }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '12px 24px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-2)', marginBottom: 20 }} />
        <h2 style={{ marginBottom: 4 }}>{t('share.title')}</h2>
        <p style={{ marginBottom: 24, textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>
          {t('share.sub', { name: groupName })}
        </p>
        <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 16, padding: 16, marginBottom: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <canvas ref={canvasRef} style={{ borderRadius: 8, display: 'block' }} />
          <button onClick={downloadQR} style={{ fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>
            {t('share.saveQR')}
          </button>
        </div>
        <div style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: 'var(--ink-2)', fontFamily: 'DM Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 12 }}>
          {url}
        </div>
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={copyLink}>
            {copied ? t('share.copied') : t('share.copyLink')}
          </button>
          {canNativeShare && (
            <button className="btn btn-secondary" style={{ flex: 1, width: 'auto' }} onClick={nativeShare}>
              {t('share.share')}
            </button>
          )}
        </div>
        <button onClick={onClose} style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
          {t('share.close')}
        </button>
      </div>
    </div>
  )
}
