/**
 * lib/rate-limit.ts
 *
 * Edge-compatible rate limiter backed by Upstash Redis (improvement #3).
 *
 * Replaces the previous in-memory Map implementation which was broken in
 * serverless/edge deployments: each cold-start got a fresh Map, so limits
 * were per-instance rather than per-user across the fleet.
 *
 * This module preserves the exact same public API surface:
 *   checkMutationLimit(token)      — 30 mutations / 60 s, keyed by share token
 *   checkGroupCreateLimit(ip)      — 5 group creates / hour, keyed by IP
 *   RateLimitError                 — thrown when the bucket is exhausted
 *
 * Algorithm: sliding-window counter (@upstash/ratelimit built-in).
 * A sliding window is preferred over fixed-window because it eliminates the
 * burst-at-boundary problem: a user cannot make 2× the allowed requests by
 * straddling a window reset.
 *
 * Required environment variables
 * ───────────────────────────────
 *   UPSTASH_REDIS_REST_URL    — from Upstash console → REST API → Endpoint
 *   UPSTASH_REDIS_REST_TOKEN  — from Upstash console → REST API → Token
 *
 * Both are available in the free Upstash tier.  The @upstash/redis client
 * uses the REST API, so it works in the Next.js Edge Runtime as well as
 * Node.js serverless functions.
 *
 * Local development without Redis
 * ────────────────────────────────
 * Set UPSTASH_DISABLE_RATE_LIMIT=true to skip all limit checks.  This lets
 * `next dev` run without an Upstash account.  Never set this in production.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis }     from '@upstash/redis'

// ─────────────────────────────────────────────────────────────────────────────
// Public error class (unchanged API surface)
// ─────────────────────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`)
    this.name = 'RateLimitError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis + Ratelimit initialisation (lazy, module-level singletons)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a no-op Ratelimit stand-in when running locally without Redis.
 * We define only the shape we actually use (.limit(key)).
 */
function makeNoopLimiter() {
  return {
    limit: async (_key: string) => ({
      success: true,
      reset: Date.now() + 60_000,
    }),
  }
}

type Limiter = Ratelimit | ReturnType<typeof makeNoopLimiter>

let _redis: Redis | null = null
let _mutationLimiter: Limiter | null = null
let _groupCreateLimiter: Limiter | null = null

function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

function getRedis(): Redis {
  if (_redis) return _redis
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      '[rate-limit] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN. ' +
      'Set UPSTASH_DISABLE_RATE_LIMIT=true for local dev without Redis.',
    )
  }
  _redis = new Redis({ url, token })
  return _redis
}

function getMutationLimiter(): Limiter {
  if (_mutationLimiter) return _mutationLimiter
  if (process.env.UPSTASH_DISABLE_RATE_LIMIT === 'true' || !isRedisConfigured()) {
    if (!isRedisConfigured()) console.warn('[rate-limit] Upstash env vars not set — rate limiting disabled. Set UPSTASH_DISABLE_RATE_LIMIT=true to silence this warning.')
    _mutationLimiter = makeNoopLimiter()
    return _mutationLimiter
  }
  // 30 requests per 60-second sliding window, keyed by share token
  _mutationLimiter = new Ratelimit({
    redis:     getRedis(),
    limiter:   Ratelimit.slidingWindow(30, '60 s'),
    prefix:    'rl:mutation',
    analytics: false,
  })
  return _mutationLimiter
}

function getGroupCreateLimiter(): Limiter {
  if (_groupCreateLimiter) return _groupCreateLimiter
  if (process.env.UPSTASH_DISABLE_RATE_LIMIT === 'true' || !isRedisConfigured()) {
    _groupCreateLimiter = makeNoopLimiter()
    return _groupCreateLimiter
  }
  // 5 requests per 1-hour sliding window, keyed by IP address
  _groupCreateLimiter = new Ratelimit({
    redis:     getRedis(),
    limiter:   Ratelimit.slidingWindow(5, '1 h'),
    prefix:    'rl:group_create',
    analytics: false,
  })
  return _groupCreateLimiter
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

async function check(limiter: Limiter, key: string): Promise<void> {
  const { success, reset } = await limiter.limit(key)
  if (!success) {
    const retryAfterMs = Math.max(0, reset - Date.now())
    throw new RateLimitError(retryAfterMs)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — same signatures as before, now async
// ─────────────────────────────────────────────────────────────────────────────

/** 30 mutations per minute — keyed by group share token */
export async function checkMutationLimit(token: string): Promise<void> {
  await check(getMutationLimiter(), token)
}

/** 5 group creates per hour — keyed by IP address */
export async function checkGroupCreateLimit(ip: string): Promise<void> {
  await check(getGroupCreateLimiter(), ip)
}