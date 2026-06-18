'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { z } from 'zod'
import { Alert, Button, ButtonLink, Card, Input, Skeleton } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useT } from '@/lib/client/i18n'

export default function ResetPasswordTokenPage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = params.token ?? ''
  const t = useT()

  const [valid, setValid] = useState<boolean | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      if (cancelled) return
      if (!res.ok) {
        setValid(false)
        setReason('invalid')
        return
      }
      const data = await res.json().catch(() => ({}))
      setValid(!!data.valid)
      setReason(data.reason || null)
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const schema = useMemo(
    () =>
      z
        .object({
          password: z.string().min(8, t('resetPassword.validation.passwordMin')),
          confirm: z.string().min(8, t('resetPassword.validation.passwordMin')),
        })
        .refine((values) => values.password === values.confirm, {
          message: t('resetPassword.validation.passwordMismatch'),
          path: ['confirm'],
        }),
    [t],
  )

  const form = useFormState({
    schema,
    initialValues: { password: '', confirm: '' },
    onSubmit: async (values) => {
      setSubmitError(null)
      const res = await fetch('/api/auth/reset-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: values.password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(data.error || t('resetPassword.failed'))
        return
      }
      setDone(true)
      setTimeout(() => router.push('/login'), 1500)
    },
  })

  if (valid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Skeleton h={40} w={40} className="mx-auto mb-4 rounded-lg" />
            <Skeleton h={28} w="70%" className="mx-auto" />
          </div>
          <Card className="text-center">
            <p className="text-sm text-fg-muted">{t('resetPassword.verifying')}</p>
          </Card>
        </div>
      </div>
    )
  }

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <Card className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-base font-semibold text-danger">{t('resetPassword.invalidTitle')}</h1>
          <p className="text-sm text-fg-muted">
            {t('resetPassword.invalidBodyPrefix')}
            {reason || t('resetPassword.invalidReasonUnknown')}
            {t('resetPassword.invalidBodySuffix')}
          </p>
          <ButtonLink href="/reset-password" variant="secondary" size="sm">
            {t('resetPassword.requestNewLink')}
          </ButtonLink>
        </Card>
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
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {t('resetPassword.setNewTitle')}
          </h1>
        </div>

        {done ? (
          <Alert variant="success" className="text-center">
            {t('resetPassword.successMessage')}
          </Alert>
        ) : (
          <Card>
            <form onSubmit={form.handleSubmit} className="space-y-5" noValidate>
              {submitError && <Alert variant="danger">{submitError}</Alert>}

              <Input
                label={t('resetPassword.newPassword')}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder={t('signup.passwordPlaceholder')}
                {...form.register('password')}
              />

              <Input
                label={t('resetPassword.confirmPassword')}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                {...form.register('confirm')}
              />

              <Button type="submit" loading={form.isSubmitting} block size="lg">
                {form.isSubmitting
                  ? t('resetPassword.updating')
                  : t('resetPassword.updatePassword')}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
