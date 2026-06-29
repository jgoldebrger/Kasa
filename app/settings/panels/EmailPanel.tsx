'use client'

import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircleIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import ReadOnlySupportGuard from '@/app/components/ReadOnlySupportGuard'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Alert, Badge, Button, Card, Input } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'

export interface EmailConfig {
  email: string
  fromName?: string
  replyTo?: string | null
  lastTestAt?: string | null
  lastTestStatus?: 'success' | 'failed' | null
  lastTestError?: string | null
}

export interface EmailPanelProps {
  emailConfig: EmailConfig | null
  emailFormData: {
    email: string
    password: string
    fromName: string
    replyTo: string
  }
  setEmailFormData: React.Dispatch<
    React.SetStateAction<{
      email: string
      password: string
      fromName: string
      replyTo: string
    }>
  >
  saving: boolean
  message: { type: 'success' | 'error'; text: string } | null
  onSubmit: (e: React.FormEvent) => void | Promise<void>
  onTest: () => void | Promise<void>
}

interface TickStatusRow {
  name?: string
  startedAt?: string
  ranAt?: string
  status?: string
  failed?: number
  processed?: number
  lastError?: string | null
  ok?: boolean
}

const HELP_ARTICLE_SLUGS = ['email-setup', 'email-domain-dns', 'email-can-spam'] as const

type ChecklistStatus = 'pass' | 'warn' | 'fail'

interface DeliverabilityCheck {
  status: ChecklistStatus
  ok: boolean
}

interface DeliverabilityStatusResponse {
  smtpConfigured: DeliverabilityCheck
  smtpVerifiedRecently: DeliverabilityCheck
  replyToSet: DeliverabilityCheck
  physicalAddressSet: DeliverabilityCheck
  quotaHeadroom: DeliverabilityCheck
  quota: { sentToday: number; limit: number; remaining: number }
}

type ChecklistItemId =
  | 'smtpConfigured'
  | 'smtpVerifiedRecently'
  | 'replyToSet'
  | 'physicalAddressSet'
  | 'quotaHeadroom'

const CHECKLIST_ITEMS: { id: ChecklistItemId; helpSlug: (typeof HELP_ARTICLE_SLUGS)[number] }[] = [
  { id: 'smtpConfigured', helpSlug: 'email-setup' },
  { id: 'smtpVerifiedRecently', helpSlug: 'email-setup' },
  { id: 'replyToSet', helpSlug: 'email-setup' },
  { id: 'physicalAddressSet', helpSlug: 'email-can-spam' },
  { id: 'quotaHeadroom', helpSlug: 'email-domain-dns' },
]

function StatusIcon({ status }: { status: ChecklistStatus }) {
  if (status === 'pass') {
    return (
      <CheckCircleIcon
        className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400"
        aria-hidden="true"
      />
    )
  }
  if (status === 'warn') {
    return (
      <ExclamationTriangleIcon
        className="h-5 w-5 shrink-0 text-amber-500 dark:text-amber-400"
        aria-hidden="true"
      />
    )
  }
  return (
    <XCircleIcon className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diffMs = Date.now() - then
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}

function normalizeTickStatus(body: unknown): TickStatusRow | null {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  const row = (root.lastTick ?? root.tick ?? root.data ?? root) as Record<string, unknown> | null
  if (!row || typeof row !== 'object') return null
  const startedAt =
    typeof row.startedAt === 'string'
      ? row.startedAt
      : row.startedAt instanceof Date
        ? row.startedAt.toISOString()
        : typeof row.ranAt === 'string'
          ? row.ranAt
          : undefined
  if (!startedAt && row.status == null && row.name == null) return null
  const failed = typeof row.failed === 'number' ? row.failed : 0
  const status = typeof row.status === 'string' ? row.status : undefined
  return {
    name: typeof row.name === 'string' ? row.name : 'tick',
    startedAt,
    ranAt: startedAt,
    status,
    failed,
    processed: typeof row.processed === 'number' ? row.processed : undefined,
    lastError: typeof row.lastError === 'string' ? row.lastError : null,
    ok: status === 'completed' && failed === 0,
  }
}

export default function EmailPanel({
  emailConfig,
  emailFormData,
  setEmailFormData,
  saving,
  message,
  onSubmit,
  onTest,
}: EmailPanelProps) {
  const t = useT()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [tickStatus, setTickStatus] = useState<TickStatusRow | null | undefined>(undefined)
  const [deliverability, setDeliverability] = useState<
    DeliverabilityStatusResponse | null | undefined
  >(undefined)

  const loadDeliverability = useCallback(async () => {
    setDeliverability(undefined)
    try {
      const res = await fetch('/api/emails/deliverability-status')
      if (!res.ok) {
        setDeliverability(null)
        return
      }
      const body = await res.json().catch(() => null)
      setDeliverability(body as DeliverabilityStatusResponse)
    } catch {
      setDeliverability(null)
    }
  }, [])

  const loadTickStatus = useCallback(async () => {
    setTickStatus(undefined)
    try {
      const res = await fetch('/api/jobs/tick-status')
      if (!res.ok) {
        setTickStatus(null)
        return
      }
      const body = await res.json().catch(() => null)
      setTickStatus(normalizeTickStatus(body))
    } catch {
      setTickStatus(null)
    }
  }, [])

  useEffect(() => {
    void loadTickStatus()
  }, [loadTickStatus])

  useEffect(() => {
    void loadDeliverability()
  }, [
    emailConfig?.email,
    emailConfig?.replyTo,
    emailConfig?.lastTestAt,
    emailConfig?.lastTestStatus,
    loadDeliverability,
  ])

  const tickSummary = (() => {
    if (tickStatus === undefined) return t('settings.cron.lastTick.loading')
    if (tickStatus === null) return t('settings.cron.lastTick.unavailable')
    if (!tickStatus.startedAt) return t('settings.cron.lastTick.none')
    const when = t('settings.cron.lastTick.ranAt').replace(
      '{time}',
      formatRelative(tickStatus.startedAt),
    )
    const failed = tickStatus.failed ?? 0
    const statusFailed = tickStatus.status === 'failed'
    if (statusFailed || failed > 0) {
      const total = tickStatus.processed != null ? tickStatus.processed + failed : failed
      return `${when} — ${t('settings.cron.lastTick.partial')
        .replace('{failed}', String(failed))
        .replace('{total}', String(Math.max(total, failed)))}`
    }
    if (tickStatus.ok === false) {
      return `${when} — ${t('settings.cron.lastTick.failed')}`
    }
    return `${when} — ${t('settings.cron.lastTick.ok')}`
  })()

  return (
    <SettingsPanel
      icon={<EnvelopeIcon />}
      title={t('settings.email.title')}
      description={t('settings.email.description')}
    >
      <ReadOnlySupportGuard className="mb-4" />

      {message && (
        <Alert
          variant={message.type === 'success' ? 'success' : 'danger'}
          className="mb-4"
          title={message.text}
        />
      )}

      <Card className="mb-4" compact>
        <h3 className="text-sm font-medium text-fg">{t('settings.email.checklist.title')}</h3>
        <p className="mt-1 text-xs text-fg-muted">{t('settings.email.checklist.description')}</p>
        <ul className="mt-3 divide-y divide-border rounded-md border border-border overflow-hidden">
          {deliverability === undefined ? (
            <li className="px-3 py-2.5 text-sm text-fg-muted">
              {t('settings.email.checklist.loading')}
            </li>
          ) : deliverability === null ? (
            <li className="px-3 py-2.5 text-sm text-fg-muted">
              {t('settings.email.checklist.unavailable')}
            </li>
          ) : (
            CHECKLIST_ITEMS.map(({ id, helpSlug }) => {
              const check = deliverability[id]
              const detailKey = `settings.email.checklist.${id}.${check.status}` as const
              const detail =
                id === 'quotaHeadroom' && deliverability.quota
                  ? t(detailKey)
                      .replace('{remaining}', String(deliverability.quota.remaining))
                      .replace('{limit}', String(deliverability.quota.limit))
                  : t(detailKey)
              return (
                <li key={id} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
                  <StatusIcon status={check.status} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">
                      {t(`settings.email.checklist.${id}.label`)}
                    </p>
                    <p className="text-xs text-fg-muted">{detail}</p>
                    <Link
                      href={`/help/${helpSlug}`}
                      className="mt-0.5 inline-block text-xs text-accent underline hover:text-accent-hover"
                    >
                      {t(`settings.email.helpLinks.${helpSlug}`)}
                    </Link>
                  </div>
                  <Badge
                    variant={
                      check.status === 'pass'
                        ? 'success'
                        : check.status === 'warn'
                          ? 'warning'
                          : 'danger'
                    }
                    className="shrink-0 normal-case"
                  >
                    {t(`settings.email.checklist.status.${check.status}`)}
                  </Badge>
                </li>
              )
            })
          )}
        </ul>
      </Card>

      <Alert variant="info" className="mb-4" title={t('settings.email.helpLinks.title')}>
        <ul className="space-y-1.5 text-sm">
          {HELP_ARTICLE_SLUGS.map((slug) => (
            <li key={slug}>
              <Link
                href={`/help/${slug}`}
                className="text-accent underline hover:text-accent-hover"
              >
                {t(`settings.email.helpLinks.${slug}`)}
              </Link>
            </li>
          ))}
        </ul>
      </Alert>

      <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-fg">{t('settings.cron.lastTick.title')}</p>
          {tickStatus && tickStatus.startedAt && (
            <Badge
              variant={
                tickStatus.status === 'failed' || (tickStatus.failed ?? 0) > 0
                  ? 'danger'
                  : 'success'
              }
              className="normal-case"
            >
              {tickStatus.name || 'tick'}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-fg-muted">{tickSummary}</p>
        {tickStatus?.lastError && (
          <p className="mt-2 text-xs text-danger">{tickStatus.lastError}</p>
        )}
      </div>

      {emailConfig && (
        <>
          <Alert
            variant="success"
            className="mb-4"
            title={t('settings.email.configActive').replace('{email}', emailConfig.email)}
          >
            {t('settings.email.configActiveBody')}
          </Alert>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {!emailConfig.lastTestAt ? (
              <Badge variant="muted" className="normal-case">
                {t('settings.email.health.notTested')}
              </Badge>
            ) : emailConfig.lastTestStatus === 'success' ? (
              <>
                <Badge variant="success" className="normal-case">
                  {t('settings.email.health.connected')}
                </Badge>
                <span className="text-xs text-fg-muted">
                  {t('settings.email.health.lastTested').replace(
                    '{time}',
                    formatRelative(emailConfig.lastTestAt),
                  )}
                </span>
              </>
            ) : (
              <>
                <Badge variant="danger" className="normal-case">
                  {t('settings.email.health.failed')}
                </Badge>
                <span className="text-xs text-fg-muted">
                  {t('settings.email.health.lastTested').replace(
                    '{time}',
                    formatRelative(emailConfig.lastTestAt),
                  )}
                </span>
              </>
            )}
          </div>

          {emailConfig.lastTestStatus === 'failed' && emailConfig.lastTestError && (
            <Alert
              variant="danger"
              className="mb-4"
              title={t('settings.email.health.connectionError')}
            >
              {emailConfig.lastTestError}
            </Alert>
          )}
        </>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label={t('settings.email.gmailAddress')}
          type="email"
          required
          value={emailFormData.email}
          onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
          placeholder="your-email@gmail.com"
          hint={t('settings.email.gmailAddressHint')}
        />

        <div>
          <Input
            label={
              emailConfig
                ? t('settings.email.appPasswordKeepCurrent')
                : t('settings.email.appPassword')
            }
            type="password"
            required={!emailConfig}
            value={emailFormData.password}
            onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
            placeholder={
              emailConfig
                ? t('settings.email.appPasswordPlaceholder')
                : t('settings.email.appPasswordPlaceholderNew')
            }
          />
          <p className="mt-1.5 text-xs text-fg-muted">
            {t('settings.email.appPasswordHintPrefix')}{' '}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent-hover"
            >
              {t('settings.email.appPasswordHintLink')}
            </a>
          </p>
          <p className="mt-1 text-xs text-fg-muted">{t('settings.email.appPasswordSpacesHint')}</p>
        </div>

        <Input
          label={t('settings.email.fromName')}
          type="text"
          value={emailFormData.fromName}
          onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
          placeholder="Kasa Family Management"
          hint={t('settings.email.fromNameHint')}
        />

        <Input
          label={t('settings.email.replyTo')}
          type="email"
          value={emailFormData.replyTo}
          onChange={(e) => setEmailFormData({ ...emailFormData, replyTo: e.target.value })}
          placeholder="office@yourkehilla.org"
          hint={t('settings.email.replyToHint')}
        />

        <div className="flex gap-3 pt-4">
          <Button
            type="submit"
            loading={saving}
            disabled={supportReadOnly}
            leftIcon={<EnvelopeIcon className="h-4 w-4" />}
          >
            {emailConfig ? t('settings.email.update') : t('settings.email.save')}
          </Button>

          {emailConfig && (
            <Button
              type="button"
              variant="secondary"
              onClick={onTest}
              disabled={supportReadOnly || saving}
              leftIcon={<EnvelopeIcon className="h-4 w-4" />}
            >
              {t('settings.email.sendTest')}
            </Button>
          )}
        </div>
      </form>

      {emailConfig && (
        <Alert variant="info" className="mt-6" title={t('settings.email.howItWorks.title')}>
          <ul className="space-y-1 list-disc list-inside">
            <li>{t('settings.email.howItWorks.storedSecurely')}</li>
            <li>{t('settings.email.howItWorks.autoUsed')}</li>
            <li>{t('settings.email.howItWorks.monthlyAutoSend')}</li>
            <li>{t('settings.email.howItWorks.individualSend')}</li>
          </ul>
        </Alert>
      )}

      <Alert variant="info" className="mt-4" title={t('sms.comingSoon.title')}>
        {t('sms.comingSoon.message')}
      </Alert>
    </SettingsPanel>
  )
}
