import type { Metadata, Viewport } from 'next'
import './globals.css'
import { I18nProvider } from '@/lib/i18n'

export const metadata: Metadata = {
  title: 'Split Mate — Group expense splitter',
  description: 'Split trip expenses with friends, no account needed.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Split Mate' },
  formatDetection: { telephone: false },
  openGraph: {
    title: 'Split Mate — Split expenses with friends',
    description: 'No account needed. Create a group, add expenses, settle up.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#1a1a1a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* Preconnect so the TLS handshake is done before the CSS is requested */}
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="anonymous" />
        {/* Font Awesome — non-render-blocking: loads as print, switches to all on load */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
          crossOrigin="anonymous"
          // media="print"
          // onLoad="this.media='all'"
        />
        {/* Fallback for no-JS: render FA normally: deprecated*/}
        {/* <noscript>
          <link
            rel="stylesheet"
            href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
            crossOrigin="anonymous"
          />
        </noscript> */}
      </head>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
