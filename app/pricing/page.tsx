'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { PLAN_DEFINITIONS } from '@/lib/billing/plans'
import { ButtonLink, Card, Skeleton } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import PricingActions from './PricingActions'

export default function PricingPage() {
  const { data: session, status } = useSession()
  const t = useT()
  const isSignedIn = Boolean(session?.user?.id)
  const loading = status === 'loading'

  return (
    <div className="min-h-screen bg-app">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <header className="flex items-center justify-between mb-12">
          <Link href={isSignedIn ? '/' : '/welcome'} className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="text-lg font-semibold tracking-tight text-fg">
              {t('welcome.brand')}
            </span>
          </Link>
          <nav className="flex items-center gap-3">
            {loading ? (
              <Skeleton h={32} w={96} className="rounded-md" />
            ) : isSignedIn ? (
              <>
                <ButtonLink href="/settings?tab=billing" variant="ghost" size="sm">
                  {t('pricing.billing')}
                </ButtonLink>
                <ButtonLink href="/" size="sm">
                  {t('nav.dashboard')}
                </ButtonLink>
              </>
            ) : (
              <ButtonLink href="/login" size="sm">
                {t('auth.signIn')}
              </ButtonLink>
            )}
          </nav>
        </header>

        <p className="mb-8">
          <Link
            href={isSignedIn ? '/' : '/welcome'}
            className="text-sm text-fg-muted hover:text-fg transition-colors"
          >
            ← {t('pricing.backToHome')}
          </Link>
        </p>

        <section className="text-center max-w-3xl mx-auto mb-14">
          <h1 className="text-4xl font-semibold tracking-tight text-fg text-pretty mb-4">
            {t('pricing.hero.title')}
          </h1>
          <p className="text-lg text-fg-muted leading-relaxed text-pretty">
            {t('pricing.hero.subtitle')}
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {PLAN_DEFINITIONS.map((plan) => (
            <Card key={plan.tier} className="flex flex-col border border-border">
              <h2 className="text-xl font-semibold tracking-tight text-fg">{plan.name}</h2>
              <p className="text-3xl font-semibold text-fg mt-2">{plan.monthlyPriceLabel}</p>
              <p className="text-sm text-fg-muted mt-3 mb-5 leading-relaxed">{plan.description}</p>
              <ul className="space-y-2 text-sm text-fg-muted flex-1 mb-6">
                {plan.highlights.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-accent shrink-0" aria-hidden="true">
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {loading ? (
                <Skeleton h={44} className="rounded-md" />
              ) : (
                <PricingActions tier={plan.tier} isSignedIn={isSignedIn} />
              )}
            </Card>
          ))}
        </section>

        <p className="text-center text-sm text-fg-muted text-pretty">
          {t('pricing.institutionNote')}{' '}
          <a href="mailto:support@kasa.com" className="text-accent hover:text-accent-hover">
            {t('pricing.contactUs')}
          </a>{' '}
          {t('pricing.customQuote')}
        </p>
      </div>
    </div>
  )
}
