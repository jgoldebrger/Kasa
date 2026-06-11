import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/app/auth'
import LegalFooterLinks from '@/app/components/legal/LegalFooterLinks'

export const dynamic = 'force-dynamic'

export default async function WelcomePage() {
  const session = await auth()
  if (session?.user?.id) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-app">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <header className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="text-lg font-semibold text-fg">Kasa</span>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="focus-ring text-sm font-medium text-fg-muted hover:text-fg px-3 py-2 rounded-md"
            >
              Sign in
            </Link>
            <Link
              href="/request-invite"
              className="focus-ring text-sm font-medium bg-accent text-accent-fg px-4 py-2 rounded-md hover:bg-accent-hover transition-colors"
            >
              Request an invitation
            </Link>
          </nav>
        </header>

        <section className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-fg mb-6">
            Family-centered membership management
          </h1>
          <p className="text-lg text-fg-muted mb-10 leading-relaxed">
            Track families, dues, lifecycle events, statements, and payments in one
            calm, modern workspace. Built for small communities that want clarity
            without complexity.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/request-invite"
              className="focus-ring w-full sm:w-auto bg-accent text-accent-fg font-medium px-6 py-3 rounded-md hover:bg-accent-hover transition-colors"
            >
              Request an invitation
            </Link>
            <Link
              href="/login"
              className="focus-ring w-full sm:w-auto text-fg font-medium px-6 py-3 rounded-md border border-border hover:bg-fg/5 transition-colors"
            >
              I already have an account
            </Link>
          </div>
          <p className="text-sm text-fg-muted mt-4">
            Kasa is invitation-only while we&apos;re in early access.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-20">
          {[
            {
              title: 'Multi-tenant by design',
              body: 'Each workspace is fully isolated. Your data never crosses organizational lines.',
            },
            {
              title: 'Payments + recurring billing',
              body: 'Charge saved cards, run monthly cycles, and email PDF statements without leaving the app.',
            },
            {
              title: 'Lifecycle events',
              body: 'Births, bar mitzvahs, weddings — track the moments that matter alongside the numbers.',
            },
            {
              title: 'Calendar-aware reports',
              body: 'Yearly P&L, cycle balances, and per-family histories computed on demand.',
            },
            {
              title: 'Role-based access',
              body: 'Owners, admins, and members each get exactly the permissions they need.',
            },
            {
              title: 'Secure by default',
              body: 'Encrypted secrets at rest, rate-limited auth, CSRF protection, and audited mutations.',
            },
          ].map((f) => (
            <div key={f.title} className="surface-card p-6">
              <h3 className="font-semibold text-fg mb-2">{f.title}</h3>
              <p className="text-sm text-fg-muted leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="text-center surface-card p-10">
          <h2 className="text-2xl font-semibold text-fg mb-3">
            Ready to take Kasa for a spin?
          </h2>
          <p className="text-fg-muted mb-6">
            Tell us a little about yourself and we&apos;ll send you an invitation.
          </p>
          <Link
            href="/request-invite"
            className="focus-ring inline-block bg-accent text-accent-fg font-medium px-6 py-3 rounded-md hover:bg-accent-hover transition-colors"
          >
            Request an invitation
          </Link>
        </section>

        <footer className="mt-16 text-center text-sm text-fg-muted space-y-3">
          <LegalFooterLinks />
          <p>&copy; {new Date().getFullYear()} Kasa</p>
        </footer>
      </div>
    </div>
  )
}
