import * as Sentry from '@sentry/nextjs'
import { sentryBeforeSend } from '@/lib/sentry-scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    beforeSend: sentryBeforeSend as any,
    sendDefaultPii: false,
    // Lower default trace sample rate. Tracing has a real client-side
    // overhead (extra spans, network beacons); 5% is enough to catch
    // anomalies without dragging Web Vitals.
    tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.05'),
    // Disable session replay by default — the Replay integration adds the
    // biggest chunk to the Sentry client bundle. We still capture replays
    // on errors at a small sample rate so prod incidents have context.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: parseFloat(
      process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_RATE || '0.1',
    ),
    enabled: process.env.NODE_ENV === 'production',
  })
}
