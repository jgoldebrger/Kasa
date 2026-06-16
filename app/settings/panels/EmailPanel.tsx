'use client'

import type React from 'react'
import { EnvelopeIcon } from '@heroicons/react/24/outline'

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
    <div className="bg-surface rounded-lg shadow-lg p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
          <EnvelopeIcon className="h-6 w-6 text-purple-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-fg">Email Configuration</h2>
          <p className="text-sm text-fg-muted">Configure Gmail settings for sending statements</p>
        </div>
      </div>

      {emailConfig && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800">
            <strong>✓ Email configuration is active:</strong> {emailConfig.email}
          </p>
          <p className="text-xs text-green-700 mt-1">
            Your email settings are saved and will be used automatically for sending statements.
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-fg">Gmail Address *</label>
          <input
            type="email"
            required
            value={emailFormData.email}
            onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
            placeholder="your-email@gmail.com"
            className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <p className="text-xs text-fg-muted mt-1">Gmail account to send statements from</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-fg">
            Gmail App Password {emailConfig ? '(leave empty to keep current)' : '*'}
          </label>
          <input
            type="password"
            required={!emailConfig}
            value={emailFormData.password}
            onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
            placeholder={
              emailConfig ? 'Leave empty to keep current password' : '16-character app password'
            }
            className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <p className="text-xs text-fg-muted mt-1">
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

        <div>
          <label className="block text-sm font-medium mb-1 text-fg">From Name</label>
          <input
            type="text"
            value={emailFormData.fromName}
            onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
            placeholder="Kasa Family Management"
            className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <p className="text-xs text-fg-muted mt-1">Display name shown in sent emails</p>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="focus-ring bg-accent text-accent-fg px-4 py-2 rounded-md flex items-center gap-2 hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            <EnvelopeIcon className="h-4 w-4" />
            {saving ? 'Saving...' : emailConfig ? 'Update Configuration' : 'Save Configuration'}
          </button>

          {emailConfig && (
            <button
              type="button"
              onClick={onTest}
              disabled={saving}
              className="focus-ring border border-border bg-surface text-fg px-4 py-2 rounded-md flex items-center gap-2 hover:bg-fg/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <EnvelopeIcon className="h-4 w-4" />
              Send Test Email
            </button>
          )}
        </div>
      </form>

      {emailConfig && (
        <div className="mt-6 p-4 bg-accent/10 border border-accent/20 rounded-lg">
          <h3 className="font-semibold text-fg mb-2">How It Works</h3>
          <ul className="text-sm text-accent-hover space-y-1 list-disc list-inside">
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
        </div>
      )}
    </div>
  )
}
