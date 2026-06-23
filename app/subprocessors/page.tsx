import type { Metadata } from 'next'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'
import { LEGAL_LAST_UPDATED, PRIVACY_CONTACT_EMAIL } from '@/lib/legal/contacts'
import { SUBPROCESSORS } from '@/lib/legal/subprocessors'

export const metadata: Metadata = {
  title: 'Subprocessors — Kasa',
  description: 'Third-party subprocessors that support the Kasa platform.',
}

export default function SubprocessorsPage() {
  return (
    <LegalPageLayout title="Subprocessors" lastUpdated={LEGAL_LAST_UPDATED}>
      <section>
        <h2>Overview</h2>
        <p>
          Kasa uses the third-party service providers listed below (&quot;Subprocessors&quot;) to
          help deliver the Service. Each Subprocessor processes personal information only as
          necessary to perform its function and is bound by data protection obligations consistent
          with our{' '}
          <a href="/dpa" className="text-accent hover:underline">
            Data Processing Addendum
          </a>
          .
        </p>
        <p>
          We will update this page when we add or replace Subprocessors. Organization owners with an
          executed DPA are entitled to 30 days&apos; advance notice of material Subprocessor changes
          and may object on reasonable grounds relating to data protection.
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
                  <td className="px-4 py-3 text-fg-muted text-xs">{row.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Notifications</h2>
        <p>
          When we add a new Subprocessor or materially change how an existing Subprocessor processes
          personal information, we will:
        </p>
        <ul>
          <li>Update this page with the effective date</li>
          <li>Email organization owners at least 30 days before the change takes effect</li>
          <li>
            Allow organizations with a DPA to object within that notice period by contacting{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </li>
        </ul>
        <p>
          If an objection cannot be resolved, the organization may terminate the affected Service as
          described in the DPA.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Subprocessor inquiries:{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
        </p>
      </section>
    </LegalPageLayout>
  )
}
