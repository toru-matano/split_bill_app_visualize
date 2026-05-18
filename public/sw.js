/**
 * sw.js — Split Mate Service Worker
 *
 * Architecture: App Shell + Network-First Data
 * ─────────────────────────────────────────────
 * The shell (HTML skeleton, CSS, JS bundles, icons, fonts) is cached on
 * install and served INSTANTLY from cache on every navigation request.
 * The UI renders before any expense or member data is fetched.
 *
 * Data routes (/api/*) are always network-only so stale PII-containing
 * responses are never served from cache. Supabase Realtime handles live sync.
 *
 * Cache strategy matrix
 * ──────────────────────────────────────────────────────────────────────
 *  Navigation (HTML)         Shell-first    → background network refresh
 *  /api/*                    Network-only   (server decrypts PII — never cache)
 *  /_next/static/*           Cache-first    (hashed filenames = safe forever)
 *  /_next/image/*            Cache-first
 *  /icon-*, /manifest.json   Cache-first
 *  Google Fonts / FA CSS     Stale-while-revalidate (72 h TTL)
 *  *.woff2 / *.woff          Cache-first    (immutable font files)
 *  Everything else           Network-first
 */

const SHELL_CACHE  = 'splitmate-shell-v3'
const STATIC_CACHE = 'splitmate-static-v3'
const FONT_CACHE   = 'splitmate-fonts-v3'

// Minimal shell assets to precache on install.
// Next.js /_next/static chunks are added to STATIC_CACHE as they are fetched.
const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
]

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache =>
        // Use allSettled so a single 404 doesn't abort the install
        Promise.allSettled(
          SHELL_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] Precache miss:', url, err)
            )
          )
        )
      )
      .then(() => self.skipWaiting())
  )
})

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const LIVE = new Set([SHELL_CACHE, STATIC_CACHE, FONT_CACHE])
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.filter(k => !LIVE.has(k)).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

// ─── Fetch routing ────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 1. API — network only, never intercept
  if (url.pathname.startsWith('/api/')) return

  // 2. Next.js immutable static assets
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image/')
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // 3. External font / icon CSS
  if (
    url.hostname === 'fonts.googleapis.com' ||
    (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('.css'))
  ) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE, 72 * 60 * 60 * 1000))
    return
  }

  // 4. Font binary files (immutable)
  if (
    url.hostname === 'fonts.gstatic.com' ||
    (url.hostname === 'cdnjs.cloudflare.com' &&
      (url.pathname.endsWith('.woff2') || url.pathname.endsWith('.woff')))
  ) {
    event.respondWith(cacheFirst(request, FONT_CACHE))
    return
  }

  // 5. PWA assets
  if (url.pathname.startsWith('/icon-') || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(request, SHELL_CACHE))
    return
  }

  // 6. Same-origin navigation — serve shell instantly
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(appShellNavigation(request))
    return
  }

  // 7. Default: network-first
  event.respondWith(networkFirst(request, SHELL_CACHE))
})

// ─── Strategies ───────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit   = await cache.match(request)
  if (hit) return hit

  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    return (await cache.match(request)) ??
      new Response('Offline', { status: 503 })
  }
}

async function staleWhileRevalidate(request, cacheName, ttlMs) {
  const cache  = await caches.open(cacheName)
  const cached = await cache.match(request)

  const refresh = fetch(request)
    .then(res => { if (res.ok) cache.put(request, res.clone()); return res })
    .catch(() => null)

  if (cached) {
    const age = Date.now() - new Date(cached.headers.get('date') || 0).getTime()
    if (age < ttlMs) return cached   // fresh: return immediately
    refresh                          // stale: kick off background update …
    return cached                    //        … but still return stale now
  }

  return (await refresh) ?? new Response('Offline', { status: 503 })
}

/**
 * App Shell navigation strategy.
 *
 * Serves the cached '/' shell HTML for every same-origin navigation request,
 * eliminating server round-trip latency. Next.js hydrates on the client;
 * group/expense data loads in the background after first paint.
 *
 * A background fetch quietly refreshes '/' so the shell stays current.
 * Falls back to a full network fetch when the shell is not yet cached
 * (first visit before install completes).
 */
async function appShellNavigation(request) {
  const cache = await caches.open(SHELL_CACHE)
  const shell = await cache.match('/')

  if (shell) {
    // Refresh shell in background without blocking the response
    fetch('/').then(r => { if (r.ok) cache.put('/', r) }).catch(() => {})
    return shell
  }

  // Shell not cached yet — fetch the real URL and prime the cache
  try {
    const res = await fetch(request)
    if (res.ok) cache.put('/', res.clone())
    return res
  } catch {
    return new Response(OFFLINE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

// ─── Push notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Split Mate', {
      body: data.body || 'New expense activity',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'expense-update',
      data: { url: data.url || '/' },
      requireInteraction: false,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'))
})

// ─── SW update handshake ──────────────────────────────────────────────────────
// Client calls postMessage({type:'SKIP_WAITING'}) when a new SW is detected
// waiting, then reloads to activate it.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ─── Offline fallback page ────────────────────────────────────────────────────
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Split Mate — Offline</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f7f6f3;color:#1a1a1a;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;
         -webkit-font-smoothing:antialiased}
    .wrap{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:12px;
          padding:40px 28px;text-align:center;max-width:320px;width:100%}
    .icon{font-size:44px;margin-bottom:18px}
    h1{font-size:18px;font-weight:600;letter-spacing:-.02em;margin-bottom:8px}
    p{font-size:13px;color:#888;margin-bottom:24px;line-height:1.5}
    button{width:100%;height:44px;background:#1a1a1a;color:#fff;border:none;
           border-radius:8px;font-family:inherit;font-size:14px;font-weight:500;cursor:pointer}
    button:active{opacity:.85}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="icon">📡</div>
    <h1>You're offline</h1>
    <p>Check your connection and try again.<br>Your recent groups are still available.</p>
    <button onclick="location.reload()">Retry</button>
  </div>
</body>
</html>`
