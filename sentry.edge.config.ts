import * as Sentry from '@sentry/nextjs'
import { sentryBeforeSend } from '@/lib/sentry-scrub'

const dsn = process.env.SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05'),
    enabled: process.env.NODE_ENV === 'production',
    beforeSend: sentryBeforeSend as any,
    sendDefaultPii: false,
  })
}
