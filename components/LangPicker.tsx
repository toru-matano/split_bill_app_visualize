'use client'
import { useI18n, LOCALES, type Locale } from '@/lib/i18n'

const FLAG: Record<Locale, string> = {
  en: 'EN', ja: 'JP', zh: 'CN', ko: 'KR', fr: 'FR', es: 'ES',
}

export default function LangPicker() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <select
        value={locale}
        onChange={e => setLocale(e.target.value as Locale)}
        style={{
          height: 32, padding: '0 28px 0 8px', fontSize: 13,
          border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)',
          background: 'var(--surface)', color: 'var(--ink)',
          fontFamily: 'inherit', cursor: 'pointer', width: 'auto',
          appearance: 'none', WebkitAppearance: 'none',
        }}
        aria-label={t('lang.label')}
      >
        {LOCALES.map(l => (
          <option key={l} value={l}>{FLAG[l]} {t(`lang.${l}`)}</option>
        ))}
      </select>
      <span style={{
        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
        fontSize: 10, color: 'var(--ink-3)', pointerEvents: 'none',
      }}>▾</span>
    </div>
  )
}
