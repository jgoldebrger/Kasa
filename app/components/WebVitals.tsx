'use client'

import { useReportWebVitals } from 'next/web-vitals'
import * as Sentry from '@sentry/nextjs'

/**
 * Forwards Core Web Vitals (LCP, CLS, INP, FCP, TTFB) to:
 *   1. Sentry (so we can correlate regressions with deploys + sample errors).
 *   2. The browser console in dev — handy when you want a quick local read.
 *
 * Mount once at the root layout. Costs nothing in builds where Sentry is
 * disabled (the import is a no-op then) and the reporter only runs in
 * production by default.
 */
export default function WebVitals() {
  useReportWebVitals((metric) => {
    // Always log in dev so engineers can see numbers without DevTools.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[web-vitals] ${metric.name}=${metric.value.toFixed(1)} (${metric.rating})`)
      return
    }

    try {
      // Sentry's structured measurement API — surfaces a chart per metric in
      // Performance → Web Vitals.
      Sentry.setMeasurement(metric.name, metric.value, unitFor(metric.name))
      // Also drop a low-cardinality breadcrumb so it shows up next to errors.
      Sentry.addBreadcrumb({
        category: 'web-vital',
        level: 'info',
        message: metric.name,
        data: {
          value: metric.value,
          rating: metric.rating,
          id: metric.id,
        },
      })
    } catch {
      // Best-effort — never let telemetry tear down the page.
    }
  })
  return null
}

function unitFor(name: string): string {
  // CLS is unitless, everything else is reported in milliseconds.
  return name === 'CLS' ? 'none' : 'millisecond'
}
