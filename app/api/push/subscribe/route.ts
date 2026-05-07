import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// POST — save a push subscription for a group
export async function POST(req: NextRequest) {
  const { groupId, subscription } = await req.json()
  if (!groupId || !subscription?.endpoint) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Upsert subscription keyed by endpoint so re-subscribing is idempotent
  await supabase.from('push_subscriptions').upsert({
    group_id: groupId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys?.p256dh ?? null,
    auth: subscription.keys?.auth ?? null,
  }, { onConflict: 'endpoint' })

  return NextResponse.json({ ok: true })
}

// DELETE — remove a push subscription
export async function DELETE(req: NextRequest) {
  const { endpoint } = await req.json()
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  return NextResponse.json({ ok: true })
}
