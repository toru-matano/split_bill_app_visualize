-- =============================================================================
-- Expense PII Migration
-- Adds expense_secure_data table to hold encrypted label, amount, date, etc.
-- Run BEFORE deploying the new application code.
-- =============================================================================

-- ── 1. Create secure table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_secure_data (
  expense_id          UUID        PRIMARY KEY
                                  REFERENCES expenses(id) ON DELETE CASCADE,

  -- Encrypted expense label (e.g. "Dinner at Nobu")
  label           BYTEA,

  -- Encrypted amounts stored as text representation of the numeric value
  amount          BYTEA       NOT NULL,
  original_amount BYTEA,
  exchange_rate   BYTEA,

  -- Encrypted date string (YYYY-MM-DD)
  expense_date    BYTEA,

  -- Encrypted original currency code (e.g. "USD")
  original_currency BYTEA,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. RLS — only service_role may access this table ─────────────────────────
ALTER TABLE expense_secure_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_expense_secure
  ON expense_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_expense_secure
  ON expense_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 3. Drop plain-text PII columns from expenses ──────────────────────────────
-- Run ONLY after back-filling expense_secure_data via scripts/backfill-pii.ts
-- and verifying row counts match.

-- ALTER TABLE expenses DROP COLUMN IF EXISTS label;
-- ALTER TABLE expenses DROP COLUMN IF EXISTS amount;
-- ALTER TABLE expenses DROP COLUMN IF EXISTS original_amount;
-- ALTER TABLE expenses DROP COLUMN IF EXISTS original_currency;
-- ALTER TABLE expenses DROP COLUMN IF EXISTS exchange_rate;
-- ALTER TABLE expenses DROP COLUMN IF EXISTS expense_date;

-- ── 4. expense_payers and expense_splits ──────────────────────────────────────
-- The `amount` column on these tables is a derived split value used for
-- balance calculations. Encrypting it would make all balance/settle math
-- impossible without decrypting every row first, removing the ability to
-- do server-side aggregation. Treat these as operational financial data
-- (like a ledger amount) rather than PII, and protect them via RLS only.

ALTER TABLE expense_payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_expense_payers
  ON expense_payers FOR ALL TO anon USING (false);
CREATE POLICY service_role_expense_payers
  ON expense_payers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY deny_anon_expense_splits
  ON expense_splits FOR ALL TO anon USING (false);
CREATE POLICY service_role_expense_splits
  ON expense_splits FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE expenses
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS amount,
  DROP COLUMN IF EXISTS original_amount,
  DROP COLUMN IF EXISTS original_currency,
  DROP COLUMN IF EXISTS exchange_rate,
  DROP COLUMN IF EXISTS expense_date;