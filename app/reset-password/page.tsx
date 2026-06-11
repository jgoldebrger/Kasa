'use client'

import { useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button, Input } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
})

export default function ForgotPasswordPage() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null)

  const form = useFormState({
    schema,
    initialValues: { email: '' },
    onSubmit: async (values) => {
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: values.email }),
        })
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          if (data?.resetUrl) setDevResetUrl(data.resetUrl)
        }
        setSubmittedEmail(values.email)
      } catch {
        // Server intentionally returns 200 for unknown emails to prevent
        // enumeration — treat any thrown error as a network failure.
        setSubmittedEmail(values.email)
      }
    },
  })

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Reset your password</h1>
        </div>

        {submittedEmail ? (
          <div className="surface-card p-6 text-center space-y-4">
            <p className="text-sm text-fg">
              If an account exists for <strong>{submittedEmail}</strong>, a reset link has been sent.
            </p>
            {devResetUrl && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-md p-3 text-left text-xs">
                <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">Dev only — reset URL:</p>
                <code className="break-all text-amber-900 dark:text-amber-200">{devResetUrl}</code>
              </div>
            )}
            <Link href="/login" className="inline-block text-accent hover:text-accent-hover font-medium text-sm">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit}
            className="surface-card p-6 space-y-5"
            noValidate
          >
            <Input
              label="Email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              {...form.register('email')}
            />
            <Button type="submit" loading={form.isSubmitting} block size="lg">
              Send reset link
            </Button>
            <p className="text-sm text-fg-muted text-center">
              <Link href="/login" className="text-accent hover:text-accent-hover font-medium">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
