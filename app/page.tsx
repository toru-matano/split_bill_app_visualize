'use client'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n'
import LangPicker from '@/components/LangPicker'

export default function Home() {
  const router = useRouter()
  const { t } = useI18n()
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <LangPicker />
      </div>
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🧾</div>
        <h1 style={{ marginBottom: 8 }}>{t('app.name')}</h1>
        <p style={{ marginBottom: 32 }}>{t('app.tagline')}<br />{t('app.taglineSub')}</p>
        <button className="btn btn-primary" onClick={() => router.push('/create')}>
          {t('home.createGroup')}
        </button>
        <p className="text-muted mt-3">{t('home.hint')}</p>
      </div>
    </main>
  )
}
