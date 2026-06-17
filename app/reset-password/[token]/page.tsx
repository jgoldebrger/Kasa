'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

export default function ResetPasswordTokenPage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = params.token ?? ''
  const [valid, setValid] = useState<boolean | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      if (!res.ok) {
        setValid(false)
        setReason('invalid')
        return
      }
      const data = await res.json().catch(() => ({}))
      setValid(!!data.valid)
      setReason(data.reason || null)
    })()
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to reset password')
        return
      }
      setDone(true)
      setTimeout(() => router.push('/login'), 1500)
    } finally {
      setBusy(false)
    }
  }

  if (valid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <p className="text-sm text-fg-muted">Verifying token...</p>
      </div>
    )
  }

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <div className="surface-card p-6 max-w-sm w-full text-center space-y-4">
          <h1 className="text-base font-semibold text-red-600 dark:text-red-400">
            Invalid or expired link
          </h1>
          <p className="text-sm text-fg-muted">
            This password reset link is no longer valid ({reason || 'unknown'}). Please request a
            new one.
          </p>
          <Link
            href="/reset-password"
            className="inline-block text-accent hover:text-accent-hover font-medium text-sm"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Set a new password</h1>
        </div>

        {done ? (
          <div className="bg-green-50 border border-green-200 text-green-800 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-300 rounded-lg p-6 text-center text-sm">
            Password updated. Redirecting to sign-in...
          </div>
        ) : (
          <form onSubmit={submit} className="surface-card p-6 space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300 px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">New password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Confirm password</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="focus-ring w-full bg-accent text-accent-fg font-medium py-2.5 rounded-md hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? 'Updating...' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
