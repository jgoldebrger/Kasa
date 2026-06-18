'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { signIn, useSession } from 'next-auth/react'
import Link from 'next/link'
import { Alert, Button, ButtonLink, Input, Skeleton } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

interface InviteInfo {
  email: string
  role: string
  organizationName: string
  organizationId: string
}

export default function InviteAcceptPage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = params.token ?? ''
  const { data: session, status: sessionStatus } = useSession()
  const t = useT()

  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setLoadError(data.error || t('invite.loadFailed'))
        } else {
          setInfo(data)
        }
      } catch {
        if (!cancelled) setLoadError(t('invite.loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const accept = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      const body: Record<string, string> = { token }
      const isLoggedIn = !!session?.user
      if (!isLoggedIn) {
        if (!name.trim() || password.length < 8) {
          setSubmitError(t('invite.namePasswordRequired'))
          setSubmitting(false)
          return
        }
        body.name = name.trim()
        body.password = password
      }
      const res = await fetch('/api/auth/invite', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(data.error || t('invite.acceptFailed'))
        setSubmitting(false)
        return
      }

      if (!isLoggedIn && info) {
        const signInRes = await signIn('credentials', {
          email: info.email,
          password,
          redirect: false,
        })
        if (signInRes?.error) {
          router.push('/login')
          return
        }
      }
      router.push('/')
      router.refresh()
    } catch {
      setSubmitError(t('common.error'))
      setSubmitting(false)
    }
  }

  if (loading || sessionStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Skeleton h={40} w={40} className="mx-auto mb-4 rounded-lg" />
            <Skeleton h={28} w="70%" className="mx-auto mb-2" />
            <Skeleton h={16} w="85%" className="mx-auto" />
          </div>
          <div className="surface-card p-6 space-y-5">
            <Skeleton h={48} />
            <Skeleton h={42} />
            <Skeleton h={42} />
            <Skeleton h={44} />
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <div className="surface-card p-6 max-w-sm w-full text-center space-y-4">
          <h1 className="text-base font-semibold text-red-600 dark:text-red-400">
            {t('invite.unavailable')}
          </h1>
          <p className="text-sm text-fg-muted">{loadError}</p>
          <ButtonLink href="/login" variant="ghost" size="sm">
            {t('invite.goToSignIn')}
          </ButtonLink>
        </div>
      </div>
    )
  }

  if (!info) return null

  const isLoggedIn = !!session?.user
  const wrongUser = isLoggedIn && session?.user?.email !== info.email

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('invite.title')}</h1>
          <p className="text-sm text-fg-muted mt-1">
            {t('invite.subtitlePrefix')}{' '}
            <span className="font-semibold text-fg">{info.organizationName}</span>{' '}
            {t('invite.subtitleMiddle')} <span className="font-semibold text-fg">{info.role}</span>
          </p>
        </div>

        <form onSubmit={accept} className="surface-card p-6 space-y-5">
          {submitError && <Alert variant="danger">{submitError}</Alert>}

          <Alert variant="info">
            <strong>{t('invite.forLabel')}</strong> {info.email}
          </Alert>

          {wrongUser ? (
            <div className="space-y-3">
              <Alert variant="warning">
                {t('invite.wrongUserPrefix')} <strong>{session?.user?.email}</strong>{' '}
                {t('invite.wrongUserMiddle')} <strong>{info.email}</strong>.{' '}
                {t('invite.wrongUserSuffix')}
              </Alert>
              <ButtonLink href="/api/auth/signout" variant="ghost" size="sm" block>
                {t('nav.signOut')}
              </ButtonLink>
            </div>
          ) : isLoggedIn ? (
            <Button type="submit" loading={submitting} block size="lg">
              {submitting
                ? t('invite.accepting')
                : `${t('invite.acceptJoin')} ${info.organizationName}`}
            </Button>
          ) : (
            <>
              <Input
                label={t('signup.fullName')}
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
              <Input
                label={t('invite.setPassword')}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('signup.passwordPlaceholder')}
              />
              <Button type="submit" loading={submitting} block size="lg">
                {submitting ? t('invite.creatingAccount') : t('invite.acceptCreate')}
              </Button>
              <p className="text-sm text-fg-muted text-center">
                {t('signup.alreadyHaveAccount')}{' '}
                <Link
                  href={`/login?callbackUrl=/invite/${token}`}
                  className="text-accent hover:text-accent-hover font-medium"
                >
                  {t('auth.signIn')}
                </Link>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
