import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import './error-handler'
import SessionProviderWrapper from './components/SessionProviderWrapper'
import AppShell from './components/AppShell'
import { ToastProvider } from './components/Toast'
import WebVitals from './components/WebVitals'
import { SpeedInsights } from '@vercel/speed-insights/next'
import PwaInit from './components/PwaInit'
import CookieNotice from './components/CookieNotice'
import OrgShellProviders from './components/OrgShellProviders'
import { getCachedAuth, getServerOrgContext } from '@/lib/auth-server'
import { loadServerOrgShell } from '@/lib/server-org-shell'
import { OrgRoleProvider } from '@/lib/client/useOrgRole'
import { headers, cookies } from 'next/headers'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Kasa Family Management',
  description: 'Family financial management system with age-based payment plans',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
  applicationName: 'Kasa',
  appleWebApp: {
    capable: true,
    title: 'Kasa',
    statusBarStyle: 'black-translucent',
  },
}

// `themeColor` lives on the dedicated Viewport export in Next 14+.
// Leaving it on `metadata` works but logs a deprecation warning every
// SSR pass, drowning out real server-side log signal during incidents.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

/**
 * Runs before hydration to set `documentElement.classList` based on the
 * stored theme preference, preventing a light→dark flash on cold load.
 * Stored values: 'light' | 'dark' | 'system' (or absent → system).
 */
const themeBootstrapScript = `
(function () {
  try {
    var stored = localStorage.getItem('kasa-theme');
    var pref = stored || 'system';
    var isDark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', pref);
  } catch (e) {}
})();
`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Memoized via React cache(): if any nested server component also resolves
  // the session this request, both calls share a single NextAuth invocation.
  const session = await getCachedAuth()
  const orgCtx = await getServerOrgContext()
  const orgShell = orgCtx ? await loadServerOrgShell(orgCtx.organizationId) : null

  // Pull the per-request CSP nonce that middleware set on the request
  // headers. We stamp it on our inline theme bootstrap so the production
  // CSP (script-src 'self' 'nonce-<x>' 'strict-dynamic') doesn't block
  // it. In dev / API routes the middleware skips CSP and the header is
  // absent — the script just runs without a nonce, which is fine.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  // Derive the initial <html lang/dir> server-side so SSR matches the
  // first client render (and crawlers / screen readers see the right
  // values immediately). Priority:
  //   1. `kasa-locale` cookie — set by the LocalizationPanel when the
  //      user picks a language; lives in document.cookie too.
  //   2. Accept-Language header — first segment.
  //   3. Hardcoded `en-US`.
  // We only honour locales we actually ship translations for so a
  // misleading lang tag doesn't show up.
  const SUPPORTED_LOCALES_SERVER = ['en-US', 'en-GB', 'he-IL', 'yi', 'fr-FR', 'es-MX']
  const RTL_LOCALES_SERVER = ['he-IL', 'yi']
  const cookieLocale = (await cookies()).get('kasa-locale')?.value
  const acceptLang = (await headers()).get('accept-language') || ''
  const headerLocale = acceptLang.split(',')[0]?.trim()
  const initialLocale =
    (cookieLocale && SUPPORTED_LOCALES_SERVER.includes(cookieLocale) && cookieLocale) ||
    (headerLocale && SUPPORTED_LOCALES_SERVER.includes(headerLocale) && headerLocale) ||
    'en-US'
  const initialDir = RTL_LOCALES_SERVER.includes(initialLocale) ? 'rtl' : 'ltr'

  return (
    <html lang={initialLocale} dir={initialDir} className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
          Preconnect to Stripe origins. The payment form is dynamically
          imported, but warming the TLS handshake here means the moment a
          user opens the "Add credit-card payment" flow, the Stripe SDK
          download skips DNS + TCP + TLS round-trips entirely.
        */}
        <link rel="preconnect" href="https://js.stripe.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.stripe.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://js.stripe.com" />
        <link rel="dns-prefetch" href="https://api.stripe.com" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="bg-app text-fg antialiased min-h-screen font-sans">
        <SessionProviderWrapper session={session}>
          <OrgRoleProvider initialRole={orgCtx?.role ?? null}>
            <OrgShellProviders
              initialCurrency={orgShell?.currency}
              initialLocale={orgShell?.locale}
              initialBranding={orgShell?.branding ?? null}
            >
              <ToastProvider>
                <AppShell>{children}</AppShell>
              </ToastProvider>
            </OrgShellProviders>
          </OrgRoleProvider>
        </SessionProviderWrapper>
        <PwaInit />
        <CookieNotice />
        <WebVitals />
        <SpeedInsights />
      </body>
    </html>
  )
}
