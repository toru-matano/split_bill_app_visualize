// Lightweight input validation — used in all API routes

export class ValidationError extends Error {
  constructor(public message: string, public status = 400) { super(message) }
}

const VALID_CATEGORIES = ['general','food','transport','hotel','activities','shopping','other'] as const
const VALID_CURRENCIES = ['JPY','USD','EUR','GBP','AUD','CAD','CHF','CNY','KRW','SGD','THB','HKD'] as const

export function validateExpenseInput(body: unknown) {
  const b = body as Record<string, unknown>

  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 200) : ''
  if (!label) throw new ValidationError('label is required and must be a non-empty string')

  const category = typeof b.category === 'string' && VALID_CATEGORIES.includes(b.category as typeof VALID_CATEGORIES[number])
    ? b.category : 'other'

  const payers = b.payers
  if (!Array.isArray(payers) || payers.length === 0) throw new ValidationError('payers must be a non-empty array')
  for (const p of payers) {
    if (typeof p !== 'object' || !p) throw new ValidationError('each payer must be an object')
    if (typeof (p as Record<string,unknown>).memberId !== 'string') throw new ValidationError('payer.memberId must be a string')
    const amt = Number((p as Record<string,unknown>).amount)
    if (!isFinite(amt) || amt <= 0) throw new ValidationError('payer.amount must be a positive number')
  }

  const splitAmong = b.splitAmong
  if (!Array.isArray(splitAmong) || splitAmong.length === 0) throw new ValidationError('splitAmong must be a non-empty array')

  const splitAmounts = Array.isArray(b.splitAmounts) ? b.splitAmounts : null
  if (splitAmounts) {
    for (const a of splitAmounts) {
      const amt = Number(a)
      if (!isFinite(amt) || amt < 0) throw new ValidationError('splitAmounts must contain non-negative numbers')
    }
  }

  const totalAmount = payers.reduce((s: number, p) => s + Number((p as Record<string,unknown>).amount), 0)
  if (totalAmount <= 0) throw new ValidationError('total expense amount must be positive')

  const originalCurrency = typeof b.originalCurrency === 'string' && VALID_CURRENCIES.includes(b.originalCurrency as typeof VALID_CURRENCIES[number])
    ? b.originalCurrency : null
  const originalAmount = typeof b.originalAmount === 'number' && b.originalAmount > 0 ? b.originalAmount : null
  const exchangeRate = typeof b.exchangeRate === 'number' && b.exchangeRate > 0 ? b.exchangeRate : null
  const expenseDate = typeof b.expenseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.expenseDate) ? b.expenseDate : null

  return { label, category, payers, splitAmong, splitAmounts, totalAmount, originalCurrency, originalAmount, exchangeRate, expenseDate }
}

export function validateGroupInput(body: unknown) {
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : ''
  if (!name) throw new ValidationError('name is required')
  const members = Array.isArray(b.members) ? b.members as string[] : []
  if (members.length < 2) throw new ValidationError('at least 2 members required')
  const validMembers = members.map((m: unknown) => {
    if (typeof m !== 'string' || !m.trim()) throw new ValidationError('member names must be non-empty strings')
    return m.trim().slice(0, 100)
  })
  const currency = typeof b.currency === 'string' && VALID_CURRENCIES.includes(b.currency as typeof VALID_CURRENCIES[number])
    ? b.currency : 'JPY'
  return { name, members: validMembers, currency }
}

export function validatePushEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string') throw new ValidationError('endpoint must be a string')
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') throw new ValidationError('endpoint must be an HTTPS URL')
    return endpoint
  } catch {
    throw new ValidationError('endpoint must be a valid HTTPS URL')
  }
}
