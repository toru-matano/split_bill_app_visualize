-- Run these SQL statements in your Supabase SQL editor
-- to enable the new features

-- 1. Add expense_date to expenses table
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_date DATE;

-- 2. Add notifications_enabled to groups table
ALTER TABLE groups ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT FALSE;

-- 3. Create transfer_records table for real money transfers
CREATE TABLE IF NOT EXISTS transfer_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member_id UUID NOT NULL REFERENCES members(id),
  to_member_id UUID NOT NULL REFERENCES members(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  note TEXT,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (match your existing groups/members policies)
ALTER TABLE transfer_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on transfer_records" ON transfer_records FOR ALL USING (true);
