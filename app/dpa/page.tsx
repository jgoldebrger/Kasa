import type { Metadata } from 'next'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY_NAME,
  LEGAL_LAST_UPDATED,
  PRIVACY_CONTACT_EMAIL,
} from '@/lib/legal/contacts'

export const metadata: Metadata = {
  title: 'Data Processing Addendum — Kasa',
  description: 'Data processing terms for organizations using Kasa.',
}

export default function DpaPage() {
  return (
    <LegalPageLayout title="Data Processing Addendum" lastUpdated={LEGAL_LAST_UPDATED}>
      <section>
        <h2>1. Scope</h2>
        <p>
          This Data Processing Addendum (&quot;DPA&quot;) forms part of the agreement between
          {LEGAL_ENTITY_NAME} (&quot;Processor&quot;) and the organization that accepts these terms
          (&quot;Controller&quot;) when the Controller uses the Kasa Service. It applies where the
          Controller is subject to the GDPR, UK GDPR, or similar data protection laws and processes
          personal data through the Service.
        </p>
        <p>
          Capitalized terms not defined here have the meanings in our{' '}
          <a href="/terms" className="text-accent hover:underline">
            Terms of Service
          </a>
          .
        </p>
      </section>

      <section>
        <h2>2. Roles and instructions</h2>
        <p>
          The Controller determines the purposes and means of processing personal data about its
          members and families. The Processor processes such data only on documented instructions
          from the Controller, including as described in the Service documentation and the
          Controller&apos;s configuration of the Service.
        </p>
        <p>
          The Processor will inform the Controller if an instruction infringes applicable data
          protection law.
        </p>
      </section>

      <section>
        <h2>3. Processor obligations</h2>
        <p>The Processor will:</p>
        <ul>
          <li>Process personal data only as instructed by the Controller</li>
          <li>
            Ensure personnel with access to personal data are bound by confidentiality obligations
          </li>
          <li>
            Implement appropriate technical and organizational measures per our{' '}
            <a href="/trust" className="text-accent hover:underline">
              Trust &amp; Security
            </a>{' '}
            page
          </li>
          <li>
            Assist the Controller with data subject requests using available Service features
            (including org-wide data export) and reasonable support
          </li>
          <li>
            Notify the Controller without undue delay after becoming aware of a personal data breach
            affecting Controller data
          </li>
          <li>
            Delete or return personal data upon termination of the Service, subject to legal
            retention requirements and backup cycles (up to 30 days)
          </li>
          <li>Make available information necessary to demonstrate compliance with this DPA</li>
        </ul>
      </section>

      <section>
        <h2>4. Subprocessors</h2>
        <p>
          The Controller authorizes the Processor to engage Subprocessors listed on our{' '}
          <a href="/subprocessors" className="text-accent hover:underline">
            Subprocessors
          </a>{' '}
          page. The Processor will impose data protection obligations on Subprocessors substantially
          similar to this DPA.
        </p>
        <p>
          The Processor will provide 30 days&apos; notice of new Subprocessors. The Controller may
          object on reasonable data protection grounds within that period.
        </p>
      </section>

      <section>
        <h2>5. International transfers</h2>
        <p>
          Where personal data is transferred from the EEA, UK, or Switzerland to the United States
          or other countries without an adequacy decision, the parties agree that the EU Standard
          Contractual Clauses (Module Two: Controller to Processor) are incorporated by reference,
          with the Controller as data exporter and the Processor as data importer. Supplementary
          measures are described on our Trust page.
        </p>
      </section>

      <section>
        <h2>6. Audits</h2>
        <p>
          Upon reasonable written request, the Processor will provide summaries of relevant
          third-party security assessments or certifications, or allow the Controller to review
          audit reports subject to confidentiality. Onsite audits may be conducted no more than once
          per year with 30 days&apos; notice, during business hours, and at the Controller&apos;s
          expense, unless required by a supervisory authority.
        </p>
      </section>

      <section>
        <h2>7. Liability</h2>
        <p>
          Each party&apos;s liability under this DPA is subject to the limitations in the Terms of
          Service. Nothing in this DPA limits either party&apos;s liability to data subjects where
          prohibited by applicable law.
        </p>
      </section>

      <section>
        <h2>8. Acceptance</h2>
        <p>
          This DPA is accepted when the Controller signs up for or continues to use the Service
          after this page is published. Enterprise customers may request a separately executed
          version by contacting{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section>
        <h2>9. Contact</h2>
        <p>
          Data protection inquiries:{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
        </p>
      </section>
    </LegalPageLayout>
  )
}
