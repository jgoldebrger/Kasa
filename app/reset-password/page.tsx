'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Alert, Button, ButtonLink, Card, Input } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useT } from '@/lib/client/i18n'

export default function ForgotPasswordPage() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null)
  const t = useT()

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().trim().toLowerCase().email(t('resetPassword.validation.email')),
      }),
    [t],
  )

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
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {t('resetPassword.title')}
          </h1>
        </div>

        {submittedEmail ? (
          <Card className="text-center space-y-4">
            <p className="text-sm text-fg">
              {t('resetPassword.emailSentPrefix')} <strong>{submittedEmail}</strong>
              {t('resetPassword.emailSentSuffix')}
            </p>
            {devResetUrl && (
              <Alert variant="warning" className="text-left text-xs">
                <p className="font-medium mb-1">{t('resetPassword.devOnlyLabel')}</p>
                <code className="break-all">{devResetUrl}</code>
              </Alert>
            )}
            <ButtonLink href="/login" variant="ghost" size="sm">
              {t('resetPassword.backToSignIn')}
            </ButtonLink>
          </Card>
        ) : (
          <Card>
            <form onSubmit={form.handleSubmit} className="space-y-5" noValidate>
              <Input
                label={t('auth.email')}
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                {...form.register('email')}
              />
              <Button type="submit" loading={form.isSubmitting} block size="lg">
                {t('resetPassword.sendLink')}
              </Button>
              <p className="text-sm text-fg-muted text-center">
                <Link href="/login" className="text-accent hover:text-accent-hover font-medium">
                  {t('resetPassword.backToSignIn')}
                </Link>
              </p>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
