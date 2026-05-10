import type { Transfer, Member } from './supabase'
import { thresholdMismatch } from './fx';

type BalanceInput = {
  payers: { member_id: string; amount: number }[]
  splits:  { member_id: string; amount: number }[]
  members: Member[]
}

/**
 * Compute net balance per member.
 * Positive = gets money back. Negative = owes money.
 * Extracted here so settle, summary, and member pages all use the same logic.
 */
export function computeBalances(
  payers: { member_id: string; amount: number }[],
  splits:  { member_id: string; amount: number }[],
  members: Member[],
): Record<string, number> {
  const balances: Record<string, number> = {}
  members.forEach(m => { balances[m.id] = 0 })
  payers.forEach(p => { balances[p.member_id] = (balances[p.member_id] ?? 0) + Number(p.amount) })
  splits.forEach(s =>  { balances[s.member_id] = (balances[s.member_id] ?? 0) - Number(s.amount) })
  return balances
}

/**
 * Greedy two-pointer settlement algorithm.
 * Produces the minimum number of transfers to clear all debts.
 */
export function calculateSettlement({ payers, splits, members }: BalanceInput): Transfer[] {
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]))
  const balances = computeBalances(payers, splits, members)

  const creditors = Object.entries(balances)
    .filter(([, v]) => v > thresholdMismatch)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount)

  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -thresholdMismatch)
    .map(([id, amount]) => ({ id, amount: -amount }))
    .sort((a, b) => b.amount - a.amount)

  const transfers: Transfer[] = []
  let i = 0, j = 0

  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i]
    const debt   = debtors[j]
    const amount = Math.min(credit.amount, debt.amount)

    if (amount > thresholdMismatch) {
      transfers.push({
        from: debt.id, to: credit.id,
        fromName: memberMap[debt.id]   ?? debt.id,
        toName:   memberMap[credit.id] ?? credit.id,
        amount: amount,
      })
    }

    credit.amount -= amount
    debt.amount   -= amount
    if (credit.amount < thresholdMismatch) i++
    if (debt.amount   < thresholdMismatch) j++
  }

  return transfers
}

/**
 * Re-calculate suggested transfers from an already-computed balance map.
 * Used by the settle page after applying real-money transfer records.
 */
export function settleFromBalances(
  balances: Record<string, number>,
  members: Member[],
): Transfer[] {
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]))
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > thresholdMismatch)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount)
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -thresholdMismatch)
    .map(([id, amount]) => ({ id, amount: -amount }))
    .sort((a, b) => b.amount - a.amount)

  const transfers: Transfer[] = []
  let i = 0, j = 0
  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i], debt = debtors[j]
    const amount = Math.min(credit.amount, debt.amount)
    if (amount > thresholdMismatch) {
      transfers.push({ from: debt.id, to: credit.id, fromName: memberMap[debt.id] ?? debt.id, toName: memberMap[credit.id] ?? credit.id, amount: amount })
    }
    credit.amount -= amount; debt.amount -= amount
    if (credit.amount < thresholdMismatch) i++
    if (debt.amount < thresholdMismatch) j++
  }
  return transfers
}
