import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Group = {
  id: string
  name: string
  currency: string
  share_token: string
  created_at: string
}

export type Member = {
  id: string
  group_id: string
  name: string
  created_at: string
}

export type Expense = {
  id: string
  group_id: string
  paid_by: string
  amount: number           // always in group base currency
  label: string | null
  category: string
  original_currency: string | null
  original_amount: number | null
  exchange_rate: number | null
  created_at: string
  member?: Member
}

export type ExpenseSplit = {
  id: string
  expense_id: string
  member_id: string
  amount: number
}

export type Transfer = {
  from: string
  to: string
  fromName: string
  toName: string
  amount: number
}
