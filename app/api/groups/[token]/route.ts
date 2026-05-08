import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

const db = supabaseServer

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const body = await req.json()
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : ''
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

    const VALID_CURRENCIES = ['JPY','USD','EUR','GBP','AUD','CAD','CHF','CNY','KRW','SGD','THB','HKD']
    const currency = typeof body.currency === 'string' && VALID_CURRENCIES.includes(body.currency)
      ? body.currency : undefined
    const notifications_enabled = typeof body.notifications_enabled === 'boolean'
      ? body.notifications_enabled : undefined

    const { error } = await db.from('groups')
      .update({ name, ...(currency ? { currency } : {}), ...(notifications_enabled !== undefined ? { notifications_enabled } : {}) })
      .eq('share_token', token)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/groups]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { data: grp } = await db.from('groups').select('id').eq('share_token', token).single()
    if (!grp) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const { data: expenses } = await db.from('expenses').select('id').eq('group_id', grp.id)
    const expenseIds = (expenses ?? []).map(e => e.id)

    if (expenseIds.length > 0) {
      // Parallel cascade delete
      await Promise.all([
        db.from('expense_payers').delete().in('expense_id', expenseIds),
        db.from('expense_splits').delete().in('expense_id', expenseIds),
      ])
      await db.from('expenses').delete().eq('group_id', grp.id)
    }

    await Promise.all([
      db.from('members').delete().eq('group_id', grp.id),
      db.from('transfer_records').delete().eq('group_id', grp.id).throwOnError(),
    ]).catch(() => {}) // transfer_records may not exist yet

    await db.from('members').delete().eq('group_id', grp.id)
    await db.from('groups').delete().eq('id', grp.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/groups]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
