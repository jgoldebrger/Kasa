/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // SWC minifier is already the default in Next 14, but stating it
  // explicitly catches accidental regressions if someone bumps versions.
  swcMinify: true,
  compress: true,
  // Produce a self-contained build output so the production server only
  // needs Node + the .next/standalone directory. Smaller cold-start
  // surface; also makes Docker / non-Vercel deploys easy.
  output: 'standalone',
  // Trim heroicons + lodash client bundles by importing only the
  // specific icons/functions referenced rather than the whole barrel
  // file. Heroicons v2 ships per-icon files that use a *default*
  // export, so we leave skipDefaultConversion at its default (false)
  // so Next rewrites `{ FooIcon }` -> `import FooIcon from '...'`.
  modularizeImports: {
    '@heroicons/react/24/outline': {
      transform: '@heroicons/react/24/outline/{{member}}',
    },
    '@heroicons/react/24/solid': {
      transform: '@heroicons/react/24/solid/{{member}}',
    },
    '@heroicons/react/20/solid': {
      transform: '@heroicons/react/20/solid/{{member}}',
    },
    'lodash': {
      transform: 'lodash/{{member}}',
    },
  },
  // `compiler.removeConsole` only matters at build time (SWC strips calls
  // during the production build). Including the key at all triggers a
  // Turbopack "unsupported config" warning in dev, so we omit the block
  // entirely outside of production builds.
  ...(process.env.NODE_ENV === 'production' && {
    compiler: {
      // Strip console.* in production except for errors/warnings — those are
      // still useful for incident triage and surface in Vercel logs anyway.
      removeConsole: { exclude: ['error', 'warn'] },
    },
  }),
  images: {
    formats: ['image/avif', 'image/webp'],
    // 1 year — let edge / CDN serve cached image variants forever.
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },
  experimental: {
    // Keep the server bundle small — heavy Node-only deps don't need to
    // be traced for the edge runtime.
    serverComponentsExternalPackages: ['mongoose', 'bcryptjs', 'nodemailer', 'pino', 'pino-pretty'],
    // Modern, more granular than `modularizeImports`. Next traces the
    // package and only includes the actually-used named exports. Stacks
    // on top of the heroicons/lodash rules above.
    optimizePackageImports: [
      '@heroicons/react',
      '@heroicons/react/24/outline',
      '@heroicons/react/24/solid',
      '@heroicons/react/20/solid',
      '@stripe/react-stripe-js',
      '@tanstack/react-virtual',
      'date-fns',
      'lodash',
    ],
  },
  // Hide the dev-only "x-powered-by" header.
  poweredByHeader: false,
  // Baseline security headers applied to every response. These are
  // production-grade defaults; tighten the CSP further if you ever
  // remove inline styles / scripts. Note we don't set a strict CSP yet
  // because Next.js dev (HMR) and some libs rely on inline scripts; a
  // strict prod-only CSP is a good next step.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Block clickjacking. Nothing in the app should ever be iframed.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME-type sniffing.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Tell browsers to stick with HTTPS once they've seen us on it.
          // Safe even in dev because browsers ignore HSTS over http://.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Don't leak full URLs (with query params) to other origins
          // when users click outbound links.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Lock down powerful APIs we don't use.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          // Old IE legacy; harmless. Most browsers ignore but a few security
          // scanners still flag its absence.
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ]
  },
}

// Wrap with Sentry only if a DSN is configured. This keeps `next build`
// fast and dependency-free for local dev and for self-hosters who don't
// use Sentry.
const withSentryIfConfigured = (cfg) => {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return cfg
  }
  try {
    const { withSentryConfig } = require('@sentry/nextjs')
    return withSentryConfig(cfg, {
      silent: true,
      // Don't upload source maps unless an auth token is provided.
      dryRun: !process.env.SENTRY_AUTH_TOKEN,
    })
  } catch {
    return cfg
  }
}

// Bundle analyzer — opt-in via `ANALYZE=true npm run build`. Produces an
// interactive treemap so we can spot regressions before they ship.
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

module.exports = withBundleAnalyzer(withSentryIfConfigured(nextConfig))

