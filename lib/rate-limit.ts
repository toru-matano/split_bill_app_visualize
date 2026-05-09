/**
 * In-memory token-bucket rate limiter for API routes.
 * Limits:
 *   - 30 expense/transfer mutations per minute per share token
 *   - 5 group creates per hour per IP
 * Resets automatically; no external dependency needed.
 */

type Bucket = { tokens: number; lastRefill: number }

const buckets = new Map<string, Bucket>()

interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
}

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`)
  }
}

/**
 * Check and consume one token from the bucket identified by `key`.
 * Throws RateLimitError if the bucket is exhausted.
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): void {
  const now = Date.now()
  let bucket = buckets.get(key)

  if (!bucket) {
    bucket = { tokens: opts.limit - 1, lastRefill: now }
    buckets.set(key, bucket)
    return
  }

  // Refill tokens proportionally to elapsed time
  const elapsed = now - bucket.lastRefill
  const refill = Math.floor((elapsed / opts.windowMs) * opts.limit)
  if (refill > 0) {
    bucket.tokens = Math.min(opts.limit, bucket.tokens + refill)
    bucket.lastRefill = now
  }

  if (bucket.tokens <= 0) {
    const retryAfterMs = opts.windowMs - elapsed
    throw new RateLimitError(Math.max(0, retryAfterMs))
  }

  bucket.tokens--
}

// Convenience wrappers for the two rate limit tiers used in this app

/** 30 mutations per minute — keyed by group share token */
export function checkMutationLimit(token: string): void {
  checkRateLimit(`mutation:${token}`, { limit: 30, windowMs: 60_000 })
}

/** 5 group creates per hour — keyed by IP address */
export function checkGroupCreateLimit(ip: string): void {
  checkRateLimit(`group_create:${ip}`, { limit: 5, windowMs: 60 * 60_000 })
}

// Periodically purge stale buckets to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60_000 // 2 hours
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.lastRefill < cutoff) buckets.delete(key)
  }
}, 10 * 60_000)
