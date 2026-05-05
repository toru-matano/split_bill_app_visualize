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
