'use client'

import { ButtonLink, Card } from '@/app/components/ui'
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
    <div className="min-h-screen bg-app">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-16">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="text-lg font-semibold tracking-tight text-fg">
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

        <section className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-fg text-pretty mb-6">
            {t('welcome.hero.title')}
          </h1>
          <p className="text-lg text-fg-muted mb-10 leading-relaxed text-pretty">
            {t('welcome.hero.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <ButtonLink href="/request-invite" size="lg" block className="sm:w-auto">
              {t('auth.requestInvite')}
            </ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" size="lg" block className="sm:w-auto">
              {t('welcome.hero.viewPricing')}
            </ButtonLink>
          </div>
          <p className="text-sm text-fg-muted mt-4 text-pretty">{t('welcome.earlyAccess')}</p>
        </section>

        <section className="mb-20">
          <h2 className="text-2xl font-semibold tracking-tight text-fg text-center text-pretty mb-8">
            {t('welcome.outcomes.heading')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {OUTCOMES.map((outcome) => (
              <Card key={outcome.titleKey}>
                <h3 className="font-semibold tracking-tight text-fg mb-2">{t(outcome.titleKey)}</h3>
                <p className="text-sm text-fg-muted leading-relaxed text-pretty">
                  {t(outcome.bodyKey)}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <section className="mb-20">
          <h2 className="text-2xl font-semibold tracking-tight text-fg text-center text-pretty mb-8">
            {t('welcome.differentiators.heading')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {DIFFERENTIATORS.map((item) => (
              <Card key={item.titleKey}>
                <h3 className="font-semibold tracking-tight text-fg mb-2">{t(item.titleKey)}</h3>
                <p className="text-sm text-fg-muted leading-relaxed text-pretty">
                  {t(item.bodyKey)}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <Card className="mb-20 p-8 sm:p-10">
          <h2 className="text-xl font-semibold tracking-tight text-fg text-pretty mb-3">
            {t('welcome.billing.title')}
          </h2>
          <p className="text-fg-muted leading-relaxed text-pretty">{t('welcome.billing.body')}</p>
        </Card>

        <Card className="text-center p-8 sm:p-10">
          <h2 className="text-2xl font-semibold tracking-tight text-fg text-pretty mb-3">
            {t('welcome.cta.title')}
          </h2>
          <p className="text-fg-muted mb-6 leading-relaxed text-pretty">
            {t('welcome.cta.subtitle')}
          </p>
          <ButtonLink href="/request-invite" size="lg">
            {t('auth.requestInvite')}
          </ButtonLink>
        </Card>

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
