'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { CheckCircleIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import type {
  SetupProgressStep,
  SetupProgressStepId,
} from '@/lib/route-logic/organizations/setup-progress'

interface SetupProgressResponse {
  organizationId: string
  steps: SetupProgressStep[]
  completed: number
  total: number
  complete: boolean
}

const DISMISS_KEY_PREFIX = 'kasa.onboarding.dismissed.'

const STEP_LABEL_KEYS: Record<SetupProgressStepId, MessageKey> = {
  paymentPlans: 'onboarding.step.paymentPlans',
  eventTypes: 'onboarding.step.eventTypes',
  email: 'onboarding.step.email',
  firstFamily: 'onboarding.step.firstFamily',
  firstPayment: 'onboarding.step.firstPayment',
}

function getDismissed(orgId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISS_KEY_PREFIX + orgId) === '1'
  } catch {
    return false
  }
}

function setDismissed(orgId: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY_PREFIX + orgId, '1')
  } catch {
    /* localStorage may be blocked */
  }
}

function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const pct = total > 0 ? completed / total : 0
  const offset = circumference * (1 - pct)

  return (
    <div className="relative h-10 w-10 shrink-0" aria-hidden="true">
      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-fg/10"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-accent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-fg tabular">
        {completed}/{total}
      </span>
    </div>
  )
}

export default function OnboardingChecklist({
  initialProgress = null,
}: {
  initialProgress?: SetupProgressResponse | null
}) {
  const t = useT()
  const hasInitial = initialProgress != null
  const [progress, setProgress] = useState<SetupProgressResponse | null>(initialProgress)
  const [loading, setLoading] = useState(!hasInitial)
  const [error, setError] = useState(false)
  const [dismissed, setDismissedState] = useState(false)
  const [expanded, setExpanded] = useState(true)

  const fetchProgress = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const data = await cachedFetch<SetupProgressResponse>('/api/organizations/setup-progress', {
        ttl: 15_000,
      })
      setProgress(data)
      setDismissedState(getDismissed(data.organizationId))
      if (data.complete) setExpanded(false)
    } catch {
      setError(true)
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (hasInitial) {
      if (initialProgress) {
        setDismissedState(getDismissed(initialProgress.organizationId))
        if (initialProgress.complete) setExpanded(false)
      }
      return
    }
    fetchProgress()
  }, [fetchProgress, hasInitial, initialProgress])

  useOrgChanged(
    useCallback(() => {
      setExpanded(true)
      fetchProgress()
    }, [fetchProgress]),
  )

  const handleDismiss = () => {
    if (!progress) return
    setDismissed(progress.organizationId)
    setDismissedState(true)
    setExpanded(false)
  }

  const handleReopen = () => {
    setExpanded(true)
  }

  const stepLabels = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(STEP_LABEL_KEYS) as SetupProgressStepId[]).map((id) => [
          id,
          t(STEP_LABEL_KEYS[id]),
        ]),
      ) as Record<SetupProgressStepId, string>,
    [t],
  )

  if (loading) return null
  if (error || !progress || progress.complete) return null

  const showFull = expanded || !dismissed
  const { completed, total, steps } = progress

  if (!showFull) {
    return (
      <div className="mb-8 animate-ui-fade">
        <button
          type="button"
          onClick={handleReopen}
          className="focus-ring w-full surface-card p-4 sm:px-5 flex items-center gap-3 text-left hover:bg-fg/[0.02] transition-colors"
          aria-label={t('onboarding.continueSetupAria')
            .replace('{completed}', String(completed))
            .replace('{total}', String(total))}
        >
          <ProgressRing completed={completed} total={total} />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-fg">
              {t('onboarding.continueSetup')}
            </span>
            <span className="block text-xs text-fg-muted mt-0.5">
              {t('onboarding.stepsComplete')
                .replace('{completed}', String(completed))
                .replace('{total}', String(total))}
            </span>
          </span>
          <span className="text-sm font-medium text-accent shrink-0">
            {t('onboarding.showChecklist')}
          </span>
        </button>
      </div>
    )
  }

  return (
    <section
      className="mb-8 surface-card p-5 sm:p-6 animate-ui-fade"
      aria-labelledby="onboarding-title"
    >
      <div className="flex items-start gap-3">
        <ProgressRing completed={completed} total={total} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="onboarding-title" className="text-base font-semibold text-fg">
                {t('dashboard.welcomeKasa')}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                {completed === 0
                  ? t('onboarding.zeroStepsSubtitle')
                  : t('onboarding.inProgressSubtitle')
                      .replace('{completed}', String(completed))
                      .replace('{total}', String(total))}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="focus-ring shrink-0 p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-fg/5 transition-colors min-h-[var(--touch-target)] min-w-[var(--touch-target)] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
              aria-label={t('onboarding.dismissAria')}
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <ol className="mt-4 divide-y divide-border rounded-md border border-border bg-app-subtle overflow-hidden">
            {steps.map((step, i) => (
              <li key={step.id}>
                <Link
                  href={step.href}
                  className={`focus-ring flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors ${
                    step.done ? 'text-fg-muted bg-fg/[0.02]' : 'text-fg hover:bg-fg/5'
                  }`}
                  aria-current={step.done ? undefined : 'step'}
                >
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      step.done
                        ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'
                        : 'bg-accent/10 text-accent'
                    }`}
                    aria-hidden="true"
                  >
                    {step.done ? <CheckCircleIcon className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={`flex-1 truncate ${step.done ? 'line-through' : ''}`}>
                    {stepLabels[step.id]}
                  </span>
                  {!step.done && (
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="h-4 w-4 text-fg-subtle shrink-0 rtl:rotate-180"
                    />
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
