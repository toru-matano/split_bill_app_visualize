/**
 * public/workers/crypto.worker.js
 *
 * Web Worker for CPU-bound cryptographic operations that would otherwise
 * block the main thread and cause jank during scroll/interaction.
 *
 * Current use-cases
 * ──────────────────
 * This app performs all AES-256-GCM decryption server-side (in API routes)
 * which is the right security boundary. However, any client-side hashing
 * needed in the future (e.g. local blind-index lookups, integrity checks,
 * or PBKDF2 key derivation from a user passphrase) belongs here, NOT on
 * the main thread.
 *
 * Message protocol (both directions use the same envelope):
 * ─────────────────────────────────────────────────────────
 *   Request  → { id: string, type: string, payload: unknown }
 *   Response → { id: string, type: string, result?: unknown, error?: string }
 *
 * The `id` field allows the caller to match responses to in-flight promises
 * without relying on message ordering.
 *
 * Supported message types
 * ────────────────────────
 *   'HMAC_SHA256'
 *     payload : { data: string, keyHex: string }
 *     result  : hex string (HMAC-SHA-256 digest)
 *
 *   'DIGEST_SHA256'
 *     payload : { data: string }
 *     result  : hex string (plain SHA-256 digest, no key)
 *
 *   'SORT_EXPENSES'
 *     payload : { expenses: DecryptedExpense[], sortKey: string, dir: 'asc'|'desc' }
 *     result  : sorted expense array
 *     Offloads the O(n log n) sort + any derived field computation
 *     for large expense lists without blocking the UI thread.
 *
 * NOTE — the Web Crypto API is fully available inside Workers (it runs in
 * a WorkerGlobalScope which exposes `self.crypto.subtle`). No polyfills needed.
 */

'use strict'

// ─── Utility: hex encode an ArrayBuffer ──────────────────────────────────────
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── Utility: import a raw HMAC key from a hex string ────────────────────────
async function importHmacKey(keyHex) {
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g).map(h => parseInt(h, 16))
  )
  return self.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,          // not extractable
    ['sign']
  )
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleHmacSha256({ data, keyHex }) {
  const key = await importHmacKey(keyHex)
  const enc = new TextEncoder()
  const sig  = await self.crypto.subtle.sign('HMAC', key, enc.encode(data))
  return bufToHex(sig)
}

async function handleDigestSha256({ data }) {
  const enc = new TextEncoder()
  const buf = await self.crypto.subtle.digest('SHA-256', enc.encode(data))
  return bufToHex(buf)
}

function handleSortExpenses({ expenses, sortKey, dir }) {
  const multiplier = dir === 'desc' ? -1 : 1

  return [...expenses].sort((a, b) => {
    let av = a[sortKey]
    let bv = b[sortKey]

    // Numeric fields
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * multiplier
    }

    // Date strings (ISO or YYYY-MM-DD) — compare lexicographically
    if (sortKey === 'expense_date' || sortKey === 'created_at') {
      av = av ?? ''
      bv = bv ?? ''
      return av < bv ? -1 * multiplier : av > bv ? multiplier : 0
    }

    // String fields
    av = String(av ?? '').toLowerCase()
    bv = String(bv ?? '').toLowerCase()
    return av < bv ? -1 * multiplier : av > bv ? multiplier : 0
  })
}

// ─── Message dispatcher ───────────────────────────────────────────────────────
self.addEventListener('message', async (event) => {
  const { id, type, payload } = event.data ?? {}

  try {
    let result

    switch (type) {
      case 'HMAC_SHA256':
        result = await handleHmacSha256(payload)
        break

      case 'DIGEST_SHA256':
        result = await handleDigestSha256(payload)
        break

      case 'SORT_EXPENSES':
        result = handleSortExpenses(payload)
        break

      default:
        throw new Error(`[crypto.worker] Unknown message type: "${type}"`)
    }

    self.postMessage({ id, type, result })
  } catch (err) {
    self.postMessage({ id, type, error: err?.message ?? String(err) })
  }
})
