'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import enMessages from '@/messages/en.json'

export const LOCALES = ['en', 'ja', 'zh', 'ko', 'fr', 'es'] as const
export type Locale = typeof LOCALES[number]

type Messages = Record<string, Record<string, string>>

const MessagesContext = createContext<{
  t: (key: string, vars?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (l: Locale) => void
}>({
  t: (k) => k,
  locale: 'en',
  setLocale: () => {},
})

const cache: Partial<Record<Locale, Messages>> = { en: enMessages as Messages }

async function loadMessages(locale: Locale): Promise<Messages> {
  if (cache[locale]) return cache[locale]!
  const mod = await import(`@/messages/${locale}.json`)
  cache[locale] = mod.default as Messages
  return cache[locale]!
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')
  const [messages, setMessages] = useState<Messages>(enMessages as Messages)

  const applyLocale = useCallback(async (l: Locale) => {
    const msgs = await loadMessages(l)
    setMessages(msgs)
    setLocaleState(l)
    if (typeof window !== 'undefined') {
      localStorage.setItem('splitmate_locale', l)
      document.documentElement.lang = l
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const saved = localStorage.getItem('splitmate_locale') as Locale | null
    const detected = navigator.language.split('-')[0] as Locale
    const initial = (saved && LOCALES.includes(saved)) ? saved : (LOCALES.includes(detected) ? detected : 'en')
    if (initial !== 'en') Promise.resolve().then(() => applyLocale(initial))
  }, [applyLocale])

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const [ns, ...rest] = key.split('.')
    let val: string = (messages[ns]?.[rest.join('.')] ?? key)
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        val = val.replace(`{${k}}`, String(v))
      })
    }
    return val
  }, [messages])

  return (
    <MessagesContext.Provider value={{ t, locale, setLocale: applyLocale }}>
      {children}
    </MessagesContext.Provider>
  )
}

export function useI18n() {
  return useContext(MessagesContext)
}
