'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { Button, ButtonLink, Card, Input, Skeleton } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import { auth as authSchemas } from '@/lib/schemas'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import type { MessageKey } from '@/lib/i18n/load-locale'

type InvalidReason = 'missing-code' | 'not-found' | 'used' | 'expired' | 'error'

const REASON_KEYS: Record<InvalidReason, MessageKey> = {
  'missing-code': 'signup.reason.missingCode',
  'not-found': 'signup.reason.notFound',
  used: 'signup.reason.used',
  expired: 'signup.reason.expired',
  error: 'signup.reason.error',
}

type CodeState =
  | { kind: 'loading' }
  | { kind: 'valid'; email: string; name: string; orgName: string | null }
  | { kind: 'invalid'; reason: InvalidReason }

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const code = searchParams.get('code') || ''
  const toast = useToast()
  const t = useT()

  const [codeState, setCodeState] = useState<CodeState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!code) {
        if (!cancelled) setCodeState({ kind: 'invalid', reason: 'missing-code' })
        return
      }
      try {
        const res = await fetch(`/api/auth/signup?code=${encodeURIComponent(code)}`)
        if (cancelled) return
        if (!res.ok) {
          setCodeState({ kind: 'invalid', reason: 'error' })
          return
        }
        const data = await res.json().catch(() => ({}))
        if (data?.valid) {
          setCodeState({
            kind: 'valid',
            email: data.email,
            name: data.name,
            orgName: data.orgName || null,
          })
        } else {
          setCodeState({ kind: 'invalid', reason: data?.reason || 'error' })
        }
      } catch {
        if (!cancelled) setCodeState({ kind: 'invalid', reason: 'error' })
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('signup.title')}</h1>
          <p className="text-sm text-fg-muted mt-1">{t('signup.subtitle')}</p>
        </div>

        {codeState.kind === 'loading' && (
          <Card className="space-y-3">
            <Skeleton h={20} w="60%" />
            <Skeleton h={42} />
            <Skeleton h={42} />
            <Skeleton h={42} />
          </Card>
        )}

        {codeState.kind === 'invalid' && (
          <Card className="text-center space-y-4">
            <div
              className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-app-subtle border border-border text-fg-subtle"
              aria-hidden="true"
            >
              <LockClosedIcon className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-fg">{t('signup.invitationRequired')}</h2>
            <p className="text-sm text-fg-muted">{t(REASON_KEYS[codeState.reason])}</p>
            <div className="pt-2 flex flex-col gap-2">
              <ButtonLink href="/request-invite" block size="lg">
                {t('auth.requestInvite')}
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" block size="lg">
                {t('auth.signIn')}
              </ButtonLink>
            </div>
          </Card>
        )}

        {codeState.kind === 'valid' && (
          <ValidSignupForm
            code={code}
            initialName={codeState.name}
            email={codeState.email}
            orgName={codeState.orgName}
            onSuccess={async (pw, welcomeOrgName) => {
              const signInRes = await signIn('credentials', {
                email: codeState.email,
                password: pw,
                redirect: false,
              })
              if (signInRes?.error) {
                toast.error(t('signup.autoLoginFailed'))
                router.push('/login')
                return
              }
              if (welcomeOrgName) {
                toast.success(t('signup.welcomeOrg').replace('{orgName}', welcomeOrgName))
              }
              router.push('/pricing?subscribe=required')
              router.refresh()
            }}
          />
        )}
      </div>
    </div>
  )
}

function ValidSignupForm({
  code,
  email,
  initialName,
  orgName,
  onSuccess,
}: {
  code: string
  email: string
  initialName: string
  orgName: string | null
  onSuccess: (password: string, orgName: string | null) => Promise<void>
}) {
  const toast = useToast()
  const t = useT()

  const signupSchema = authSchemas.signupBody.omit({ email: true, inviteCode: true })

  const form = useFormState({
    schema: signupSchema,
    initialValues: { name: initialName || '', password: '' },
    onSubmit: async (values, { setFieldError }) => {
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inviteCode: code, name: values.name, password: values.password }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (Array.isArray(data?.issues)) {
            for (const issue of data.issues) {
              const field = typeof issue.path === 'string' ? issue.path : ''
              if (field === 'password' || field === 'name') {
                setFieldError(field, issue.message || t('signup.failed'))
              }
            }
            if (data.issues.length > 0) return
          }
          const msg = data?.error || t('signup.failed')
          if (msg.toLowerCase().includes('password')) setFieldError('password', msg)
          else toast.error(msg)
          return
        }
        await onSuccess(values.password, data.orgName || orgName || null)
      } catch {
        toast.error(t('common.networkError'))
      }
    },
  })

  return (
    <Card>
      <form onSubmit={form.handleSubmit} className="space-y-5" noValidate>
        <Input
          label={t('auth.email')}
          type="email"
          value={email}
          readOnly
          disabled
          hint={t('signup.emailHint')}
          autoComplete="email"
        />

        <Input
          label={t('signup.fullName')}
          type="text"
          required
          autoComplete="name"
          placeholder={t('signup.namePlaceholder')}
          {...form.register('name')}
        />

        <Input
          label={t('auth.password')}
          type="password"
          required
          autoComplete="new-password"
          placeholder={t('signup.passwordPlaceholder')}
          hint={t('signup.passwordHint')}
          {...form.register('password')}
        />

        <Button type="submit" loading={form.isSubmitting} block size="lg">
          {t('signup.createAccount')}
        </Button>

        <p className="text-sm text-fg-muted text-center">
          {t('signup.alreadyHaveAccount')}{' '}
          <Link href="/login" className="text-accent hover:text-accent-hover font-medium">
            {t('auth.signIn')}
          </Link>
        </p>
      </form>
    </Card>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}
