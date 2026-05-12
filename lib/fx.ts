// Exchange rates via frankfurter.app — free, no API key needed
import { Redis } from '@upstash/redis'

const MEM_CACHE = new Map<string, { rates: Record<string, number>; fetchedAt: number }>()

const CACHE_TTL_S  = 60 * 60         // same, in seconds — used for Redis EX
const CACHE_TTL_MS = 1000 * CACHE_TTL_S // 1 hour
const SESSION_KEY = (base: string) => `splitmate_fx_${base}`
const KV_KEY       = (base: string) => `fx:rates:${base}`

// ── Upstash Redis singleton ──────────────────────────────────────────────────
// Reused across warm invocations; null in local dev without env vars set.
// UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are already required by
// the rate-limiter, so no new infrastructure is needed.
let _redis: Redis | null = null
function getRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null   // degrade gracefully in local dev
  return (_redis ??= new Redis({ url, token }))
}

async function readKvCache(base: string): Promise<Record<string, number> | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    const value = await redis.get<Record<string, number>>(KV_KEY(base))
    return value ?? null
  } catch { return null }
}

async function writeKvCache(base: string, rates: Record<string, number>): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.set(KV_KEY(base), rates, { ex: CACHE_TTL_S })
  } catch { /* non-fatal — next request will try again */ }
}

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
 * Checks in-memory → sessionStorage → Upstash KV → network, in that order.
 */
export async function getRates(baseCurrency: string): Promise<Record<string, number>> {
  const now = Date.now()

  // 1. In-memory (fastest — same component re-render / warm serverless instance)
  //    Map.get is atomic, fixing the concurrent-request race (issue D).
  const mem = MEM_CACHE.get(baseCurrency)
  if (mem && now - mem.fetchedAt < CACHE_TTL_MS) return mem.rates

  // 2. sessionStorage (survives page navigation within the same browser tab)
  const session = readSessionCache(baseCurrency)
  if (session) { MEM_CACHE.set(baseCurrency, { rates: session, fetchedAt: now }); return session }

  // 3. Upstash KV (survives cold starts across the entire serverless fleet)
  const kv = await readKvCache(baseCurrency)
  if (kv) {
    MEM_CACHE.set(baseCurrency, { rates: kv, fetchedAt: now })
    writeSessionCache(baseCurrency, kv)
    return kv
  }

  // 4. Network — last resort; result is written to all cache layers
  const others = SUPPORTED_CURRENCIES.filter(c => c !== baseCurrency).join(',')
  const url = `https://api.frankfurter.dev/v1/latest?from=${baseCurrency}&to=${others}`
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    const data = await res.json()
    const rates: Record<string, number> = { [baseCurrency]: 1, ...data.rates }
    MEM_CACHE.set(baseCurrency, { rates, fetchedAt: now })
    writeSessionCache(baseCurrency, rates)
    // Fire-and-forget: don't block the response on the KV write.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    writeKvCache(baseCurrency, rates)
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