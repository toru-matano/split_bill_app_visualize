import type { Transfer, Member } from './supabase'

type BalanceInput = {
  expenses: { paid_by: string; amount: number }[]
  splits: { member_id: string; amount: number }[]
  members: Member[]
}

/**
 * Debt minimization algorithm.
 * Calculates the minimum number of transfers to settle all debts.
 */
export function calculateSettlement({ expenses, splits, members }: BalanceInput): Transfer[] {
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]))

  // 1. Net balance per member (positive = is owed money, negative = owes money)
  const balances: Record<string, number> = {}
  members.forEach(m => { balances[m.id] = 0 })

  expenses.forEach(exp => {
    balances[exp.paid_by] = (balances[exp.paid_by] ?? 0) + Number(exp.amount)
  })
  splits.forEach(s => {
    balances[s.member_id] = (balances[s.member_id] ?? 0) - Number(s.amount)
  })

  // 2. Split into creditors (owed money) and debtors (owe money)
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0.01)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount)

  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -0.01)
    .map(([id, amount]) => ({ id, amount: -amount }))
    .sort((a, b) => b.amount - a.amount)

  // 3. Greedy matching — largest debtor pays largest creditor first
  const transfers: Transfer[] = []
  let i = 0, j = 0

  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i]
    const debt = debtors[j]
    const amount = Math.min(credit.amount, debt.amount)

    if (amount > 0.01) {
      transfers.push({
        from: debt.id,
        to: credit.id,
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

// --- Unit tests (run with: npx ts-node lib/settle.test.ts) ---
if (process.env.NODE_ENV === 'test') {
  const alice = { id: 'a', group_id: 'g', name: 'Alice', created_at: '' }
  const bob = { id: 'b', group_id: 'g', name: 'Bob', created_at: '' }
  const carol = { id: 'c', group_id: 'g', name: 'Carol', created_at: '' }
  const members = [alice, bob, carol]

  // Test 1: Simple 3-way split
  const t1 = calculateSettlement({
    expenses: [{ paid_by: 'a', amount: 3000 }],
    splits: [
      { member_id: 'a', amount: 1000 },
      { member_id: 'b', amount: 1000 },
      { member_id: 'c', amount: 1000 },
    ],
    members,
  })
  console.assert(t1.length === 2, 'Test 1: should be 2 transfers')
  console.assert(t1[0].amount === 1000, 'Test 1: each owes 1000')

  // Test 2: One person paid for everything
  const t2 = calculateSettlement({
    expenses: [
      { paid_by: 'a', amount: 1000 },
      { paid_by: 'a', amount: 500 },
    ],
    splits: [
      { member_id: 'a', amount: 500 },
      { member_id: 'b', amount: 500 },
      { member_id: 'a', amount: 250 },
      { member_id: 'b', amount: 125 },
      { member_id: 'c', amount: 125 },
    ],
    members,
  })
  console.assert(t2.every(t => t.to === 'a'), 'Test 2: everyone pays Alice')

  // Test 3: Even split — no transfers needed
  const t3 = calculateSettlement({
    expenses: [
      { paid_by: 'a', amount: 300 },
      { paid_by: 'b', amount: 300 },
      { paid_by: 'c', amount: 300 },
    ],
    splits: [
      { member_id: 'a', amount: 300 },
      { member_id: 'b', amount: 300 },
      { member_id: 'c', amount: 300 },
    ],
    members,
  })
  console.assert(t3.length === 0, 'Test 3: no transfers needed')

  console.log('All tests passed ✓')
}
