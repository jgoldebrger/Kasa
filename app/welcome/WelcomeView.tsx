'use client'

import { ButtonLink, Card } from '@/app/components/ui'
import LegalFooterLinks from '@/app/components/legal/LegalFooterLinks'
import { useT } from '@/lib/client/i18n'

const FEATURES = [
  { titleKey: 'welcome.feature.multiTenant.title', bodyKey: 'welcome.feature.multiTenant.body' },
  { titleKey: 'welcome.feature.payments.title', bodyKey: 'welcome.feature.payments.body' },
  { titleKey: 'welcome.feature.lifecycle.title', bodyKey: 'welcome.feature.lifecycle.body' },
  { titleKey: 'welcome.feature.reports.title', bodyKey: 'welcome.feature.reports.body' },
  { titleKey: 'welcome.feature.roles.title', bodyKey: 'welcome.feature.roles.body' },
  { titleKey: 'welcome.feature.security.title', bodyKey: 'welcome.feature.security.body' },
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
            <ButtonLink href="/login" variant="secondary" size="lg" block className="sm:w-auto">
              {t('welcome.hero.hasAccount')}
            </ButtonLink>
          </div>
          <p className="text-sm text-fg-muted mt-4 text-pretty">{t('welcome.earlyAccess')}</p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-20">
          {FEATURES.map((feature) => (
            <Card key={feature.titleKey}>
              <h3 className="font-semibold tracking-tight text-fg mb-2">{t(feature.titleKey)}</h3>
              <p className="text-sm text-fg-muted leading-relaxed text-pretty">
                {t(feature.bodyKey)}
              </p>
            </Card>
          ))}
        </section>

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
