'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { primeGroupCache } from '@/hooks/useGroup'
import LangPicker from '@/components/LangPicker'

export default function Home() {
  const router = useRouter()
  const { t } = useI18n()
  const [recentGroups, setRecentGroups] = useState<{ name: string; shareToken: string }[]>([])

  useEffect(() => {
    const saved = localStorage.getItem('splitmate_recent_groups')
    if (saved) setRecentGroups(JSON.parse(saved))
  }, [])

  return (
    <>
      <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', paddingBottom: '100px' }}>
        <div style={{ position: 'absolute', top: 16, right: 16 }}>
          <LangPicker />
        </div>

        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>
            <img src="/icon-192.png" alt="SplitMate Logo" style={{ width: '100%', maxWidth: 100, height: 'auto' }} />
          </div>
          <h1 style={{ marginBottom: 8 }}>{t('app.name')}</h1>
          <p style={{ marginBottom: 32 }}>{t('app.tagline')}<br />{t('app.taglineSub')}</p>
          <p className="text-muted mt-3">{t('home.hint')}</p>

          {recentGroups.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <i className="fa-solid fa-clock-rotate-left" style={{ fontSize: 13 }} />
                {t('home.recentGroups')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentGroups.map((group, index) => (
                  <button
                    key={index}
                    className="btn btn-secondary"
                    // Hover prefetch: start loading group data before the click
                    onMouseEnter={() => primeGroupCache(group.shareToken)}
                    onFocus={() => primeGroupCache(group.shareToken)}
                    onClick={() => router.push(`/group/${group.shareToken}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <i className="fa-solid fa-receipt" style={{ fontSize: 13 }} />
                    {group.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Fixed bottom CTA */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '16px 24px',
        background: 'rgba(247,246,243,0.92)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 50,
      }}>
        <button
          className="btn btn-primary"
          onClick={() => router.push('/create')}
          style={{ maxWidth: 400, width: '100%', height: 52, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
        >
          <i className="fa-solid fa-plus" style={{ fontSize: 16 }} />
          {t('home.createGroup')}
        </button>
      </div>
    </>
  )
}
