'use client'

import type React from 'react'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Alert, Badge, Button, Input } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

export interface EmailConfig {
  email: string
  fromName?: string
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
  }
  setEmailFormData: React.Dispatch<
    React.SetStateAction<{
      email: string
      password: string
      fromName: string
    }>
  >
  saving: boolean
  message: { type: 'success' | 'error'; text: string } | null
  onSubmit: (e: React.FormEvent) => void | Promise<void>
  onTest: () => void | Promise<void>
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
    </SettingsPanel>
  )
}
