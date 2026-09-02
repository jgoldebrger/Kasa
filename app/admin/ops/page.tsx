'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/app/components/Toast'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin-constants'
import { useT } from '@/lib/client/i18n'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'

type SmtpFailureRow = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  failedCount: number
  lastFailedAt: string
  lastError: string | null
}

type BounceRateRow = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  sentCount: number
  bouncedCount: number
  totalSends: number
  bounceRate: number
}

type StuckOnboardingRow = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  ownerName: string
  ownerEmail: string
  daysSinceCreated: number | null
  setupProgress?: {
    completed: number
    total: number
    requiredComplete: boolean
  }
}

export default function OpsAdminPage() {
  const toast = useToast()
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [days, setDays] = useState('7')
  const [smtpFailures, setSmtpFailures] = useState<SmtpFailureRow[]>([])
  const [highBounceRate, setHighBounceRate] = useState<BounceRateRow[]>([])
  const [stuckOnboarding, setStuckOnboarding] = useState<StuckOnboardingRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setTwoFactorRequired(false)
    try {
      const qs = new URLSearchParams({ days })
      const res = await fetch(`/api/admin/ops?${qs.toString()}`)
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}))
        if (data?.code === PLATFORM_ADMIN_2FA_REQUIRED_CODE) {
          setTwoFactorRequired(true)
          return
        }
        setForbidden(true)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || t('admin.ops.loadFailed'))
        return
      }
      const data = await res.json()
      setSmtpFailures((data.smtpFailures || []) as SmtpFailureRow[])
      setHighBounceRate((data.highBounceRate || []) as BounceRateRow[])
      setStuckOnboarding((data.stuckOnboarding || []) as StuckOnboardingRow[])
    } catch {
      toast.error(t('admin.ops.networkError'))
    } finally {
      setLoading(false)
    }
  }, [days, t, toast])

  useEffect(() => {
    void load()
  }, [load])

  const smtpColumns = useMemo<DataColumn<SmtpFailureRow>[]>(
    () => [
      {
        id: 'organization',
        header: t('admin.ops.colOrganization'),
        headerText: t('admin.ops.colOrganization'),
        cell: (row) => (
          <>
            <div className="font-medium">{row.organizationName || '—'}</div>
            {row.organizationSlug && (
              <div className="text-xs text-fg-muted font-mono">{row.organizationSlug}</div>
            )}
          </>
        ),
        exportValue: (row) => row.organizationName || row.organizationSlug || '',
      },
      {
        id: 'failedCount',
        header: t('admin.ops.colFailures'),
        headerText: t('admin.ops.colFailures'),
        align: 'right',
        cell: (row) => <Badge variant="danger">{row.failedCount}</Badge>,
        exportValue: (row) => row.failedCount,
      },
      {
        id: 'lastFailedAt',
        header: t('admin.ops.colLastFailed'),
        headerText: t('admin.ops.colLastFailed'),
        cell: (row) => (
          <span className="whitespace-nowrap text-fg-muted">
            {row.lastFailedAt ? new Date(row.lastFailedAt).toLocaleString() : '—'}
          </span>
        ),
        exportValue: (row) => (row.lastFailedAt ? new Date(row.lastFailedAt) : ''),
      },
      {
        id: 'lastError',
        header: t('admin.ops.colLastError'),
        headerText: t('admin.ops.colLastError'),
        cell: (row) => (
          <span className="max-w-md truncate text-fg-muted">{row.lastError || '—'}</span>
        ),
        exportValue: (row) => row.lastError || '',
      },
    ],
    [t],
  )

  const bounceColumns = useMemo<DataColumn<BounceRateRow>[]>(
    () => [
      {
        id: 'organization',
        header: t('admin.ops.colOrganization'),
        headerText: t('admin.ops.colOrganization'),
        cell: (row) => (
          <>
            <div className="font-medium">{row.organizationName || '—'}</div>
            {row.organizationSlug && (
              <div className="text-xs text-fg-muted font-mono">{row.organizationSlug}</div>
            )}
          </>
        ),
        exportValue: (row) => row.organizationName || row.organizationSlug || '',
      },
      {
        id: 'bouncedCount',
        header: t('admin.ops.colBounced'),
        headerText: t('admin.ops.colBounced'),
        align: 'right',
        cell: (row) => row.bouncedCount,
        exportValue: (row) => row.bouncedCount,
      },
      {
        id: 'sentCount',
        header: t('admin.ops.colSent'),
        headerText: t('admin.ops.colSent'),
        align: 'right',
        cell: (row) => row.sentCount,
        exportValue: (row) => row.sentCount,
      },
      {
        id: 'bounceRate',
        header: t('admin.ops.colBounceRate'),
        headerText: t('admin.ops.colBounceRate'),
        align: 'right',
        cell: (row) => <Badge variant="warning">{row.bounceRate}%</Badge>,
        exportValue: (row) => row.bounceRate,
      },
    ],
    [t],
  )

  if (forbidden) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Alert variant="danger" title={t('admin.ops.accessDeniedTitle')}>
          {t('admin.ops.accessDeniedBody')}
        </Alert>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <PageHeader
        title={t('admin.ops.title')}
        subtitle={t('admin.ops.subtitle')}
        actions={
          <ButtonLink href="/admin" variant="secondary" size="sm">
            {t('admin.supportMode.adminHub')}
          </ButtonLink>
        }
      />

      {twoFactorRequired ? (
        <Alert variant="warning" title={t('admin.ops.twoFactorTitle')}>
          <p>{t('admin.ops.twoFactorBody')}</p>
          <Link href="/account" className="mt-2 inline-flex text-sm font-medium text-accent">
            {t('admin.ops.twoFactorLink')} →
          </Link>
        </Alert>
      ) : (
        <>
          <Card className="p-4 flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="min-w-[160px]">
              <Select
                label={t('admin.ops.windowLabel')}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="1">{t('admin.ops.window1d')}</option>
                <option value="7">{t('admin.ops.window7d')}</option>
                <option value="30">{t('admin.ops.window30d')}</option>
              </Select>
            </div>
            <Button type="button" onClick={() => load()}>
              {t('admin.ops.refresh')}
            </Button>
          </Card>

          {loading ? (
            <SkeletonRows count={8} />
          ) : (
            <div className="space-y-8">
              <section>
                <h2 className="text-base font-semibold text-fg mb-1">
                  {t('admin.ops.smtpFailuresTitle')}
                </h2>
                <p className="text-sm text-fg-muted mb-3">
                  {t('admin.ops.smtpFailuresDescription')}
                </p>
                {smtpFailures.length === 0 ? (
                  <EmptyState title={t('admin.ops.smtpFailuresEmpty')} />
                ) : (
                  <DataView
                    tableId="admin-ops-smtp-failures"
                    rows={smtpFailures}
                    columns={smtpColumns}
                    rowKey={(row) => row.organizationId}
                    toolbar={false}
                    defaultSort={{ id: 'failedCount', dir: 'desc' }}
                    mobileCard={(row) => (
                      <Card compact>
                        <p className="font-medium text-fg">{row.organizationName || '—'}</p>
                        {row.organizationSlug && (
                          <p className="text-xs font-mono text-fg-muted">{row.organizationSlug}</p>
                        )}
                        <p className="mt-2 text-sm text-fg-muted">
                          {t('admin.ops.colFailures')}: {row.failedCount}
                        </p>
                        <p className="text-xs text-fg-muted">
                          {row.lastFailedAt ? new Date(row.lastFailedAt).toLocaleString() : '—'}
                        </p>
                        {row.lastError && (
                          <p className="mt-1 text-xs text-danger truncate">{row.lastError}</p>
                        )}
                      </Card>
                    )}
                  />
                )}
              </section>

              <section>
                <h2 className="text-base font-semibold text-fg mb-1">
                  {t('admin.ops.bounceRateTitle')}
                </h2>
                <p className="text-sm text-fg-muted mb-3">{t('admin.ops.bounceRateDescription')}</p>
                {highBounceRate.length === 0 ? (
                  <EmptyState title={t('admin.ops.bounceRateEmpty')} />
                ) : (
                  <DataView
                    tableId="admin-ops-bounce-rate"
                    rows={highBounceRate}
                    columns={bounceColumns}
                    rowKey={(row) => row.organizationId}
                    toolbar={false}
                    defaultSort={{ id: 'bounceRate', dir: 'desc' }}
                    mobileCard={(row) => (
                      <Card compact>
                        <p className="font-medium text-fg">{row.organizationName || '—'}</p>
                        <p className="mt-2 text-sm tabular text-fg-muted">
                          {t('admin.ops.colBounced')}: {row.bouncedCount} · {t('admin.ops.colSent')}
                          : {row.sentCount}
                        </p>
                        <p className="mt-1">
                          <Badge variant="warning">{row.bounceRate}%</Badge>
                        </p>
                      </Card>
                    )}
                  />
                )}
              </section>

              <section>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-base font-semibold text-fg">
                      {t('admin.ops.onboardingTitle')}
                    </h2>
                    <p className="text-sm text-fg-muted">{t('admin.ops.onboardingDescription')}</p>
                  </div>
                  <ButtonLink href="/admin/onboarding" variant="secondary" size="sm">
                    {t('admin.ops.viewOnboarding')}
                  </ButtonLink>
                </div>
                {stuckOnboarding.length === 0 ? (
                  <EmptyState title={t('admin.ops.onboardingEmpty')} />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {stuckOnboarding.map((org) => (
                      <Card key={org.organizationId} className="p-4 space-y-2">
                        <div className="font-semibold text-fg">{org.organizationName || '—'}</div>
                        {org.organizationSlug && (
                          <div className="text-xs text-fg-muted font-mono">
                            {org.organizationSlug}
                          </div>
                        )}
                        {org.ownerEmail && (
                          <div className="text-sm text-fg-muted">
                            {org.ownerName ? `${org.ownerName} · ` : ''}
                            {org.ownerEmail}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {org.daysSinceCreated != null && (
                            <Badge variant="muted">
                              {t('admin.ops.daysOld').replace(
                                '{days}',
                                String(org.daysSinceCreated),
                              )}
                            </Badge>
                          )}
                          {org.setupProgress && (
                            <Badge
                              variant={org.setupProgress.requiredComplete ? 'success' : 'warning'}
                            >
                              {t('admin.ops.setupProgress')
                                .replace('{completed}', String(org.setupProgress.completed))
                                .replace('{total}', String(org.setupProgress.total))}
                            </Badge>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
