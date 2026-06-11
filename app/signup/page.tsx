'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { z } from 'zod'
import { Button, Input, Skeleton } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useToast } from '@/app/components/Toast'
import { LockClosedIcon } from '@heroicons/react/24/outline'

type InvalidReason = 'missing-code' | 'not-found' | 'used' | 'expired' | 'error'

type CodeState =
  | { kind: 'loading' }
  | { kind: 'valid'; email: string; name: string }
  | { kind: 'invalid'; reason: InvalidReason }

function reasonMessage(reason: InvalidReason): string {
  switch (reason) {
    case 'missing-code':
      return 'Signing up is invitation-only. Please use the link from your invitation email.'
    case 'not-found':
      return 'This invitation code is not recognized. Please use the link from your invitation email.'
    case 'used':
      return 'This invitation has already been used. If you already created an account, please sign in.'
    case 'expired':
      return 'This invitation has expired. Please request a new one.'
    default:
      return 'We couldn\u2019t validate your invitation. Please try again later.'
  }
}

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200, 'Password too long'),
})

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const code = searchParams.get('code') || ''
  const toast = useToast()

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
          setCodeState({ kind: 'valid', email: data.email, name: data.name })
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
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Create your account</h1>
          <p className="text-sm text-fg-muted mt-1">
            Get started with Kasa — you&apos;ll get your own private workspace.
          </p>
        </div>

        {codeState.kind === 'loading' && (
          <div className="surface-card p-6 space-y-3">
            <Skeleton h={20} w="60%" />
            <Skeleton h={42} />
            <Skeleton h={42} />
            <Skeleton h={42} />
          </div>
        )}

        {codeState.kind === 'invalid' && (
          <div className="surface-card p-6 text-center space-y-4">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-app-subtle border border-border text-fg-subtle" aria-hidden="true">
              <LockClosedIcon className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-fg">Invitation required</h2>
            <p className="text-sm text-fg-muted">{reasonMessage(codeState.reason)}</p>
            <div className="pt-2 flex flex-col gap-2">
              <Link
                href="/request-invite"
                className="focus-ring w-full bg-accent text-accent-fg font-medium py-2.5 rounded-md hover:bg-accent-hover transition-colors"
              >
                Request an invitation
              </Link>
              <Link
                href="/login"
                className="focus-ring w-full text-fg font-medium py-2.5 rounded-md border border-border hover:bg-fg/5 transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}

        {codeState.kind === 'valid' && (
          <ValidSignupForm
            code={code}
            initialName={codeState.name}
            email={codeState.email}
            onSuccess={async (pw) => {
              const signInRes = await signIn('credentials', {
                email: codeState.email,
                password: pw,
                redirect: false,
              })
              if (signInRes?.error) {
                toast.error('Account created but auto-login failed. Please log in manually.')
                router.push('/login')
                return
              }
              router.push('/')
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
  onSuccess,
}: {
  code: string
  email: string
  initialName: string
  onSuccess: (password: string) => Promise<void>
}) {
  const toast = useToast()

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
          const msg = data?.error || 'Signup failed'
          if (msg.toLowerCase().includes('password')) setFieldError('password', msg)
          else toast.error(msg)
          return
        }
        await onSuccess(values.password)
      } catch {
        toast.error('Network error — please try again.')
      }
    },
  })

  return (
    <form
      onSubmit={form.handleSubmit}
      className="surface-card p-6 space-y-5"
      noValidate
    >
      <Input
        label="Email"
        type="email"
        value={email}
        readOnly
        disabled
        hint="This is the email your invitation was sent to."
        autoComplete="email"
      />

      <Input
        label="Full Name"
        type="text"
        required
        autoComplete="name"
        placeholder="Your name"
        {...form.register('name')}
      />

      <Input
        label="Password"
        type="password"
        required
        autoComplete="new-password"
        placeholder="At least 8 characters"
        {...form.register('password')}
      />

      <Button type="submit" loading={form.isSubmitting} block size="lg">
        Create account
      </Button>

      <p className="text-sm text-fg-muted text-center">
        Already have an account?{' '}
        <Link href="/login" className="text-accent hover:text-accent-hover font-medium">
          Sign in
        </Link>
      </p>
    </form>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}
