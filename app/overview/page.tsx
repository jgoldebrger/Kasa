import type { Metadata } from 'next'
import Link from 'next/link'
import { ButtonLink, Card } from '@/app/components/ui'
import LegalFooterLinks from '@/app/components/legal/LegalFooterLinks'
import { PLAN_DEFINITIONS } from '@/lib/billing/plans'
import { SUPPORT_CONTACT_EMAIL } from '@/lib/legal/contacts'

export const metadata: Metadata = {
  title: 'Kasa for Kehillos — Overview',
  description:
    'Membership management built for kehilla treasurers. Pricing, security, and onboarding at a glance.',
}

const SECURITY_HIGHLIGHTS = [
  {
    title: 'Multi-tenant isolation',
    body: 'Every record is scoped to your organization. Role-based access with owner, admin, and member roles.',
  },
  {
    title: 'Encryption & 2FA',
    body: 'Secrets encrypted at rest (AES-256-GCM). Optional TOTP two-factor authentication for all users.',
  },
  {
    title: 'Audit trail',
    body: 'Immutable activity log for payments, settings changes, and imports — exportable to CSV.',
  },
  {
    title: 'Defense in depth',
    body: 'CSRF protection, content security policy, rate limiting, and automated security test suite.',
  },
] as const

const ONBOARDING_STEPS = [
  'Request an invite and create your organization',
  'Complete the setup wizard (payment plans, email, branding)',
  'Connect Stripe for member card payments (optional)',
  'Import families from CSV or add your first family manually',
  'Generate statements and start collecting dues',
] as const

export default function OverviewPage() {
  return (
    <div className="min-h-screen bg-app">
      <div className="max-w-4xl mx-auto px-6 py-12 sm:py-16">
        <header className="mb-10">
          <Link
            href="/welcome"
            className="focus-ring inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg mb-6"
          >
            ← Back to Kasa
          </Link>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="text-lg font-semibold text-fg">Kasa</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-fg mb-3">Kasa for Kehillos</h1>
          <p className="text-fg-muted leading-relaxed max-w-2xl">
            Replace spreadsheet membership books with a purpose-built platform for dues, lifecycle
            events, statements, and Hebrew-calendar automation. This one-pager summarizes pricing,
            security, and onboarding for treasurers evaluating Kasa.
          </p>
        </header>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-fg mb-4">What Kasa does</h2>
          <ul className="list-disc pl-5 text-sm text-fg-muted space-y-2">
            <li>Track families, members, and age-based payment plans</li>
            <li>Record cash, check, and card payments with recurring billing</li>
            <li>Generate and email monthly statements (Gregorian or Hebrew calendar)</li>
            <li>Manage lifecycle events — Bar Mitzvah, Chasuna, births — with linked payments</li>
            <li>Produce yearly P&amp;L, tax receipts, and dues projections</li>
            <li>Support Hebrew, Yiddish, RTL layouts, and multi-currency display</li>
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-fg mb-4">Pricing</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {PLAN_DEFINITIONS.map((plan) => (
              <Card key={plan.tier}>
                <h3 className="font-semibold text-fg">{plan.name}</h3>
                <p className="text-2xl font-semibold text-fg mt-1">{plan.monthlyPriceLabel}</p>
                <p className="text-sm text-fg-muted mt-2">{plan.description}</p>
                <ul className="mt-3 text-sm text-fg-muted space-y-1">
                  {plan.highlights.map((h) => (
                    <li key={h}>• {h}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <p className="text-sm text-fg-muted mt-4">
            <Link href="/pricing" className="text-accent hover:underline">
              View full pricing →
            </Link>
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-fg mb-4">Security highlights</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {SECURITY_HIGHLIGHTS.map((item) => (
              <Card key={item.title}>
                <h3 className="font-semibold text-fg text-sm">{item.title}</h3>
                <p className="text-sm text-fg-muted mt-1 leading-relaxed">{item.body}</p>
              </Card>
            ))}
          </div>
          <p className="text-sm text-fg-muted mt-4">
            Full details:{' '}
            <Link href="/trust" className="text-accent hover:underline">
              Trust &amp; Security
            </Link>
            {' · '}
            <Link href="/dpa" className="text-accent hover:underline">
              Data Processing Addendum
            </Link>
            {' · '}
            <Link href="/subprocessors" className="text-accent hover:underline">
              Subprocessors
            </Link>
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold text-fg mb-4">Onboarding steps</h2>
          <ol className="list-decimal pl-5 text-sm text-fg-muted space-y-2">
            {ONBOARDING_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-sm text-fg-muted mt-4">
            Step-by-step guides:{' '}
            <Link href="/help" className="text-accent hover:underline">
              Help Center
            </Link>
          </p>
        </section>

        <section className="mb-12 rounded-lg border border-border bg-surface p-6">
          <h2 className="text-xl font-semibold text-fg mb-2">Get started</h2>
          <p className="text-sm text-fg-muted mb-4">
            Kasa is available by invitation during early access. Request an invite or contact us
            about the Institution plan for large kehillos.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/request-invite">Request invite</ButtonLink>
            <ButtonLink href={`mailto:${SUPPORT_CONTACT_EMAIL}`} variant="secondary">
              Contact sales
            </ButtonLink>
          </div>
        </section>

        <footer className="pt-8 border-t border-border text-center text-sm text-fg-muted space-y-3">
          <LegalFooterLinks />
          <p>&copy; {new Date().getFullYear()} Kasa</p>
        </footer>
      </div>
    </div>
  )
}
