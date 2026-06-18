'use client'

import type React from 'react'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Alert, Button, Input } from '@/app/components/ui'

export interface EmailPanelProps {
  emailConfig: any | null
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
  onSubmit: (e: React.FormEvent) => void | Promise<void>
  onTest: () => void | Promise<void>
}

export default function EmailPanel({
  emailConfig,
  emailFormData,
  setEmailFormData,
  saving,
  onSubmit,
  onTest,
}: EmailPanelProps) {
  return (
    <SettingsPanel
      icon={<EnvelopeIcon />}
      title="Email Configuration"
      description="Configure Gmail settings for sending statements"
    >
      {emailConfig && (
        <Alert
          variant="success"
          className="mb-4"
          title={<>✓ Email configuration is active: {emailConfig.email}</>}
        >
          Your email settings are saved and will be used automatically for sending statements.
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Gmail Address"
          type="email"
          required
          value={emailFormData.email}
          onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
          placeholder="your-email@gmail.com"
          hint="Gmail account to send statements from"
        />

        <div>
          <Input
            label={`Gmail App Password ${emailConfig ? '(leave empty to keep current)' : ''}`}
            type="password"
            required={!emailConfig}
            value={emailFormData.password}
            onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
            placeholder={
              emailConfig ? 'Leave empty to keep current password' : '16-character app password'
            }
          />
          <p className="mt-1.5 text-xs text-fg-muted">
            Generate an app password from{' '}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent-hover"
            >
              Google Account Settings
            </a>
          </p>
        </div>

        <Input
          label="From Name"
          type="text"
          value={emailFormData.fromName}
          onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
          placeholder="Kasa Family Management"
          hint="Display name shown in sent emails"
        />

        <div className="flex gap-3 pt-4">
          <Button type="submit" loading={saving} leftIcon={<EnvelopeIcon className="h-4 w-4" />}>
            {emailConfig ? 'Update Configuration' : 'Save Configuration'}
          </Button>

          {emailConfig && (
            <Button
              type="button"
              variant="secondary"
              onClick={onTest}
              disabled={saving}
              leftIcon={<EnvelopeIcon className="h-4 w-4" />}
            >
              Send Test Email
            </Button>
          )}
        </div>
      </form>

      {emailConfig && (
        <Alert variant="info" className="mt-6" title="How It Works">
          <ul className="space-y-1 list-disc list-inside">
            <li>Email configuration is stored securely in the database</li>
            <li>Saved settings are used automatically for all statement emails</li>
            <li>
              Opt in to monthly auto-send from the Automation tab to email statements on the 1st of
              each month
            </li>
            <li>
              You can send individual statements from the Statements page or Family detail page
            </li>
          </ul>
        </Alert>
      )}
    </SettingsPanel>
  )
}
