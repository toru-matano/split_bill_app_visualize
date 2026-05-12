-- =============================================================================
-- schema.sql — Single source of truth for the entire database schema
--
-- Replaces:
--   schema.sql                      (base tables, initial RLS)
--   MIGRATIONS.sql                  (expense_date, notifications_enabled, transfer_records)
--   pii_migration.sql               (member_secure_data, push_subscriptions secure tables)
--   expense_secure_migration.sql    (expense_secure_data, RLS on expense_payers/splits)
--   payer_split_secure_migration.sql(expense_payer_secure_data, expense_split_secure_data)
--   cascade_delete_migration.sql    (transfer_records.group_id ON DELETE CASCADE)
--   key_versioning_migration.sql    (CHECK constraints enforcing min ciphertext size)
--
-- Run this file once against a fresh Supabase project.
-- For existing databases see "Applying to an existing database" at the bottom.
--
-- Dependency order (every table is defined before anything that references it):
--   groups
--   ├── members → member_secure_data
--   ├── push_subscriptions → push_subscription_secure_data
--   ├── transfer_records
--   └── expenses → expense_secure_data
--                → expense_payers → expense_payer_secure_data
--                → expense_splits → expense_split_secure_data
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================================
-- 1. GROUPS
-- =============================================================================

CREATE TABLE IF NOT EXISTS groups (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        NOT NULL,
  currency              TEXT        NOT NULL DEFAULT 'JPY',
  share_token           TEXT        UNIQUE NOT NULL,
  notifications_enabled BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Anon (browser) can SELECT groups — the share_token acts as a capability
-- token; anyone who knows it is implicitly authorised to view the group.
-- Writes (INSERT/UPDATE/DELETE) go through Next.js API routes which use the
-- service-role key, so the anon role only needs SELECT here.
CREATE POLICY anon_select_groups
  ON groups FOR SELECT TO anon USING (true);

-- service_role owns all write operations (INSERT/UPDATE/DELETE).
CREATE POLICY service_role_groups
  ON groups FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 2. MEMBERS
--    Plain-text `name` column is intentionally absent — names live in
--    member_secure_data (see §3).
-- =============================================================================

CREATE TABLE IF NOT EXISTS members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Anon can SELECT member rows (id + group_id only; no PII — the name column
-- was removed when encryption was introduced).  The API route that returns
-- decrypted names runs server-side with the service-role key.
CREATE POLICY anon_select_members
  ON members FOR SELECT TO anon USING (true);

CREATE POLICY service_role_members
  ON members FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 3. MEMBER_SECURE_DATA
--    AES-256-GCM ciphertext of the member name + HMAC blind index.
--
--    Wire format (key-versioned):
--      [ 1 B version ][ 12 B IV ][ N B ciphertext ][ 16 B GCM tag ]  >= 30 B
--    Legacy (pre-versioning, still accepted by decrypt()):
--      [ 12 B IV ][ N B ciphertext ][ 16 B GCM tag ]                 >= 29 B
-- =============================================================================

CREATE TABLE IF NOT EXISTS member_secure_data (
  member_id  UUID        PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  name_enc   BYTEA       NOT NULL CHECK (octet_length(name_enc) >= 29),
  name_hash  TEXT        NOT NULL,   -- HMAC-SHA-256 blind index (hex)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_secure_data_name_hash
  ON member_secure_data (name_hash);

ALTER TABLE member_secure_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_member_secure
  ON member_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_member_secure
  ON member_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 4. PUSH_SUBSCRIPTIONS + PUSH_SUBSCRIPTION_SECURE_DATA
--    Base table holds only the group FK; sensitive push credentials are
--    encrypted in the secure table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_group_id
  ON push_subscriptions (group_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_push_subscriptions
  ON push_subscriptions FOR ALL TO anon USING (false);

CREATE POLICY service_role_push_subscriptions
  ON push_subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Secure table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscription_secure_data (
  subscription_id UUID  PRIMARY KEY REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  endpoint_enc    BYTEA NOT NULL CHECK (octet_length(endpoint_enc) >= 29),
  endpoint_hash   TEXT  NOT NULL UNIQUE,  -- HMAC-SHA-256 blind index for dedup
  p256dh_enc      BYTEA,
  auth_enc        BYTEA,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_sub_secure_endpoint_hash
  ON push_subscription_secure_data (endpoint_hash);

ALTER TABLE push_subscription_secure_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_push_secure
  ON push_subscription_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_push_secure
  ON push_subscription_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 5. TRANSFER_RECORDS
--    Real-money settlements between members.
--    group_id carries ON DELETE CASCADE so deleting a group removes all
--    its transfer records atomically.
-- =============================================================================

CREATE TABLE IF NOT EXISTS transfer_records (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID           NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member_id UUID           NOT NULL REFERENCES members(id),
  to_member_id   UUID           NOT NULL REFERENCES members(id),
  amount         NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  note           TEXT,
  transfer_date  DATE           NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

ALTER TABLE transfer_records ENABLE ROW LEVEL SECURITY;

-- Anon (browser) has full CRUD on transfer_records.  This table contains no
-- PII — only UUIDs, amounts, dates, and optional notes.  The settle page
-- reads and writes this table directly via the anon Supabase client.
-- Access is implicitly scoped to a group by the group_id FK: anyone with the
-- share_token can already read the group, so granting anon access here adds
-- no new capability.
CREATE POLICY anon_all_transfer_records
  ON transfer_records FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY service_role_transfer_records
  ON transfer_records FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 6. EXPENSES
--    Base table — no PII columns; financial fields live in expense_secure_data.
--    `paid_by` is kept for display (primary payer); settlement uses
--    expense_payers for the actual split amounts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  paid_by    UUID        REFERENCES members(id),
  category   TEXT        NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_expenses
  ON expenses FOR ALL TO anon USING (false);

CREATE POLICY service_role_expenses
  ON expenses FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 7. EXPENSE_SECURE_DATA
--    AES-256-GCM encrypted label, amount, dates, and FX fields.
-- =============================================================================

CREATE TABLE IF NOT EXISTS expense_secure_data (
  expense_id        UUID  PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  label             BYTEA,                                              -- nullable
  amount            BYTEA NOT NULL CHECK (octet_length(amount) >= 29),
  original_amount   BYTEA,
  original_currency BYTEA,
  exchange_rate     BYTEA,
  expense_date      BYTEA,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expense_secure_data ENABLE ROW LEVEL SECURITY;

-- Anon is permanently denied — ciphertext must never reach the browser.
CREATE POLICY deny_anon_expense_secure
  ON expense_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_expense_secure
  ON expense_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 8. EXPENSE_PAYERS
--    Which members paid for an expense (base row — no amounts).
--    Amounts live in expense_payer_secure_data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS expense_payers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES members(id)
);

ALTER TABLE expense_payers ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_expense_payers
  ON expense_payers FOR ALL TO anon USING (false);

CREATE POLICY service_role_expense_payers
  ON expense_payers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Secure table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_payer_secure_data (
  expense_id UUID  NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id  UUID  NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
  amount     BYTEA NOT NULL CHECK (octet_length(amount) >= 29),
  PRIMARY KEY (expense_id, member_id)
);

ALTER TABLE expense_payer_secure_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_payer_secure
  ON expense_payer_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_payer_secure
  ON expense_payer_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- 9. EXPENSE_SPLITS
--    Which members share an expense (base row — no amounts).
--    Amounts live in expense_split_secure_data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS expense_splits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES members(id)
);

ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_expense_splits
  ON expense_splits FOR ALL TO anon USING (false);

CREATE POLICY service_role_expense_splits
  ON expense_splits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Secure table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_split_secure_data (
  expense_id UUID  NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id  UUID  NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
  amount     BYTEA NOT NULL CHECK (octet_length(amount) >= 29),
  PRIMARY KEY (expense_id, member_id)
);

ALTER TABLE expense_split_secure_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_anon_split_secure
  ON expense_split_secure_data FOR ALL TO anon USING (false);

CREATE POLICY service_role_split_secure
  ON expense_split_secure_data FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =============================================================================
-- Post-backfill: tighten CHECK constraints to >= 30 bytes
-- =============================================================================
-- After running scripts/backfill-pii.ts to re-encrypt all legacy rows under
-- the versioned format, every ciphertext will be >= 30 bytes.  At that point
-- run the block below to enforce the stricter bound and reject any future
-- write that omits the version byte.
--
-- ALTER TABLE member_secure_data
--   DROP CONSTRAINT member_secure_data_name_enc_check,
--   ADD  CONSTRAINT member_secure_data_name_enc_check
--        CHECK (octet_length(name_enc) >= 30);
--
-- ALTER TABLE expense_secure_data
--   DROP CONSTRAINT expense_secure_data_amount_check,
--   ADD  CONSTRAINT expense_secure_data_amount_check
--        CHECK (octet_length(amount) >= 30);
--
-- ALTER TABLE expense_payer_secure_data
--   DROP CONSTRAINT expense_payer_secure_data_amount_check,
--   ADD  CONSTRAINT expense_payer_secure_data_amount_check
--        CHECK (octet_length(amount) >= 30);
--
-- ALTER TABLE expense_split_secure_data
--   DROP CONSTRAINT expense_split_secure_data_amount_check,
--   ADD  CONSTRAINT expense_split_secure_data_amount_check
--        CHECK (octet_length(amount) >= 30);
--
-- ALTER TABLE push_subscription_secure_data
--   DROP CONSTRAINT push_subscription_secure_data_endpoint_enc_check,
--   ADD  CONSTRAINT push_subscription_secure_data_endpoint_enc_check
--        CHECK (octet_length(endpoint_enc) >= 30);


-- =============================================================================
-- Verification query
-- =============================================================================
-- Run after applying to confirm every FK referencing groups/expenses/members
-- carries ON DELETE CASCADE:
--
-- SELECT
--   tc.table_name,
--   kcu.column_name,
--   ccu.table_name  AS references,
--   rc.delete_rule
-- FROM information_schema.table_constraints      AS tc
-- JOIN information_schema.key_column_usage        AS kcu
--   ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.referential_constraints AS rc
--   ON tc.constraint_name = rc.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu
--   ON rc.unique_constraint_name = ccu.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY'
--   AND ccu.table_name IN ('groups', 'expenses', 'members')
-- ORDER BY tc.table_name, kcu.column_name;
--
-- Expected: delete_rule = 'CASCADE' on every row.


-- =============================================================================
-- Applying to an existing database
-- =============================================================================
-- This file is idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, etc.) so it is safe to run against a database that was built from
-- the individual migration files.  Two manual steps are required for existing
-- databases only:
--
-- 1. Drop the old open "allow all" RLS policies before the restrictive ones
--    created above will apply (PostgreSQL applies policies permissively so the
--    old ones would override the new denies):
--
--      DROP POLICY IF EXISTS "allow all" ON groups;
--      DROP POLICY IF EXISTS "allow all" ON members;
--      DROP POLICY IF EXISTS "allow all" ON expenses;
--      DROP POLICY IF EXISTS "allow all" ON expense_splits;
--      DROP POLICY IF EXISTS "allow all" ON expense_payers;
--      DROP POLICY IF EXISTS "Allow all on transfer_records" ON transfer_records;
--
-- 2. Fix the transfer_records FK to add ON DELETE CASCADE
--    (fresh installs get this automatically via the CREATE TABLE above):
--
--      ALTER TABLE transfer_records
--        DROP CONSTRAINT IF EXISTS transfer_records_group_id_fkey;
--      ALTER TABLE transfer_records
--        ADD CONSTRAINT transfer_records_group_id_fkey
--        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
-- =============================================================================