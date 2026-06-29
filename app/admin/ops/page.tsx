'use client'

import { useCallback, useEffect, useState } from 'react'
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
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
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
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-app-subtle border-b border-border">
                        <tr>
                          <th className="px-4 py-2 font-semibold">
                            {t('admin.ops.colOrganization')}
                          </th>
                          <th className="px-4 py-2 font-semibold">{t('admin.ops.colFailures')}</th>
                          <th className="px-4 py-2 font-semibold">
                            {t('admin.ops.colLastFailed')}
                          </th>
                          <th className="px-4 py-2 font-semibold">{t('admin.ops.colLastError')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {smtpFailures.map((row) => (
                          <tr key={row.organizationId} className="bg-surface">
                            <td className="px-4 py-2">
                              <div className="font-medium">{row.organizationName || '—'}</div>
                              {row.organizationSlug && (
                                <div className="text-xs text-fg-muted font-mono">
                                  {row.organizationSlug}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <Badge variant="danger">{row.failedCount}</Badge>
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap text-fg-muted">
                              {row.lastFailedAt ? new Date(row.lastFailedAt).toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2 text-fg-muted max-w-md truncate">
                              {row.lastError || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-app-subtle border-b border-border">
                        <tr>
                          <th className="px-4 py-2 font-semibold">
                            {t('admin.ops.colOrganization')}
                          </th>
                          <th className="px-4 py-2 font-semibold">{t('admin.ops.colBounced')}</th>
                          <th className="px-4 py-2 font-semibold">{t('admin.ops.colSent')}</th>
                          <th className="px-4 py-2 font-semibold">
                            {t('admin.ops.colBounceRate')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {highBounceRate.map((row) => (
                          <tr key={row.organizationId} className="bg-surface">
                            <td className="px-4 py-2">
                              <div className="font-medium">{row.organizationName || '—'}</div>
                              {row.organizationSlug && (
                                <div className="text-xs text-fg-muted font-mono">
                                  {row.organizationSlug}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2">{row.bouncedCount}</td>
                            <td className="px-4 py-2">{row.sentCount}</td>
                            <td className="px-4 py-2">
                              <Badge variant="warning">{row.bounceRate}%</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
