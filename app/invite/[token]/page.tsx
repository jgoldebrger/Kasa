'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, useSession } from 'next-auth/react'
import Link from 'next/link'

interface InviteInfo {
  email: string
  role: string
  organizationName: string
  organizationId: string
}

export default function InviteAcceptPage({ params }: { params: { token: string } }) {
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()

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
        const res = await fetch(`/api/auth/invite?token=${encodeURIComponent(params.token)}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setLoadError(data.error || 'Failed to load invite')
        } else {
          setInfo(data)
        }
      } catch (err) {
        if (!cancelled) setLoadError('Failed to load invite')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params.token])

  const accept = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      const body: any = { token: params.token }
      const isLoggedIn = !!session?.user
      if (!isLoggedIn) {
        if (!name.trim() || password.length < 8) {
          setSubmitError('Name and a password of at least 8 characters are required')
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
        setSubmitError(data.error || 'Failed to accept invite')
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
    } catch (err) {
      setSubmitError('Something went wrong')
      setSubmitting(false)
    }
  }

  if (loading || sessionStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="text-sm text-fg-muted">Loading invite...</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <div className="surface-card p-6 max-w-sm w-full text-center space-y-4">
          <h1 className="text-base font-semibold text-red-600 dark:text-red-400">Invite Unavailable</h1>
          <p className="text-sm text-fg-muted">{loadError}</p>
          <Link href="/login" className="inline-block text-accent hover:text-accent-hover font-medium text-sm">
            Go to sign in
          </Link>
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
          <h1 className="text-2xl font-semibold tracking-tight text-fg">You&apos;re invited</h1>
          <p className="text-sm text-fg-muted mt-1">
            to join <span className="font-semibold text-fg">{info.organizationName}</span> as{' '}
            <span className="font-semibold text-fg">{info.role}</span>
          </p>
        </div>

        <form
          onSubmit={accept}
          className="surface-card p-6 space-y-5"
        >
          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300 px-4 py-3 rounded-md text-sm">
              {submitError}
            </div>
          )}

          <div className="bg-accent/10 border border-accent/20 text-accent px-4 py-3 rounded-md text-sm">
            <strong>Invite for:</strong> {info.email}
          </div>

          {wrongUser ? (
            <div className="space-y-3">
              <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-4 py-3 rounded-md">
                You&apos;re signed in as <strong>{session?.user?.email}</strong> but this invite is
                for <strong>{info.email}</strong>. Please sign out and use the correct account.
              </p>
              <Link href="/api/auth/signout" className="block text-center text-accent hover:text-accent-hover font-medium text-sm">
                Sign out
              </Link>
            </div>
          ) : isLoggedIn ? (
            <button
              type="submit"
              disabled={submitting}
              className="focus-ring w-full bg-accent text-accent-fg font-medium py-2.5 rounded-md hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              {submitting ? 'Accepting...' : `Accept and join ${info.organizationName}`}
            </button>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-fg mb-1.5">Your Name</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1.5">Set a Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                  placeholder="At least 8 characters"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="focus-ring w-full bg-accent text-accent-fg font-medium py-2.5 rounded-md hover:bg-accent-hover transition-colors disabled:opacity-60"
              >
                {submitting ? 'Creating account...' : 'Accept invite & create account'}
              </button>
              <p className="text-sm text-fg-muted text-center">
                Already have an account?{' '}
                <Link href={`/login?callbackUrl=/invite/${params.token}`} className="text-accent hover:text-accent-hover font-medium">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
