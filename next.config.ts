import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options',        value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=()' },
  {
    key:   'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' cdnjs.cloudflare.com fonts.googleapis.com",
      "font-src 'self' cdnjs.cloudflare.com fonts.gstatic.com",
      "img-src 'self' data: blob:",

      // Bug 6 fix: add push service endpoints for Chrome (FCM) and Firefox.
      // These are contacted by the BROWSER (not the server) when calling
      // pushManager.subscribe() — they must be in connect-src.
      [
        "connect-src 'self'",
        "*.supabase.co",
        "wss://*.supabase.co",
        "api.frankfurter.dev",
        "fcm.googleapis.com",                      // Chrome / Android WebPush
        "*.push.services.mozilla.com",             // Firefox WebPush
        "*.notify.windows.com",                    // Edge WebPush
        "*.push.apple.com",                        // Safari WebPush (iOS 16.4+)
      ].join(' '),

      // Bug 7 fix: service worker needs script-src 'self' and
      // worker-src 'self' to register and execute /sw.js
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  compress:       true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        source:  '/(.*)',
        headers: securityHeaders,
      },
    ]
  },

  experimental: {
    optimizePackageImports: ['@supabase/supabase-js'],
  },
}

export default nextConfig
