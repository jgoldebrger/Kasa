import * as Sentry from '@sentry/nextjs'
import { sentryBeforeSend } from '@/lib/sentry-scrub'

const dsn = process.env.SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // 5% trace sampling on server: same rationale as the client config.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05'),
    enabled: process.env.NODE_ENV === 'production',
    // Scrub PII (emails, reset tokens, Stripe client_secrets, card runs,
    // auth headers, ccInfo, etc.) before anything reaches Sentry. See
    // lib/sentry-scrub.ts for the full key/value redaction list.
    beforeSend: sentryBeforeSend as any,
    sendDefaultPii: false,
  })
}
