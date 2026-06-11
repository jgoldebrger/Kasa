'use client'

import { useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button, Input, Textarea } from '@/app/components/ui'
import { useFormState } from '@/lib/client/useFormState'
import { useToast } from '@/app/components/Toast'
import { CheckCircleIcon } from '@heroicons/react/24/outline'

const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  message: z.string().trim().max(1000, 'Message too long').optional().or(z.literal('')),
})

export default function RequestInvitePage() {
  const [submitted, setSubmitted] = useState(false)
  const toast = useToast()

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
          toast.error(data.error || 'Something went wrong. Please try again.')
          return
        }
        setSubmitted(true)
      } catch {
        toast.error('Network error — please try again.')
      }
    },
  })

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-app">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link
            href="/welcome"
            className="text-sm text-fg-muted hover:text-fg inline-block mb-4"
          >
            &larr; Back
          </Link>
          <div className="inline-flex items-center justify-center w-10 h-10 bg-accent text-accent-fg rounded-lg font-semibold mb-4">
            K
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Request an invitation</h1>
          <p className="text-sm text-fg-muted mt-1">
            Tell us a bit about yourself. We&apos;ll get back to you with an
            invitation link.
          </p>
        </div>

        {submitted ? (
          <div className="surface-card p-6 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400 mb-4" aria-hidden="true">
              <CheckCircleIcon className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-fg mb-2">
              Thanks — your request is in.
            </h2>
            <p className="text-sm text-fg-muted mb-6">
              If we approve your request, you&apos;ll receive an email with a
              link to finish creating your account.
            </p>
            <Link
              href="/welcome"
              className="text-accent hover:text-accent-hover font-medium text-sm"
            >
              Back to the home page
            </Link>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit}
            className="surface-card p-6 space-y-5"
            noValidate
          >
            <Input
              label="Full Name"
              type="text"
              required
              autoComplete="name"
              placeholder="Your name"
              {...form.register('name')}
            />

            <Input
              label="Email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              {...form.register('email')}
            />

            <Textarea
              label="Tell us about yourself"
              hint="What community are you with? How will you use Kasa?"
              rows={4}
              maxLength={1000}
              {...form.register('message')}
            />

            <Button type="submit" loading={form.isSubmitting} block size="lg">
              Request invitation
            </Button>

            <p className="text-sm text-fg-muted text-center">
              Already have an account?{' '}
              <Link
                href="/login"
                className="text-accent hover:text-accent-hover font-medium"
              >
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
