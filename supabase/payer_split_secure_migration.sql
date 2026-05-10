-- =============================================================================
-- Migration: Encrypt expense_payers and expense_splits amounts
-- =============================================================================
-- Run in Supabase SQL Editor BEFORE deploying the new application code.
-- =============================================================================

-- ── 1. Secure table for expense_payers ───────────────────────────────────────
-- Keeps member_id (relational FK, not PII) but encrypts the financial amount.

CREATE TABLE IF NOT EXISTS expense_payer_secure_data (
  -- Composite PK mirrors the logical key of expense_payers
  expense_id  UUID  NOT NULL REFERENCES expenses(id)  ON DELETE CASCADE,
  member_id   UUID  NOT NULL REFERENCES members(id)   ON DELETE CASCADE,

  -- AES-256-GCM encrypted string representation of the numeric amount
  amount_enc  BYTEA NOT NULL,

  PRIMARY KEY (expense_id, member_id)
);

ALTER TABLE expense_payer_secure_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_payer_secure
  ON expense_payer_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_payer_secure
  ON expense_payer_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 2. Secure table for expense_splits ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_split_secure_data (
  expense_id  UUID  NOT NULL REFERENCES expenses(id)  ON DELETE CASCADE,
  member_id   UUID  NOT NULL REFERENCES members(id)   ON DELETE CASCADE,

  amount_enc  BYTEA NOT NULL,

  PRIMARY KEY (expense_id, member_id)
);

ALTER TABLE expense_split_secure_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_split_secure
  ON expense_split_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_split_secure
  ON expense_split_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 3. Make amount nullable on source tables (bridge during migration) ────────
-- Allows new inserts to skip the plain-text column while existing rows remain.

ALTER TABLE expense_payers ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE expense_splits ALTER COLUMN amount DROP NOT NULL;

-- ── 4. DROP plain-text amount columns (run AFTER backfill + verification) ────
-- Uncomment only after running scripts/backfill-pii.ts and confirming that
-- expense_payer_secure_data and expense_split_secure_data row counts match.

-- ALTER TABLE expense_payers DROP COLUMN IF EXISTS amount;
-- ALTER TABLE expense_splits DROP COLUMN IF EXISTS amount;
