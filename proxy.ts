/**
 * proxy.ts
 *
 * Edge proxy that runs before every request.
 *
 * CSRF Protection (improvement #1)
 * ─────────────────────────────────
 * For state-mutating requests (POST / PATCH / PUT / DELETE) to /api/* we
 * enforce that the Origin (or, when absent, the Referer) matches the Host of
 * this deployment.  This stops classic CSRF attacks where a third-party page
 * silently posts to our API using the visitor's browser credentials.
 *
 * Why Origin/Referer instead of a CSRF token?
 *   • The app is a stateless PWA; there is no session to bind a token to.
 *   • SameSite=Strict cookies are not used, so double-submit-cookie is N/A.
 *   • All mutating requests come from fetch() calls in our own JS, which
 *     always send a correct Origin header under the Fetch spec.
 *   • Server-to-server callers (e.g. Supabase webhooks) are excluded via the
 *     CSRF_BYPASS_SECRET header mechanism below.
 *
 * Bypass for legitimate server-to-server calls
 * ─────────────────────────────────────────────
 * Set CSRF_BYPASS_SECRET in your environment and include
 *   X-CSRF-Bypass: <secret>
 * on any internal/webhook requests that legitimately originate off-origin.
 */

import { NextRequest, NextResponse } from 'next/server'

// HTTP methods that can mutate state and therefore require an origin check.
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * Extract the bare host (scheme + host + optional non-standard port) from a
 * full URL string.  Returns null if the string is not a valid URL.
 */
function originOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url)
    return `${protocol}//${host}`
  } catch {
    return null
  }
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const { method } = req

  // ── Only protect /api/* mutating requests ─────────────────────────────────
  if (!pathname.startsWith('/api/') || !MUTATING_METHODS.has(method)) {
    return NextResponse.next()
  }

  // ── Bypass for trusted server-to-server callers ───────────────────────────
  const bypassSecret = process.env.CSRF_BYPASS_SECRET
  if (bypassSecret && req.headers.get('x-csrf-bypass') === bypassSecret) {
    return NextResponse.next()
  }

  // ── Determine the canonical "expected" origin for this deployment ─────────
  //
  // NEXT_PUBLIC_APP_URL must be set in Vercel (e.g. https://your-app.vercel.app).
  // We also accept the request's own Host header so that local `next dev` works
  // without extra configuration.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const requestHost = req.headers.get('host') ?? ''

  // Build the set of allowed origins.
  const allowedOrigins = new Set<string>()
  if (appUrl) {
    const o = originOf(appUrl)
    if (o) allowedOrigins.add(o)
  }
  // Always allow the host the request arrived on (covers Vercel preview URLs
  // and local dev without needing NEXT_PUBLIC_APP_URL to be set).
  if (requestHost) {
    // Infer scheme: Vercel always TLS in production; localhost is plain HTTP.
    const scheme = requestHost.startsWith('localhost') ? 'http' : 'https'
    allowedOrigins.add(`${scheme}://${requestHost}`)
  }

  // ── Read the Origin header (preferred) or fall back to Referer ───────────
  const rawOrigin = req.headers.get('origin')
  const rawReferer = req.headers.get('referer')

  let requestOrigin: string | null = null

  if (rawOrigin) {
    requestOrigin = rawOrigin.trim()
  } else if (rawReferer) {
    requestOrigin = originOf(rawReferer)
  }

  // ── null/missing origin: reject — legitimate same-origin fetch() always
  //    includes Origin for cross-context requests.  Same-origin requests from
  //    our own pages always carry Origin.  A missing header means the request
  //    was constructed by something other than a browser fetch from our app.
  if (!requestOrigin) {
    return NextResponse.json(
      { error: 'CSRF check failed: missing Origin header' },
      { status: 403 },
    )
  }

  if (!allowedOrigins.has(requestOrigin)) {
    return NextResponse.json(
      { error: 'CSRF check failed: cross-origin request rejected' },
      { status: 403 },
    )
  }

  return NextResponse.next()
}

export const config = {
  // Run on every /api/* path; the method check happens inside the function.
  matcher: '/api/:path*',
}