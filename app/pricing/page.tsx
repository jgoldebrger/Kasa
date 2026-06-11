import Link from 'next/link'
import { auth } from '@/app/auth'
import { PLAN_DEFINITIONS } from '@/lib/billing/plans'
import PricingActions from './PricingActions'

export const dynamic = 'force-dynamic'

export default async function PricingPage() {
  const session = await auth()
  const isSignedIn = Boolean(session?.user?.id)

  return (
    <div className="min-h-screen bg-app">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <header className="flex items-center justify-between mb-12">
          <Link href={isSignedIn ? '/' : '/welcome'} className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="text-lg font-semibold text-fg">Kasa</span>
          </Link>
          <nav className="flex items-center gap-3">
            {isSignedIn ? (
              <>
                <Link
                  href="/settings?tab=billing"
                  className="focus-ring text-sm font-medium text-fg-muted hover:text-fg px-3 py-2 rounded-md"
                >
                  Billing
                </Link>
                <Link
                  href="/"
                  className="focus-ring text-sm font-medium bg-accent text-accent-fg px-4 py-2 rounded-md hover:bg-accent-hover"
                >
                  Dashboard
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className="focus-ring text-sm font-medium bg-accent text-accent-fg px-4 py-2 rounded-md hover:bg-accent-hover"
              >
                Sign in
              </Link>
            )}
          </nav>
        </header>

        <section className="text-center max-w-3xl mx-auto mb-14">
          <h1 className="text-4xl font-semibold tracking-tight text-fg mb-4">
            Simple pricing for every kehilla
          </h1>
          <p className="text-lg text-fg-muted leading-relaxed">
            Choose a platform plan for your organization. Member card charges and statements
            are included — you only pay Kasa for the workspace capacity you need.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {PLAN_DEFINITIONS.map((plan) => (
            <div
              key={plan.tier}
              className="surface-card p-6 flex flex-col border border-border"
            >
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
          Institution plans are invoiced separately.{' '}
          <a href="mailto:support@kasa.com" className="text-accent hover:underline">
            Contact us
          </a>{' '}
          for a custom quote.
        </p>
      </div>
    </div>
  )
}
