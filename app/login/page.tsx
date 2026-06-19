'use client'

import { Suspense, useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { z } from 'zod'
import { Button, Card, Input } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'

// Reject any callbackUrl that isn't a same-origin relative path. This blocks
// open-redirect attacks like ?callbackUrl=https://evil.com/phishing and
// protocol-relative URLs like ?callbackUrl=//evil.com.
function safeCallbackUrl(raw: string | null): string {
  if (!raw) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

const schema = (t: (key: import('@/lib/i18n/load-locale').MessageKey) => string) =>
  z.object({
    email: z.string().trim().toLowerCase().email(t('auth.emailInvalid')),
    password: z.string().min(1, t('auth.passwordRequired')),
  })

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'))
  const toast = useToast()
  const t = useT()

  // When the precheck says the account has 2FA enabled, we surface a
  // second-step form for the 6-digit code rather than calling signIn()
  // directly. The user submits email+password first, we then prompt
  // for the code; once verified, we call signIn() with all three.
  const [twoFactorStep, setTwoFactorStep] = useState<null | {
    email: string
    password: string
  }>(null)
  const [totpCode, setTotpCode] = useState('')
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)

  const formSchema = useMemo(() => schema(t), [t])

  const completeSignIn = async (email: string, password: string, totpCode: string) => {
    const res = await signIn('credentials', {
      email,
      password,
      totpCode,
      redirect: false,
    })
    if (res?.error) {
      if (totpCode) {
        toast.error(t('auth.invalid2fa'))
      } else {
        toast.error(t('auth.invalidCredentials'))
      }
      return false
    }
    router.push(callbackUrl)
    router.refresh()
    return true
  }

  const form = useFormState({
    schema: formSchema,
    initialValues: { email: '', password: '' },
    onSubmit: async (values) => {
      // Step 1: ask the server whether this account has 2FA enabled
      // before calling signIn() — we want to know up-front so we can
      // collect the 6-digit code instead of submitting and failing.
      try {
        const res = await fetch('/api/auth/precheck-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Send the password too so the endpoint can confirm it before
          // revealing whether the account has 2FA enabled — without this
          // any visitor could enumerate which emails have 2FA on.
          body: JSON.stringify({ email: values.email, password: values.password }),
        })
        if (!res.ok) {
          // Fall through to signIn — precheck is best-effort.
        } else {
          const data = await res.json().catch(() => ({}))
          if (data?.requiresTwoFactor) {
            setTwoFactorStep({ email: values.email, password: values.password })
            return
          }
        }
      } catch {
        // Network error — fall through to a normal signIn attempt; if
        // the user actually has 2FA on, they'll just see the generic
        // invalid-credentials error and can try again from a working
        // network.
      }

      await completeSignIn(values.email, values.password, '')
    },
  })

  const submitTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!twoFactorStep) return
    const cleaned = totpCode.trim()
    if (!cleaned) {
      toast.error(t('auth.enter2faCode'))
      return
    }
    setTwoFactorBusy(true)
    try {
      const ok = await completeSignIn(twoFactorStep.email, twoFactorStep.password, cleaned)
      if (!ok) {
        setTotpCode('')
      }
    } finally {
      setTwoFactorBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('auth.welcomeBack')}</h1>
          <p className="text-sm text-fg-muted mt-1">{t('auth.signInPrompt')}</p>
        </div>

        {twoFactorStep ? (
          <Card>
            <form onSubmit={submitTwoFactor} className="space-y-5" noValidate>
              <div className="text-sm text-fg-muted">
                <span className="text-fg font-medium">{twoFactorStep.email}</span>
                {' — '}
                {t('auth.2faPrompt')}
              </div>
              <Input
                label={t('auth.2faTitle')}
                required
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456 / XXXX-XXXX"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
              />
              <Button type="submit" loading={twoFactorBusy} block size="lg">
                {t('auth.verify')}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setTwoFactorStep(null)
                  setTotpCode('')
                }}
                className="block w-full text-center text-sm text-accent hover:text-accent-hover"
              >
                {t('auth.back')}
              </button>
            </form>
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

              <Input
                label={t('auth.password')}
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                {...form.register('password')}
              />

              <Button type="submit" loading={form.isSubmitting} block size="lg">
                {t('auth.signIn')}
              </Button>

              <div className="text-sm text-fg-muted text-center space-y-1">
                <p>
                  {t('auth.noAccount')}{' '}
                  <Link
                    href="/request-invite"
                    className="text-accent hover:text-accent-hover font-medium"
                  >
                    {t('auth.requestInvite')}
                  </Link>
                </p>
                <p>
                  <Link
                    href="/reset-password"
                    className="text-accent hover:text-accent-hover font-medium"
                  >
                    {t('auth.forgotPassword')}
                  </Link>
                </p>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}

function LoginFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 bg-app"
      aria-busy="true"
      aria-label="Loading sign in"
    >
      <div className="w-full max-w-sm space-y-4">
        <div className="h-10 w-10 rounded-lg bg-app-subtle mx-auto" />
        <div className="h-8 rounded-md bg-app-subtle" />
        <div className="h-10 rounded-md bg-app-subtle" />
        <div className="h-10 rounded-md bg-app-subtle" />
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  )
}
