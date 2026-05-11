// lib/push-client.ts
//
// Thin client-side wrapper around POST /api/push/send.
// Passes the current locale so the server translates the message correctly.
// All calls are fire-and-forget (errors are silently ignored).

import type { PushEvent } from './push-messages'

export function sendPush(
  groupId: string,
  event: PushEvent,
  url: string,
  locale: string,
): void {
  fetch('/api/push/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ groupId, event, url, locale }),
  }).catch(() => {})
}
