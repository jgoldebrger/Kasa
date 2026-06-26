'use client'

import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Alert, Badge, Button, Input } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

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
  const [tickStatus, setTickStatus] = useState<TickStatusRow | null | undefined>(undefined)

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
      {message && (
        <Alert
          variant={message.type === 'success' ? 'success' : 'danger'}
          className="mb-4"
          title={message.text}
        />
      )}

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
          <Button type="submit" loading={saving} leftIcon={<EnvelopeIcon className="h-4 w-4" />}>
            {emailConfig ? t('settings.email.update') : t('settings.email.save')}
          </Button>

          {emailConfig && (
            <Button
              type="button"
              variant="secondary"
              onClick={onTest}
              disabled={saving}
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
