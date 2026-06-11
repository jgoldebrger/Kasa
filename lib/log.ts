/**
 * Centralized structured logger + Sentry integration.
 *
 * - Dev: pretty-printed via pino-pretty (readable in `npm run dev`).
 * - Prod: JSON to stdout (ingestable by Vercel/Datadog/LogDNA/etc).
 * - Errors with `severity >= error` are also captured to Sentry when
 *   `SENTRY_DSN` is set (otherwise the Sentry calls are no-ops).
 *
 * Import-once pattern: do NOT call `pino()` in route handlers — the
 * shared instance below is reused across invocations.
 */

import pino from 'pino'
import * as Sentry from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

// In dev we use the pretty transport for human-readable output. We skip
// transports in prod because they require worker_threads which don't
// play well with edge / serverless environments.
const base = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  // Redact common secret-ish keys defensively in case they end up in
  // structured payloads. Belt + suspenders.
  redact: {
    paths: [
      'password',
      'newPassword',
      'token',
      'authorization',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
})

type Bindings = Record<string, unknown>

/**
 * Log an error AND ship it to Sentry. Use everywhere instead of bare
 * `console.error(err)` so production stack traces are searchable.
 */
export function logError(
  err: unknown,
  context?: Bindings & { module?: string; tags?: Record<string, string> },
): void {
  const { tags, ...rest } = context || {}
  base.error({ err, ...rest }, (err as Error)?.message || 'error')
  if (isProd && process.env.SENTRY_DSN) {
    Sentry.captureException(err, { tags, extra: rest })
  }
}
