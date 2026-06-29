'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  EnvelopeIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
  BuildingOffice2Icon,
} from '@heroicons/react/24/outline'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useT } from '@/lib/client/i18n'
import {
  fetchSupportModeStatus,
  useSupportModeChanged,
  type SupportModeDetail,
} from '@/lib/client/support-mode'
import { Skeleton } from './ui/Skeleton'

interface EmailSummary {
  failedLast7Days: number
}

interface DashboardActionsResponse {
  emailSummary?: EmailSummary
}

interface EmailConfigResponse {
  configured?: boolean
}

export interface SupportModeLandingCardProps {
  familiesCount?: number
}

export default function SupportModeLandingCard({ familiesCount }: SupportModeLandingCardProps) {
  const t = useT()
  const { data: session } = useSession()
  const isPlatformAdmin = Boolean(session?.user?.isPlatformAdmin)
  const [supportMode, setSupportMode] = useState<SupportModeDetail | null>(null)
  const [failedLast7Days, setFailedLast7Days] = useState<number | null>(null)
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshSupportMode = useCallback(async () => {
    if (!isPlatformAdmin) {
      setSupportMode({ active: false })
      return
    }
    const detail = await fetchSupportModeStatus()
    setSupportMode(detail)
  }, [isPlatformAdmin])

  const fetchOrgSnapshot = useCallback(async () => {
    setLoading(true)
    try {
      const [actions, emailConfig] = await Promise.all([
        cachedFetch<DashboardActionsResponse>('/api/dashboard-actions', { ttl: 30_000 }),
        cachedFetch<EmailConfigResponse>('/api/email-config', { ttl: 30_000 }),
      ])
      setFailedLast7Days(actions.emailSummary?.failedLast7Days ?? 0)
      setSmtpConfigured(Boolean(emailConfig.configured))
    } catch {
      setFailedLast7Days(null)
      setSmtpConfigured(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSupportMode()
  }, [refreshSupportMode])

  useSupportModeChanged(
    useCallback(
      (detail) => {
        setSupportMode(detail)
        if (detail.active) void fetchOrgSnapshot()
      },
      [fetchOrgSnapshot],
    ),
  )

  useEffect(() => {
    if (supportMode?.active) void fetchOrgSnapshot()
  }, [supportMode?.active, fetchOrgSnapshot])

  useOrgChanged(
    useCallback(() => {
      if (supportMode?.active) void fetchOrgSnapshot()
    }, [fetchOrgSnapshot, supportMode?.active]),
  )

  if (!isPlatformAdmin || !supportMode?.active) return null

  const orgName = supportMode.organizationName || t('admin.supportMode.defaultOrg')

  return (
    <section
      className="mb-8 surface-card border border-amber-500/25 p-4 sm:p-6"
      aria-label={t('admin.supportMode.landingTitle')}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-amber-500/10 rounded-md shrink-0">
          <WrenchScrewdriverIcon
            className="h-5 w-5 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
        </div>
        <div>
          <h2 className="text-base font-semibold text-fg">{t('admin.supportMode.landingTitle')}</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            {t('admin.supportMode.landingSubtitle').replace('{orgName}', orgName)}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <Skeleton h={12} w="60%" />
              <div className="mt-2">
                <Skeleton h={20} w="40%" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SnapshotCard
            icon={EnvelopeIcon}
            label={t('dashboard.email.title')}
            value={
              failedLast7Days === null
                ? '—'
                : failedLast7Days > 0
                  ? t('dashboard.email.failedLast7Days').replace('{count}', String(failedLast7Days))
                  : t('dashboard.email.failedLast7DaysNone')
            }
            valueClassName={
              failedLast7Days && failedLast7Days > 0 ? 'text-danger font-medium' : undefined
            }
            href="/communications?tab=log"
            linkLabel={t('admin.supportMode.viewCommunications')}
          />
          <SnapshotCard
            icon={EnvelopeIcon}
            label={t('admin.supportMode.smtpLabel')}
            value={
              smtpConfigured === null
                ? '—'
                : smtpConfigured
                  ? t('admin.supportMode.smtpConfigured')
                  : t('admin.supportMode.smtpNotConfigured')
            }
            valueClassName={
              smtpConfigured === false
                ? 'text-warning font-medium'
                : smtpConfigured
                  ? 'text-success'
                  : undefined
            }
            href="/settings?tab=email"
            linkLabel={t('admin.supportMode.viewEmailSettings')}
          />
          <SnapshotCard
            icon={UserGroupIcon}
            label={t('dashboard.totalFamilies')}
            value={familiesCount !== undefined ? String(familiesCount) : '—'}
            href="/families"
            linkLabel={t('dashboard.manageFamilies')}
          />
          <SnapshotCard
            icon={BuildingOffice2Icon}
            label={t('admin.supportMode.platformLabel')}
            value={t('admin.supportMode.adminHub')}
            href="/admin/organizations"
            linkLabel={t('admin.supportMode.viewOrganizations')}
          />
        </div>
      )}
    </section>
  )
}

function SnapshotCard({
  icon: Icon,
  label,
  value,
  valueClassName,
  href,
  linkLabel,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  valueClassName?: string
  href: string
  linkLabel: string
}) {
  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider font-medium text-fg-muted">{label}</p>
        <Icon className="h-4 w-4 text-fg-muted shrink-0" aria-hidden />
      </div>
      <p className={`text-sm ${valueClassName ?? 'text-fg'}`}>{value}</p>
      <Link
        href={href}
        className="text-xs font-medium text-accent hover:text-accent-hover hover:underline focus-ring rounded mt-auto"
      >
        {linkLabel}
      </Link>
    </div>
  )
}
