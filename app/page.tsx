'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import LangPicker from '@/components/LangPicker'

export default function Home() {
  const router = useRouter()
  const { t } = useI18n()
  const [recentGroups, setRecentGroups] = useState<{ name: string; shareToken: string }[]>([])

  useEffect(() => {
    const saved = localStorage.getItem('splitmate_recent_groups')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setRecentGroups(JSON.parse(saved))
  }, [])

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
        {recentGroups.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h3 style={{ marginBottom: 16 }}>{t('home.recentGroups')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentGroups.map((group, index) => (
                <button key={index} className="btn btn-secondary" onClick={() => router.push(`/group/${group.shareToken}`)}>
                  {group.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
