// lib/push-messages.ts
//
// Server-side translation for push notification title + body.
// Cannot use the i18n React hook (client-only). Instead we import the
// message JSON files directly and resolve the key at request time.
//
// The client passes its current `locale` in the push payload body.
// Falls back to 'en' for any unknown locale or missing key.

import en from '@/messages/en.json'
import ja from '@/messages/ja.json'
import zh from '@/messages/zh.json'
import ko from '@/messages/ko.json'
import fr from '@/messages/fr.json'
import es from '@/messages/es.json'

type Messages = Record<string, Record<string, string>>

const MESSAGES: Record<string, Messages> = { en, ja, zh, ko, fr, es }

/**
 * Resolve a dotted key like "push.expenseAdded" for a given locale,
 * substituting {var} placeholders with the provided vars object.
 */
export function pt(
  locale: string,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const msgs   = MESSAGES[locale] ?? MESSAGES.en
  const [ns, ...rest] = key.split('.')
  let val = (msgs as Messages)[ns]?.[rest.join('.')] ?? (MESSAGES.en as Messages)[ns]?.[rest.join('.')] ?? key
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      val = val.replace(`{${k}}`, String(v))
    })
  }
  return val
}

export type PushEvent =
  | { type: 'expenseAdded';   label: string; payerName: string; amount: string }
  | { type: 'expenseEdited';  label: string; amount: string }
  | { type: 'expenseDeleted'; label: string }
  | { type: 'memberAdded';    memberName: string }
  | { type: 'transferAdded';  fromName: string; toName: string; amount: string }

/**
 * Build the { title, body } for a push notification given an event and locale.
 */
export function buildPushMessage(
  event: PushEvent,
  locale: string,
): { title: string; body: string } {
  const l = MESSAGES[locale] ? locale : 'en'

  switch (event.type) {
    case 'expenseAdded':
      return {
        title: pt(l, 'push.expenseAdded'),
        body:  pt(l, 'push.expenseAddedBody', { name: event.payerName, label: event.label, amount: event.amount }),
      }
    case 'expenseEdited':
      return {
        title: pt(l, 'push.expenseEdited'),
        body:  pt(l, 'push.expenseEditedBody', { label: event.label, amount: event.amount }),
      }
    case 'expenseDeleted':
      return {
        title: pt(l, 'push.expenseDeleted'),
        body:  pt(l, 'push.expenseDeletedBody', { label: event.label }),
      }
    case 'memberAdded':
      return {
        title: pt(l, 'push.memberAdded'),
        body:  pt(l, 'push.memberAddedBody', { name: event.memberName }),
      }
    case 'transferAdded':
      return {
        title: pt(l, 'push.transferAdded'),
        body:  pt(l, 'push.transferAddedBody', { from: event.fromName, to: event.toName, amount: event.amount }),
      }
  }
}
