'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Alert, Button, Card, Input } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import { CheckCircleIcon } from '@heroicons/react/24/outline'

function slugifyEventType(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'event'
  )
}

export default function SetupWizard({ initialOrgName }: { initialOrgName: string }) {
  const router = useRouter()
  const toast = useToast()
  const t = useT()
  const [step, setStep] = useState(1)
  const [orgName, setOrgName] = useState(initialOrgName)
  const [busy, setBusy] = useState(false)

  const orgSchema = z.object({
    name: z.string().trim().min(2, t('setup.validation.orgNameMin')).max(200),
  })

  const orgForm = useFormState({
    schema: orgSchema,
    initialValues: { name: initialOrgName },
    onSubmit: async (values) => {
      setBusy(true)
      try {
        const res = await fetch('/api/organizations/current', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: values.name }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || t('setup.saveError'))
          return
        }
        setOrgName(values.name)
        setStep(2)
      } catch {
        toast.error(t('common.networkError'))
      } finally {
        setBusy(false)
      }
    },
  })

  const basicsSchema = z.object({
    planName: z.string().trim().min(2, t('setup.validation.planNameMin')).max(100),
    yearlyPrice: z.coerce.number().min(0, t('setup.validation.priceMin')),
    eventName: z.string().trim().min(2, t('setup.validation.eventNameMin')).max(100),
    eventAmount: z.coerce.number().min(0, t('setup.validation.priceMin')),
  })

  const basicsForm = useFormState({
    schema: basicsSchema,
    initialValues: {
      planName: t('setup.defaults.planName'),
      yearlyPrice: 500,
      eventName: t('setup.defaults.eventName'),
      eventAmount: 100,
    },
    onSubmit: async (values) => {
      setBusy(true)
      try {
        const planRes = await fetch('/api/payment-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: values.planName, yearlyPrice: values.yearlyPrice }),
        })
        if (!planRes.ok) {
          const data = await planRes.json().catch(() => ({}))
          toast.error(data.error || t('setup.planError'))
          return
        }

        const eventType = slugifyEventType(values.eventName)
        const eventRes = await fetch('/api/lifecycle-event-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: eventType,
            name: values.eventName,
            amount: values.eventAmount,
          }),
        })
        if (!eventRes.ok) {
          const data = await eventRes.json().catch(() => ({}))
          toast.error(data.error || t('setup.eventError'))
          return
        }

        setStep(3)
      } catch {
        toast.error(t('common.networkError'))
      } finally {
        setBusy(false)
      }
    },
  })

  const emailSchema = z.object({
    email: z.string().trim().email(t('setup.validation.email')),
    password: z.string().min(1, t('setup.validation.passwordRequired')),
    fromName: z.string().trim().max(200).optional().or(z.literal('')),
  })

  const emailForm = useFormState({
    schema: emailSchema,
    initialValues: { email: '', password: '', fromName: initialOrgName },
    onSubmit: async (values) => {
      await finishSetup(async () => {
        const res = await fetch('/api/email-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: values.email,
            password: values.password,
            fromName: values.fromName || orgName,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || t('setup.emailError'))
        }
      })
    },
  })

  const finishSetup = useCallback(
    async (beforeComplete?: () => Promise<void>) => {
      setBusy(true)
      try {
        if (beforeComplete) await beforeComplete()
        const res = await fetch('/api/organizations/setup', { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || t('setup.completeError'))
          return
        }
        toast.success(t('setup.completeSuccess').replace('{orgName}', orgName))
        router.push('/')
        router.refresh()
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : t('common.networkError'))
      } finally {
        setBusy(false)
      }
    },
    [orgName, router, t, toast],
  )

  const handleSkipEmail = () => {
    if (!window.confirm(t('setup.skipEmailConfirm'))) {
      return
    }
    void finishSetup()
  }

  const steps = [t('setup.step.orgName'), t('setup.step.basics'), t('setup.step.email')]

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('setup.title')}</h1>
          <p className="text-sm text-fg-muted mt-1">{t('setup.subtitle')}</p>
        </div>

        <ol
          className="flex items-center justify-center gap-2 mb-6"
          aria-label={t('setup.progressAria')}
        >
          {steps.map((label, i) => {
            const n = i + 1
            const done = step > n
            const current = step === n
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                    done
                      ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'
                      : current
                        ? 'bg-accent text-accent-fg'
                        : 'bg-fg/10 text-fg-muted'
                  }`}
                  aria-current={current ? 'step' : undefined}
                >
                  {done ? <CheckCircleIcon className="h-4 w-4" aria-hidden="true" /> : n}
                </span>
                <span
                  className={`text-xs font-medium hidden sm:inline ${current ? 'text-fg' : 'text-fg-muted'}`}
                >
                  {label}
                </span>
                {i < steps.length - 1 && (
                  <span className="w-6 h-px bg-border hidden sm:block" aria-hidden="true" />
                )}
              </li>
            )
          })}
        </ol>

        <Card>
          {step === 1 && (
            <form onSubmit={orgForm.handleSubmit} className="space-y-5" noValidate>
              <div>
                <h2 className="text-base font-semibold text-fg">{t('setup.step1.title')}</h2>
                <p className="text-sm text-fg-muted mt-1">{t('setup.step1.subtitle')}</p>
              </div>
              <Input
                label={t('setup.orgNameLabel')}
                required
                autoFocus
                {...orgForm.register('name')}
              />
              <Button type="submit" loading={busy || orgForm.isSubmitting} block size="lg">
                {t('setup.continue')}
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={basicsForm.handleSubmit} className="space-y-5" noValidate>
              <div>
                <h2 className="text-base font-semibold text-fg">{t('setup.step2.title')}</h2>
                <p className="text-sm text-fg-muted mt-1">{t('setup.step2.subtitle')}</p>
              </div>
              <Input
                label={t('setup.planNameLabel')}
                required
                {...basicsForm.register('planName')}
              />
              <Input
                label={t('setup.yearlyPriceLabel')}
                type="number"
                min={0}
                step="0.01"
                required
                {...basicsForm.register('yearlyPrice')}
              />
              <Input
                label={t('setup.eventNameLabel')}
                required
                {...basicsForm.register('eventName')}
              />
              <Input
                label={t('setup.eventAmountLabel')}
                type="number"
                min={0}
                step="0.01"
                required
                {...basicsForm.register('eventAmount')}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStep(1)}
                  disabled={busy}
                >
                  {t('setup.back')}
                </Button>
                <Button type="submit" loading={busy || basicsForm.isSubmitting} block size="lg">
                  {t('setup.continue')}
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={emailForm.handleSubmit} className="space-y-5" noValidate>
              <div>
                <h2 className="text-base font-semibold text-fg">{t('setup.step3.title')}</h2>
                <p className="text-sm text-fg-muted mt-1">{t('setup.step3.subtitle')}</p>
              </div>
              <Alert variant="warning">{t('setup.emailSkipWarning')}</Alert>
              <Input
                label={t('auth.email')}
                type="email"
                required
                autoComplete="email"
                {...emailForm.register('email')}
              />
              <Input
                label={t('setup.smtpPasswordLabel')}
                type="password"
                required
                autoComplete="new-password"
                hint={t('setup.smtpPasswordHint')}
                {...emailForm.register('password')}
              />
              <Input label={t('setup.fromNameLabel')} {...emailForm.register('fromName')} />
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setStep(2)}
                    disabled={busy}
                  >
                    {t('setup.back')}
                  </Button>
                  <Button type="submit" loading={busy || emailForm.isSubmitting} block size="lg">
                    {t('setup.finish')}
                  </Button>
                </div>
                <Button type="button" variant="ghost" onClick={handleSkipEmail} disabled={busy}>
                  {t('setup.skipEmail')}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
