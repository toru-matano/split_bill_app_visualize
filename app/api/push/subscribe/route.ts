import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { ValidationError, validatePushEndpoint } from '@/lib/validation'

const db = supabaseServer

export async function POST(req: NextRequest) {
  try {
    const { groupId, subscription } = await req.json()
    if (!groupId || typeof groupId !== 'string') return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })

    const endpoint = validatePushEndpoint(subscription?.endpoint)
    const p256dh = typeof subscription?.keys?.p256dh === 'string' ? subscription.keys.p256dh : null
    const auth   = typeof subscription?.keys?.auth   === 'string' ? subscription.keys.auth   : null

    await db.from('push_subscriptions').upsert(
      { group_id: groupId, endpoint, p256dh, auth },
      { onConflict: 'endpoint' }
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[POST /api/push/subscribe]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { endpoint } = await req.json()
    const validated = validatePushEndpoint(endpoint)
    await db.from('push_subscriptions').delete().eq('endpoint', validated)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
