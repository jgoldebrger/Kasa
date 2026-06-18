'use client'

import Link from 'next/link'
import { PLAN_DEFINITIONS } from '@/lib/billing/plans'
import { ButtonLink } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import PricingActions from './PricingActions'

interface PricingPageViewProps {
  isSignedIn: boolean
}

export default function PricingPageView({ isSignedIn }: PricingPageViewProps) {
  const t = useT()

  return (
    <div className="min-h-screen bg-app">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <header className="flex items-center justify-between mb-12">
          <Link href={isSignedIn ? '/' : '/welcome'} className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="text-lg font-semibold text-fg">{t('welcome.brand')}</span>
          </Link>
          <nav className="flex items-center gap-3">
            {isSignedIn ? (
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

        <section className="text-center max-w-3xl mx-auto mb-14">
          <h1 className="text-4xl font-semibold tracking-tight text-fg mb-4">
            {t('pricing.hero.title')}
          </h1>
          <p className="text-lg text-fg-muted leading-relaxed">{t('pricing.hero.subtitle')}</p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {PLAN_DEFINITIONS.map((plan) => (
            <div key={plan.tier} className="surface-card p-6 flex flex-col border border-border">
              <h2 className="text-xl font-semibold text-fg">{plan.name}</h2>
              <p className="text-3xl font-semibold text-fg mt-2">{plan.monthlyPriceLabel}</p>
              <p className="text-sm text-fg-muted mt-3 mb-5 leading-relaxed">{plan.description}</p>
              <ul className="space-y-2 text-sm text-fg-muted flex-1 mb-6">
                {plan.highlights.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-accent" aria-hidden="true">
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <PricingActions tier={plan.tier} isSignedIn={isSignedIn} />
            </div>
          ))}
        </section>

        <p className="text-center text-sm text-fg-muted">
          {t('pricing.institutionNote')}{' '}
          <a href="mailto:support@kasa.com" className="text-accent hover:underline">
            {t('pricing.contactUs')}
          </a>{' '}
          {t('pricing.customQuote')}
        </p>
      </div>
    </div>
  )
}
