'use client'

import { useState } from 'react'
import { Button, Input } from '@/app/components/ui'
import { useToast, useConfirm } from '@/app/components/Toast'

/**
 * Two-factor (TOTP) enrollment section of the Account page.
 *
 * Enrollment is a two-step exchange:
 *   1) POST /api/user/2fa/setup  → server mints a secret, returns the
 *      otpauth:// URI (rendered as a QR via a public quickchart endpoint
 *      so we don't need an extra dep) + the backup codes for the user
 *      to copy.
 *   2) PATCH /api/user/2fa       → user enters a 6-digit TOTP code from
 *      their authenticator; server verifies and flips
 *      `twoFactorEnabled = true`.
 *
 * Disabling requires the current password to avoid session-hijack
 * driven 2FA removal.
 */
export default function TwoFactorSection({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [enrollment, setEnrollment] = useState<{
    otpauthUrl: string
    backupCodes: string[]
  } | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [busy, setBusy] = useState(false)
  // Password re-auth gate: required before any 2FA secret is minted.
  // Prevents a hijacked session from starting an attacker-controlled
  // enrollment that would lock the real owner out.
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [enrollPassword, setEnrollPassword] = useState('')

  const beginEnrollment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!enrollPassword) return
    setBusy(true)
    try {
      const res = await fetch('/api/user/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: enrollPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not start 2FA setup.')
        return
      }
      setEnrollment({
        otpauthUrl: data.otpauthUrl,
        backupCodes: data.backupCodes || [],
      })
      setShowPasswordPrompt(false)
      setEnrollPassword('')
    } catch {
      toast.error('Network error.')
    } finally {
      setBusy(false)
    }
  }

  const confirmEnrollment = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/user/2fa', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable', code: verifyCode.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Invalid code. Try again.')
        return
      }
      toast.success('Two-factor authentication enabled.')
      setEnrollment(null)
      setVerifyCode('')
      onChange()
    } catch {
      toast.error('Network error.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await confirm({
      title: 'Disable two-factor authentication?',
      message: 'Your account will be protected by your password alone. This significantly weakens your security.',
      confirmLabel: 'Disable 2FA',
      destructive: true,
    })
    if (!ok) return

    setBusy(true)
    try {
      const res = await fetch('/api/user/2fa', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'disable',
          password: disablePassword,
          code: disableCode,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not disable 2FA.')
        return
      }
      toast.success('Two-factor authentication disabled.')
      setDisablePassword('')
      setDisableCode('')
      onChange()
    } catch {
      toast.error('Network error.')
    } finally {
      setBusy(false)
    }
  }

  // Generate a QR code via Google Charts (no extra dep). Falls back to
  // letting the user copy the secret/URL into their authenticator app.
  const qrSrc = enrollment
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(enrollment.otpauthUrl)}`
    : null

  return (
    <section className="surface-card rounded-2xl shadow-xl p-6 border border-border">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-fg">Two-factor authentication</h2>
          <p className="text-sm text-fg-muted">
            Add a one-time code from an authenticator app (Google Authenticator, 1Password, Authy, etc.)
            on top of your password.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            enabled
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-fg/10 text-fg-muted'
          }`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {!enabled && !enrollment && !showPasswordPrompt && (
        <Button onClick={() => setShowPasswordPrompt(true)} loading={busy}>
          Set up 2FA
        </Button>
      )}

      {!enabled && !enrollment && showPasswordPrompt && (
        <form onSubmit={beginEnrollment} className="space-y-3" noValidate>
          <p className="text-sm text-fg-muted">
            Confirm your current password to start two-factor setup.
          </p>
          <Input
            label="Current password"
            type="password"
            required
            autoComplete="current-password"
            value={enrollPassword}
            onChange={(e) => setEnrollPassword(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowPasswordPrompt(false)
                setEnrollPassword('')
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!enrollPassword}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {enrollment && (
        <div className="space-y-4">
          <p className="text-sm text-fg">
            Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
          </p>
          {qrSrc && (
            <img
              src={qrSrc}
              alt="2FA QR code"
              width={220}
              height={220}
              className="border border-border rounded-md bg-white p-2"
            />
          )}
          <p className="text-xs text-fg-muted break-all">
            Or paste this URL: <code>{enrollment.otpauthUrl}</code>
          </p>

          {enrollment.backupCodes.length > 0 && (
            <div className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-2">
                Save these backup codes somewhere safe. Each can be used once if you lose access to your authenticator.
              </p>
              <div className="grid grid-cols-2 gap-1 text-xs font-mono text-amber-900 dark:text-amber-200">
                {enrollment.backupCodes.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={confirmEnrollment} className="space-y-3" noValidate>
            <Input
              label="6-digit code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEnrollment(null)
                  setVerifyCode('')
                }}
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={verifyCode.length !== 6}>
                Confirm and enable
              </Button>
            </div>
          </form>
        </div>
      )}

      {enabled && (
        <form onSubmit={disable} className="space-y-3 mt-2" noValidate>
          <Input
            label="Confirm with your password to disable"
            type="password"
            required
            autoComplete="current-password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
          />
          <Input
            label="Current 6-digit code (or a backup code)"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            required
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            placeholder="123456 or XXXX-XXXX"
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="secondary"
              loading={busy}
              disabled={!disablePassword || disableCode.length < 6}
            >
              Disable 2FA
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
