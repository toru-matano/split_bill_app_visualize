import type { Transfer, Member } from './supabase'

type BalanceInput = {
  // payers: who paid how much (replaces simple expenses array)
  payers: { member_id: string; amount: number }[]
  splits: { member_id: string; amount: number }[]
  members: Member[]
}

export function calculateSettlement({ payers, splits, members }: BalanceInput): Transfer[] {
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]))
  const balances: Record<string, number> = {}
  members.forEach(m => { balances[m.id] = 0 })

  // Credit everyone who paid
  payers.forEach(p => {
    balances[p.member_id] = (balances[p.member_id] ?? 0) + Number(p.amount)
  })
  // Debit everyone who owes
  splits.forEach(s => {
    balances[s.member_id] = (balances[s.member_id] ?? 0) - Number(s.amount)
  })

  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0.01)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount)

  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -0.01)
    .map(([id, amount]) => ({ id, amount: -amount }))
    .sort((a, b) => b.amount - a.amount)

  const transfers: Transfer[] = []
  let i = 0, j = 0

  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i]
    const debt = debtors[j]
    const amount = Math.min(credit.amount, debt.amount)

    if (amount > 0.01) {
      transfers.push({
        from: debt.id, to: credit.id,
        fromName: memberMap[debt.id] ?? debt.id,
        toName: memberMap[credit.id] ?? credit.id,
        amount: Math.round(amount),
      })
    }

    credit.amount -= amount
    debt.amount -= amount
    if (credit.amount < 0.01) i++
    if (debt.amount < 0.01) j++
  }

  return transfers
}
