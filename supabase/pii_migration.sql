-- =============================================================================
-- PII Security Migration Script
-- Target: Supabase (PostgreSQL)
-- Purpose: Segregate PII into encrypted secure tables, add blind indexes
-- Run this in the Supabase SQL Editor (or via psql) against your project.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 — Enable pgcrypto for UUID generation (already on in Supabase, but
--          included for completeness).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================================
-- STEP 1 — MEMBERS TABLE REFACTOR
-- =============================================================================
-- The `members` table currently stores member names in plain text.
-- We move the name to a secure table and replace it with an encrypted blob
-- plus a deterministic hash for duplicate-name checks.
--
-- Before:
--   members(id, group_id, name TEXT, created_at)
--
-- After:
--   members(id, group_id, created_at)          ← no PII
--   member_secure_data(member_id, name_enc BYTEA, name_hash TEXT)

CREATE TABLE IF NOT EXISTS member_secure_data (
  member_id   UUID        PRIMARY KEY
                          REFERENCES members(id) ON DELETE CASCADE,

  -- AES-256-GCM ciphertext produced by the application layer.
  -- Format: <12-byte nonce> || <ciphertext> || <16-byte GCM tag>
  -- Stored as raw bytes so no base64 overhead at query time.
  name_enc    BYTEA       NOT NULL,

  -- HMAC-SHA-256 of the lowercased name, keyed with BLIND_INDEX_SECRET.
  -- Used for exact-match duplicate detection without decrypting.
  name_hash   TEXT        NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookups on the blind index
CREATE INDEX IF NOT EXISTS idx_member_secure_data_name_hash
  ON member_secure_data (name_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — GROUPS TABLE: no PII columns exist, but we add an audit column
-- so we can track when the record was last touched by the migration.
-- ─────────────────────────────────────────────────────────────────────────────
-- (No structural changes needed for groups — group names are operational data,
--  not PII in the strict sense for this app.  If your policy classifies group
--  names as PII, extend this pattern to a group_secure_data table similarly.)


-- =============================================================================
-- STEP 3 — PUSH SUBSCRIPTIONS SECURE TABLE
-- =============================================================================
-- push_subscriptions currently stores the push endpoint URL, p256dh key, and
-- auth secret in plain text.  The endpoint URL is linkable to a browser
-- instance (PII-adjacent).  We encrypt sensitive columns.
--
-- Before:
--   push_subscriptions(id, group_id, endpoint TEXT, p256dh TEXT, auth TEXT)
--
-- After:
--   push_subscriptions keeps a non-sensitive surrogate key + group_id.
--   push_subscription_secure_data holds encrypted blobs + endpoint_hash for
--   upsert/deduplication.
-- Create push_subscriptions base table if it doesn't already exist
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_group_id
  ON push_subscriptions (group_id);

CREATE TABLE IF NOT EXISTS push_subscription_secure_data (
  -- Surrogate PK — references the existing push_subscriptions row.
  subscription_id  UUID  PRIMARY KEY
                         REFERENCES push_subscriptions(id) ON DELETE CASCADE,

  -- Encrypted endpoint URL (HTTPS string → AES-256-GCM ciphertext)
  endpoint_enc     BYTEA NOT NULL,

  -- Blind index for upsert/deduplication (replaces the UNIQUE on endpoint)
  endpoint_hash    TEXT  NOT NULL UNIQUE,

  -- Encrypted WebPush key material
  p256dh_enc       BYTEA,
  auth_enc         BYTEA,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_sub_secure_endpoint_hash
  ON push_subscription_secure_data (endpoint_hash);


-- =============================================================================
-- STEP 4 — DROP PLAIN-TEXT PII COLUMNS FROM EXISTING TABLES
-- =============================================================================
-- Run AFTER the application has been deployed and all existing rows have been
-- back-filled into the secure tables (see the back-fill script below).

-- 4a. Remove plain-text name from members
ALTER TABLE members
  DROP COLUMN IF EXISTS name;

-- 4b. Remove plain-text push columns from push_subscriptions
ALTER TABLE push_subscriptions
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS p256dh,
  DROP COLUMN IF EXISTS auth;

-- 4c. Drop the old UNIQUE constraint on endpoint if it existed
--     (Supabase may name it differently; check with \d push_subscriptions)
-- ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;


-- =============================================================================
-- STEP 5 — ROW-LEVEL SECURITY (RLS) ON SECURE TABLES
-- =============================================================================
-- Only the service-role key (used exclusively server-side) may read these
-- tables.  The anon/authenticated roles used by the browser client must never
-- see ciphertext rows.

ALTER TABLE member_secure_data             ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscription_secure_data  ENABLE ROW LEVEL SECURITY;

-- Deny everything to the anon role
CREATE POLICY deny_anon_member_secure
  ON member_secure_data
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY deny_anon_push_secure
  ON push_subscription_secure_data
  FOR ALL
  TO anon
  USING (false);

-- Allow only service_role (your Next.js server) full access
CREATE POLICY service_role_member_secure
  ON member_secure_data
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY service_role_push_secure
  ON push_subscription_secure_data
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- STEP 6 — BACK-FILL HELPER (run once, then drop)
-- =============================================================================
-- Because actual encryption must happen in the application layer (Node.js),
-- this SQL cannot encrypt the existing rows itself.
-- Use the companion Node.js back-fill script (`scripts/backfill-pii.ts`) to:
--   1. SELECT all members with their current plain-text names.
--   2. Encrypt each name and compute its blind index in Node.
--   3. INSERT into member_secure_data.
--   4. Repeat for push_subscriptions → push_subscription_secure_data.
-- Only after verification should you run STEP 4 (DROP COLUMN).


-- =============================================================================
-- SUMMARY OF SCHEMA CHANGES
-- =============================================================================
--
--  TABLE                          CHANGE
--  ─────────────────────────────  ───────────────────────────────────────────
--  members                        DROP COLUMN name  (moved to secure table)
--  member_secure_data             NEW — name_enc BYTEA, name_hash TEXT
--  push_subscriptions             DROP COLUMNS endpoint, p256dh, auth
--  push_subscription_secure_data  NEW — endpoint_enc/hash, p256dh_enc, auth_enc
--
-- =============================================================================
