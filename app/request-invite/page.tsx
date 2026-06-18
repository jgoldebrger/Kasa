'use client'

import { useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button, Input, Textarea } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import { CheckCircleIcon } from '@heroicons/react/24/outline'

export default function RequestInvitePage() {
  const [submitted, setSubmitted] = useState(false)
  const toast = useToast()
  const t = useT()

  const schema = z.object({
    name: z.string().trim().min(2, t('requestInvite.validation.nameMin')).max(100),
    email: z.string().trim().toLowerCase().email(t('requestInvite.validation.email')),
    message: z
      .string()
      .trim()
      .max(1000, t('requestInvite.validation.messageMax'))
      .optional()
      .or(z.literal('')),
  })

  const form = useFormState({
    schema,
    initialValues: { name: '', email: '', message: '' },
    onSubmit: async (values) => {
      try {
        const res = await fetch('/api/auth/request-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || t('requestInvite.submitError'))
          return
        }
        setSubmitted(true)
      } catch {
        toast.error(t('common.networkError'))
      }
    },
  })

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/welcome" className="text-sm text-fg-muted hover:text-fg inline-block mb-4">
            &larr; {t('common.back')}
          </Link>
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {t('auth.requestInvite')}
          </h1>
          <p className="text-sm text-fg-muted mt-1">{t('requestInvite.subtitle')}</p>
        </div>

        {submitted ? (
          <div className="surface-card p-6 text-center">
            <div
              className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400 mb-4"
              aria-hidden="true"
            >
              <CheckCircleIcon className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-fg mb-2">
              {t('requestInvite.thanksTitle')}
            </h2>
            <p className="text-sm text-fg-muted mb-6">{t('requestInvite.thanksBody')}</p>
            <Link
              href="/welcome"
              className="text-accent hover:text-accent-hover font-medium text-sm"
            >
              {t('requestInvite.backHome')}
            </Link>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit} className="surface-card p-6 space-y-5" noValidate>
            <Input
              label={t('signup.fullName')}
              type="text"
              required
              autoComplete="name"
              placeholder={t('signup.namePlaceholder')}
              {...form.register('name')}
            />

            <Input
              label={t('auth.email')}
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              {...form.register('email')}
            />

            <Textarea
              label={t('requestInvite.messageLabel')}
              hint={t('requestInvite.messageHint')}
              rows={4}
              maxLength={1000}
              {...form.register('message')}
            />

            <Button type="submit" loading={form.isSubmitting} block size="lg">
              {t('requestInvite.submit')}
            </Button>

            <p className="text-sm text-fg-muted text-center">
              {t('signup.alreadyHaveAccount')}{' '}
              <Link href="/login" className="text-accent hover:text-accent-hover font-medium">
                {t('auth.signIn')}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
