// Exchange rates via frankfurter.app — free, no API key needed
// Rates are cached per session in memory to avoid hammering the API

const cache: Record<string, { rates: Record<string, number>; fetchedAt: number }> = {}
const CACHE_TTL_MS = 1000 * 60 * 60 // 1 hour

export const SUPPORTED_CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'CNY', 'KRW', 'SGD', 'THB', 'HKD']

export const CURRENCY_SYMBOLS: Record<string, string> = {
  JPY: '¥', USD: '$', EUR: '€', GBP: '£',
  AUD: 'A$', CAD: 'C$', CHF: 'Fr', CNY: '¥',
  KRW: '₩', SGD: 'S$', THB: '฿', HKD: 'HK$',
}

export const CURRENCY_NAMES: Record<string, string> = {
  JPY: 'Japanese Yen', USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound',
  AUD: 'Australian Dollar', CAD: 'Canadian Dollar', CHF: 'Swiss Franc',
  CNY: 'Chinese Yuan', KRW: 'Korean Won', SGD: 'Singapore Dollar',
  THB: 'Thai Baht', HKD: 'Hong Kong Dollar',
}

/**
 * Fetch exchange rates with base currency.
 * Returns a map: { USD: 1.08, GBP: 0.86, ... } (how many units of each currency = 1 base unit)
 */
export async function getRates(baseCurrency: string): Promise<Record<string, number>> {
  const now = Date.now()
  const cached = cache[baseCurrency]
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rates
  }

  const url = `https://api.frankfurter.dev/v1/latest?from=${baseCurrency}&to=${SUPPORTED_CURRENCIES.filter(c => c !== baseCurrency).join(',')}`
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    const data = await res.json()
    const rates: Record<string, number> = { [baseCurrency]: 1, ...data.rates }
    cache[baseCurrency] = { rates, fetchedAt: now }
    return rates
  } catch (error) {
    // Return identity if fetch fails — better than crashing
    console.warn(`Failed to fetch exchange rates from ${url}\n— using fallback. Error:`, error)
    return Object.fromEntries(SUPPORTED_CURRENCIES.map(c => [c, 1]))
  }
}

/**
 * Convert an amount from one currency to another using fetched rates.
 * rate = how many units of `to` per 1 unit of `from`
 */
export function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount
  const fromRate = rates[from] ?? 1
  const toRate = rates[to] ?? 1
  // rates are relative to baseCurrency: convert via base
  // amount_in_base = amount / fromRate (if base→from = fromRate, then from→base = 1/fromRate)
  // But frankfurter gives rates as: 1 base = X foreign
  // So: amount in `from` → base: amount / rates[from], then base → `to`: * rates[to]
  return (amount / fromRate) * toRate
}
