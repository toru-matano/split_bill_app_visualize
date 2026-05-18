/**
 * lib/worker-bridge.ts
 *
 * Typed promise-based bridge to public/workers/crypto.worker.js.
 *
 * Why a bridge?
 * ─────────────
 * The raw Worker postMessage API is fire-and-forget with no built-in
 * request/response pairing. This module wraps it in typed promises so
 * callers can await worker operations just like normal async functions,
 * without caring about message IDs or event listeners.
 *
 * Singleton pattern
 * ─────────────────
 * One Worker instance is shared across the entire page lifetime. Workers
 * are ~2 MB each in V8; spinning one per call would waste memory and
 * create warmup latency on every use.
 *
 * SSR safety
 * ──────────
 * Worker construction is gated behind `typeof window !== 'undefined'`
 * because Next.js runs this code on the server during SSR, where the
 * Worker API does not exist. All exported functions return fast no-ops
 * when running on the server.
 *
 * Termination
 * ───────────
 * The worker lives for the page lifetime. If you need to release it
 * early (e.g. on SPA route teardown) call `terminateCryptoWorker()`.
 */

import { nanoid } from 'nanoid'
import type { DecryptedExpense } from '@/lib/expenses-api'

// ─── Worker singleton ─────────────────────────────────────────────────────────

let _worker: Worker | null = null

function getWorker(): Worker | null {
  if (typeof window === 'undefined') return null  // SSR guard

  if (!_worker) {
    try {
      _worker = new Worker('/workers/crypto.worker.js')
    } catch (err) {
      console.warn('[worker-bridge] Could not create Worker:', err)
      return null
    }
  }
  return _worker
}

/** Release the worker (call on unmount if needed). */
export function terminateCryptoWorker(): void {
  _worker?.terminate()
  _worker = null
}

// ─── Core RPC helper ──────────────────────────────────────────────────────────

type WorkerResponse<T> = { id: string; type: string; result?: T; error?: string }

function rpc<TPayload, TResult>(type: string, payload: TPayload): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const worker = getWorker()
    if (!worker) {
      // Worker unavailable (SSR / CSP block) — reject so caller can fall back
      reject(new Error('[worker-bridge] Worker not available'))
      return
    }

    const id = nanoid(8)

    const handler = (event: MessageEvent<WorkerResponse<TResult>>) => {
      if (event.data?.id !== id) return
      worker.removeEventListener('message', handler)
      if (event.data.error) {
        reject(new Error(event.data.error))
      } else {
        resolve(event.data.result as TResult)
      }
    }

    worker.addEventListener('message', handler)
    worker.postMessage({ id, type, payload })
  })
}

// ─── Typed public API ─────────────────────────────────────────────────────────

/**
 * HMAC-SHA-256 keyed digest computed off the main thread.
 * Useful for local blind-index lookups without a server round-trip.
 *
 * @param data   - plaintext string to digest
 * @param keyHex - 32-byte HMAC key as a lowercase hex string
 * @returns hex-encoded HMAC digest
 */
export async function hmacSha256Worker(data: string, keyHex: string): Promise<string> {
  return rpc<{ data: string; keyHex: string }, string>('HMAC_SHA256', { data, keyHex })
}

/**
 * Plain SHA-256 digest (no key) computed off the main thread.
 * Useful for content-addressable caching or integrity checks.
 *
 * @param data - string to hash
 * @returns hex-encoded SHA-256 digest
 */
export async function digestSha256Worker(data: string): Promise<string> {
  return rpc<{ data: string }, string>('DIGEST_SHA256', { data })
}

/**
 * Sort a potentially large expense list off the main thread.
 *
 * For small lists (< 50 items) the overhead of the postMessage round-trip
 * exceeds the sort cost — use Array.prototype.sort directly. This function
 * is intended for groups with hundreds of expenses where main-thread sorting
 * would cause noticeable input latency.
 *
 * @param expenses - array of decrypted expense objects
 * @param sortKey  - property name to sort by
 * @param dir      - 'asc' or 'desc'
 * @returns sorted copy of the array
 */
export async function sortExpensesWorker(
  expenses: DecryptedExpense[],
  sortKey: keyof DecryptedExpense,
  dir: 'asc' | 'desc' = 'desc',
): Promise<DecryptedExpense[]> {
  return rpc<
    { expenses: DecryptedExpense[]; sortKey: string; dir: 'asc' | 'desc' },
    DecryptedExpense[]
  >('SORT_EXPENSES', { expenses, sortKey: sortKey as string, dir })
}
