# ExpenseForm.tsx — targeted patch (edit pre-fill)

Only two changes needed in `components/ExpenseForm.tsx`.

---

## 1. Add import (after the existing imports, around line 11)

```ts
import { fetchExpense } from '@/lib/expenses-api'
```

---

## 2. Replace the direct Supabase expense read (line 105)

BEFORE:
```ts
const { data: exp } = await supabase.from('expenses').select('*').eq('id', expenseId).single()
if (!exp) { setFetching(false); return }
```

AFTER:
```ts
const exp = await fetchExpense(expenseId)
if (!exp) { setFetching(false); return }
```

The rest of the pre-fill code (`setLabel`, `setCategory`, `setExpenseDate`, etc.) is unchanged —
`fetchExpense` returns the same field names with decrypted plaintext values.

---

# app/group/[token]/page.tsx — expense fetch patch

The group page's `loadExpenses` function still calls `supabase.from('expenses')` directly.

BEFORE (inside `loadExpenses`):
```ts
const { data: exps } = await supabase
  .from('expenses')
  .select('*, member:paid_by(id)')
  .eq('group_id', groupId)
  .order('created_at', { ascending: false })

const enriched = (exps ?? []).map((e: Expense) => ({
  ...e,
  member: membersRef.current.find(m => m.id === e.paid_by) ?? null,
}))
setExpenses(enriched as Expense[])
```

AFTER:
```ts
import { fetchGroupExpenses } from '@/lib/expenses-api'

// inside loadExpenses:
const expList = await fetchGroupExpenses(groupId)
const enriched = expList.map(e => ({
  ...e,
  member: membersRef.current.find(m => m.id === e.paid_by) ?? null,
}))
setExpenses(enriched as Expense[])
```

---

# app/group/[token]/backfill-expenses — add to scripts/backfill-pii.ts

Add this function to the existing backfill script and call it from `main()`:

```ts
async function backfillExpenses() {
  console.log('[backfill] Fetching expenses with plain-text fields…')

  const { data: expenses, error } = await db
    .from('expenses')
    .select('id, label, amount, expense_date, original_amount, original_currency, exchange_rate')

  if (error) throw error
  console.log(`[backfill] Found ${expenses?.length ?? 0} expenses to migrate`)

  let migrated = 0, skipped = 0

  for (const e of expenses ?? []) {
    const { data: existing } = await db
      .from('expense_secure_data')
      .select('expense_id')
      .eq('expense_id', e.id)
      .maybeSingle()

    if (existing) { skipped++; continue }

    const { error: insErr } = await db
      .from('expense_secure_data')
      .insert({
        expense_id            : e.id,
        label_enc             : e.label             ? encrypt(e.label)                    : null,
        amount_enc            : encrypt(String(e.amount)),
        expense_date_enc      : e.expense_date       ? encrypt(e.expense_date)             : null,
        original_amount_enc   : e.original_amount    ? encrypt(String(e.original_amount))  : null,
        original_currency_enc : e.original_currency  ? encrypt(e.original_currency)        : null,
        exchange_rate_enc     : e.exchange_rate       ? encrypt(String(e.exchange_rate))   : null,
      })

    if (insErr) {
      console.error(`[backfill] Failed for expense ${e.id}:`, insErr.message)
    } else {
      migrated++
    }
  }

  console.log(`[backfill] Expenses: ${migrated} migrated, ${skipped} skipped`)
}
```
