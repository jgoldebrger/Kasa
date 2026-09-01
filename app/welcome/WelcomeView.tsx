'use client'

import Link from 'next/link'
import { ButtonLink } from '@/app/components/ui'
import LegalFooterLinks from '@/app/components/legal/LegalFooterLinks'
import { useT } from '@/lib/client/i18n'

const OUTCOMES = [
  {
    titleKey: 'welcome.outcomes.spreadsheet.title',
    bodyKey: 'welcome.outcomes.spreadsheet.body',
  },
  {
    titleKey: 'welcome.outcomes.statements.title',
    bodyKey: 'welcome.outcomes.statements.body',
  },
  {
    titleKey: 'welcome.outcomes.balance.title',
    bodyKey: 'welcome.outcomes.balance.body',
  },
] as const

const DIFFERENTIATORS = [
  {
    titleKey: 'welcome.differentiators.rtl.title',
    bodyKey: 'welcome.differentiators.rtl.body',
  },
  {
    titleKey: 'welcome.differentiators.plans.title',
    bodyKey: 'welcome.differentiators.plans.body',
  },
  {
    titleKey: 'welcome.differentiators.receipts.title',
    bodyKey: 'welcome.differentiators.receipts.body',
  },
] as const

export default function WelcomeView() {
  const t = useT()

  return (
    <div className="relative min-h-screen bg-app">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_top,_rgb(var(--c-accent-soft))_0%,_transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-20">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="font-display text-2xl font-semibold tracking-tight text-fg">
              {t('welcome.brand')}
            </span>
          </div>
          <nav className="flex items-center gap-3">
            <ButtonLink href="/login" variant="ghost" size="sm">
              {t('auth.signIn')}
            </ButtonLink>
            <ButtonLink href="/request-invite" size="sm">
              {t('auth.requestInvite')}
            </ButtonLink>
          </nav>
        </header>

        <section className="mb-24">
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-fg text-pretty mb-5">
            {t('welcome.hero.title')}
          </h1>
          <p className="text-lg text-fg-muted mb-8 leading-relaxed text-pretty max-w-2xl">
            {t('welcome.hero.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <ButtonLink href="/request-invite" size="lg" block className="sm:w-auto">
              {t('auth.requestInvite')}
            </ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" size="lg" block className="sm:w-auto">
              {t('welcome.hero.viewPricing')}
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-fg-muted">
            <Link
              href="/overview"
              className="focus-ring rounded underline-offset-2 hover:underline"
            >
              Product overview
            </Link>
            <span className="mx-2 text-fg-subtle" aria-hidden="true">
              ·
            </span>
            <span className="text-pretty">{t('welcome.earlyAccess')}</span>
          </p>
        </section>

        <section className="mb-20">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-fg text-pretty mb-8">
            {t('welcome.outcomes.heading')}
          </h2>
          <ul className="space-y-8 border-t border-border">
            {OUTCOMES.map((outcome) => (
              <li key={outcome.titleKey} className="border-b border-border py-6">
                <h3 className="font-semibold tracking-tight text-fg mb-2">{t(outcome.titleKey)}</h3>
                <p className="text-sm text-fg-muted leading-relaxed text-pretty">
                  {t(outcome.bodyKey)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-20">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-fg text-pretty mb-8">
            {t('welcome.differentiators.heading')}
          </h2>
          <ul className="space-y-8 border-t border-border">
            {DIFFERENTIATORS.map((item) => (
              <li key={item.titleKey} className="border-b border-border py-6">
                <h3 className="font-semibold tracking-tight text-fg mb-2">{t(item.titleKey)}</h3>
                <p className="text-sm text-fg-muted leading-relaxed text-pretty">
                  {t(item.bodyKey)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-16 border-t border-border pt-10">
          <h2 className="font-display text-xl font-semibold tracking-tight text-fg text-pretty mb-3">
            {t('welcome.billing.title')}
          </h2>
          <p className="text-fg-muted leading-relaxed text-pretty mb-10">
            {t('welcome.billing.body')}
          </p>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-fg text-pretty mb-3">
            {t('welcome.cta.title')}
          </h2>
          <p className="text-fg-muted mb-6 leading-relaxed text-pretty">
            {t('welcome.cta.subtitle')}
          </p>
          <ButtonLink href="/request-invite" size="lg">
            {t('auth.requestInvite')}
          </ButtonLink>
        </section>

        <footer className="mt-16 text-center text-sm text-fg-muted space-y-3">
          <LegalFooterLinks />
          <p>
            &copy; {new Date().getFullYear()} {t('welcome.brand')}
          </p>
        </footer>
      </div>
    </div>
  )
}
