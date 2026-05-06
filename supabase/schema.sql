-- Step 1: Database schema for Walica clone
-- Run this in your Supabase SQL editor

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'JPY',
  share_token text unique not null,
  created_at timestamptz default now()
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  paid_by uuid references members(id),
  amount numeric not null,
  label text,
  created_at timestamptz default now()
);

create table if not exists expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid references expenses(id) on delete cascade,
  member_id uuid references members(id),
  amount numeric not null
);

-- Enable Row Level Security (open for now, lock down later)
alter table groups enable row level security;
alter table members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;

-- Allow all operations for now (refine with auth later)
create policy "allow all" on groups for all using (true) with check (true);
create policy "allow all" on members for all using (true) with check (true);
create policy "allow all" on expenses for all using (true) with check (true);
create policy "allow all" on expense_splits for all using (true) with check (true);

-- Phase 3: Multi-currency + categories
-- Run these ALTER statements in Supabase SQL editor

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS original_currency text,
  ADD COLUMN IF NOT EXISTS original_amount numeric,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric;

-- original_currency: the currency the expense was entered in (e.g. 'USD')
-- original_amount:   the raw amount in that currency (e.g. 12.50)
-- exchange_rate:     rate used to convert to group base currency at time of entry
-- amount:            always the base-currency value used for settlement (unchanged)

-- Feature: Multiple payers per expense
-- A new table stores how much each person contributed to paying an expense.
-- When there's only one payer, a single row is inserted (existing behaviour).
CREATE TABLE IF NOT EXISTS expense_payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid REFERENCES expenses(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id),
  amount numeric NOT NULL
);
ALTER TABLE expense_payers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON expense_payers FOR ALL USING (true) WITH CHECK (true);

-- The paid_by column on expenses now holds the "primary" payer for display only.
-- Settlement always uses expense_payers for the actual amounts.

-- Multiple payers support
-- Each expense can now have multiple payers (expense_payers table)
-- expense.paid_by is kept for backwards compat display, expense_payers holds the truth

CREATE TABLE IF NOT EXISTS expense_payers (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid references expenses(id) on delete cascade,
  member_id uuid references members(id),
  amount numeric not null
);

ALTER TABLE expense_payers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON expense_payers FOR ALL USING (true) WITH CHECK (true);

-- Group settings: allow renaming and currency change
-- (no schema change needed — groups table already has name + currency)
