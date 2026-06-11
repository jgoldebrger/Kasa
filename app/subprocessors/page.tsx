import type { Metadata } from 'next'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'

export const metadata: Metadata = {
  title: 'Subprocessors — Kasa',
  description: 'Third-party subprocessors that support the Kasa platform.',
}

const LAST_UPDATED = 'June 9, 2026'

/** [TEMPLATE] Verify vendor list and regions with operations / legal before publishing. */
const SUBPROCESSORS = [
  {
    name: 'MongoDB Atlas',
    purpose: 'Database hosting and data storage',
    location: '[TEMPLATE — specify region, e.g., US]',
    website: 'https://www.mongodb.com/cloud/atlas',
  },
  {
    name: 'Stripe',
    purpose: 'Payment processing and billing',
    location: '[TEMPLATE — specify region]',
    website: 'https://stripe.com',
  },
  {
    name: 'Resend (or configured email provider)',
    purpose: 'Transactional email delivery',
    location: '[TEMPLATE — specify region]',
    website: 'https://resend.com',
  },
  {
    name: 'Sentry',
    purpose: 'Error monitoring and performance diagnostics',
    location: '[TEMPLATE — specify region]',
    website: 'https://sentry.io',
  },
  {
    name: 'Hosting provider (e.g., Vercel / AWS)',
    purpose: 'Application hosting and CDN',
    location: '[TEMPLATE — specify region]',
    website: '[TEMPLATE]',
  },
] as const

export default function SubprocessorsPage() {
  return (
    <LegalPageLayout title="Subprocessors" lastUpdated={LAST_UPDATED}>
      <section>
        <h2>Overview</h2>
        <p>
          Kasa uses the third-party service providers listed below (&quot;Subprocessors&quot;)
          to help deliver the Service. This page is a <strong>template</strong> — confirm
          vendors, purposes, and data locations with your legal and operations teams before
          publishing.
        </p>
        <p>
          We will update this page when we add or replace Subprocessors. Organizations with
          data-processing agreements may be entitled to advance notice of material changes.
        </p>
      </section>

      <section>
        <h2>Current subprocessors</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm text-left">
            <thead className="bg-app-subtle border-b border-border">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold text-fg">
                  Subprocessor
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-fg">
                  Purpose
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-fg">
                  Location
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SUBPROCESSORS.map((row) => (
                <tr key={row.name} className="bg-surface">
                  <td className="px-4 py-3 text-fg">
                    <a
                      href={row.website}
                      className="text-accent hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{row.purpose}</td>
                  <td className="px-4 py-3 text-fg-muted font-mono text-xs">{row.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Notifications</h2>
        <p>
          <strong>[TEMPLATE]</strong> Describe how customers will be notified of
          subprocessor changes (e.g., email to organization owners, updated DPA, 30-day
          objection period).
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          <strong>[TEMPLATE]</strong> Subprocessor inquiries:{' '}
          <span className="font-mono text-fg">privacy@example.com</span>
        </p>
      </section>
    </LegalPageLayout>
  )
}
