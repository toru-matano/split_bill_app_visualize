// Exchange rates via frankfurter.app — free, no API key needed

const MEM_CACHE: Record<string, { rates: Record<string, number>; fetchedAt: number }> = {}
const CACHE_TTL_MS = 1000 * 60 * 60 // 1 hour
const SESSION_KEY = (base: string) => `splitmate_fx_${base}`

export const SUPPORTED_CURRENCIES = ['JPY','USD','EUR','GBP','AUD','CAD','CHF','CNY','KRW','SGD','THB','HKD']

export const CURRENCY_SYMBOLS: Record<string, string> = {
  JPY: '¥',  USD: '$',  EUR: '€',  GBP: '£',
  AUD: 'A$', CAD: 'C$', CHF: 'Fr', CNY: '¥',
  KRW: '₩',  SGD: 'S$', THB: '฿', HKD: 'HK$',
}

export const CURRENCY_NAMES: Record<string, string> = {
  JPY: 'Japanese Yen',      USD: 'US Dollar',       EUR: 'Euro',
  GBP: 'British Pound',     AUD: 'Australian Dollar', CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',       CNY: 'Chinese Yuan',    KRW: 'Korean Won',
  SGD: 'Singapore Dollar',  THB: 'Thai Baht',       HKD: 'Hong Kong Dollar',
}

function readSessionCache(base: string): Record<string, number> | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(base))
    if (!raw) return null
    const { rates, fetchedAt } = JSON.parse(raw)
    if (Date.now() - fetchedAt < CACHE_TTL_MS) return rates
  } catch { /* corrupt entry */ }
  return null
}

function writeSessionCache(base: string, rates: Record<string, number>) {
  if (typeof sessionStorage === 'undefined') return
  try { sessionStorage.setItem(SESSION_KEY(base), JSON.stringify({ rates, fetchedAt: Date.now() })) } catch { /* quota */ }
}

/**
 * Returns rates relative to baseCurrency.
 * Checks in-memory → sessionStorage → network, in that order.
 */
export async function getRates(baseCurrency: string): Promise<Record<string, number>> {
  const now = Date.now()

  // 1. In-memory (fastest — same component re-render)
  const mem = MEM_CACHE[baseCurrency]
  if (mem && now - mem.fetchedAt < CACHE_TTL_MS) return mem.rates

  // 2. sessionStorage (survives page navigation within the same tab)
  const session = readSessionCache(baseCurrency)
  if (session) { MEM_CACHE[baseCurrency] = { rates: session, fetchedAt: now }; return session }

  // 3. Network
  const others = SUPPORTED_CURRENCIES.filter(c => c !== baseCurrency).join(',')
  const url = `https://api.frankfurter.dev/v1/latest?from=${baseCurrency}&to=${others}`
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    const data = await res.json()
    const rates: Record<string, number> = { [baseCurrency]: 1, ...data.rates }
    MEM_CACHE[baseCurrency] = { rates, fetchedAt: now }
    writeSessionCache(baseCurrency, rates)
    return rates
  } catch (err) {
    console.warn('FX fetch failed, using identity rates:', err)
    return Object.fromEntries(SUPPORTED_CURRENCIES.map(c => [c, 1]))
  }
}

export function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount
  const fromRate = rates[from] ?? 1
  const toRate   = rates[to]   ?? 1
  return (amount / fromRate) * toRate
}

const MaximumFractionDigits = 2
export const thresholdMismatch = 10 ** -MaximumFractionDigits // Allowed mismatch in totals due to rounding, etc.

export function formatNumber(amount: number): string {
  return `${
    amount.toLocaleString(undefined, {
        minimumFractionDigits: 0, maximumFractionDigits: MaximumFractionDigits
    })
  }`
}