import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'
import { LEGAL_LAST_UPDATED, PRIVACY_CONTACT_EMAIL } from '@/lib/legal/contacts'
import { SUBPROCESSORS } from '@/lib/legal/subprocessors'

export const metadata: Metadata = {
  title: 'Trust & Security — Kasa',
  description: 'Security practices, data handling, and incident response for Kasa.',
}

const SECURITY_CONTROLS = [
  {
    category: 'Access control',
    items: [
      'Role-based access (owner, admin, member) enforced on every API route',
      'Multi-tenant data isolation via organization-scoped queries',
      'Optional TOTP two-factor authentication for all users',
      'Platform admin access requires 2FA',
    ],
  },
  {
    category: 'Data protection',
    items: [
      'TLS encryption for data in transit',
      'AES-256-GCM encryption for SMTP credentials and 2FA secrets at rest',
      'Password hashing with bcrypt',
      'Audit log with email redaction in metadata',
    ],
  },
  {
    category: 'Application security',
    items: [
      'CSRF protection on mutating API requests',
      'Content Security Policy with nonces in production',
      'Rate limiting on authentication and sensitive endpoints',
      'Automated security test suite (RBAC matrix, tenant isolation, IDOR checks)',
    ],
  },
  {
    category: 'Operations',
    items: [
      'Hosted on Vercel (US East — iad1) with MongoDB Atlas (US)',
      'Structured logging and Sentry error monitoring with payload scrubbing',
      'Health endpoint for uptime monitoring',
      'Documented runbooks for deploy, rollback, and incident response',
    ],
  },
] as const

export default function TrustPage() {
  return (
    <LegalPageLayout title="Trust & Security" lastUpdated={LEGAL_LAST_UPDATED}>
      <section>
        <h2>Our commitment</h2>
        <p>
          Kasa is built for kehillos that entrust us with sensitive membership and financial data.
          We design for security from the ground up: tenant isolation, encryption, auditability, and
          continuous automated testing. This page summarizes our practices for treasurers, boards,
          and IT reviewers.
        </p>
      </section>

      <section>
        <h2>Security controls</h2>
        <div className="space-y-6">
          {SECURITY_CONTROLS.map((group) => (
            <div key={group.category}>
              <h3 className="text-base font-semibold text-fg mb-2">{group.category}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Data residency</h2>
        <p>
          Production data is processed and stored in the United States. Application servers run in
          Vercel&apos;s <code className="font-mono text-xs">iad1</code> region (Washington, D.C.
          area). Database hosting is on MongoDB Atlas in AWS{' '}
          <code className="font-mono text-xs">us-east-1</code>. Organizations with data residency
          requirements should contact us before subscribing.
        </p>
      </section>

      <section>
        <h2>Subprocessors</h2>
        <p>
          We use the following third-party providers to deliver the Service. See our{' '}
          <Link href="/subprocessors" className="text-accent hover:underline">
            Subprocessors
          </Link>{' '}
          page for the authoritative list and change-notification policy.
        </p>
        <ul>
          {SUBPROCESSORS.map((sp) => (
            <li key={sp.name}>
              <strong>{sp.name}</strong> — {sp.purpose} ({sp.location})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Compliance resources</h2>
        <ul>
          <li>
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>{' '}
            — how we collect and use personal information
          </li>
          <li>
            <Link href="/dpa" className="text-accent hover:underline">
              Data Processing Addendum
            </Link>{' '}
            — processor terms for GDPR/UK GDPR customers
          </li>
          <li>
            <Link href="/terms" className="text-accent hover:underline">
              Terms of Service
            </Link>{' '}
            — subscription and acceptable use
          </li>
        </ul>
        <p>
          Kasa is not currently SOC 2 certified. We maintain internal security controls and
          automated testing aligned with common SaaS expectations. Enterprise customers may request
          a security questionnaire review.
        </p>
      </section>

      <section>
        <h2>Incident response</h2>
        <p>If we become aware of a security incident affecting customer data, we will:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Contain and investigate the incident promptly</li>
          <li>
            Notify affected organization owners without undue delay when personal data is likely
            compromised
          </li>
          <li>Provide a summary of impact, affected data categories, and remediation steps</li>
          <li>Cooperate with customer incident response and regulatory obligations</li>
        </ol>
        <p>
          Report suspected vulnerabilities to{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          . Please include steps to reproduce and avoid public disclosure until we acknowledge
          receipt.
        </p>
      </section>

      <section>
        <h2>Data export and offboarding</h2>
        <p>
          Organization owners can export all workspace data at any time from{' '}
          <strong>Settings → Data export</strong>. Exports include families, members, payments,
          statements, and configuration in JSON format. Upon subscription cancellation, data is
          retained for 30 days in the recycle bin before permanent deletion, unless a longer period
          is required by law.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Security and privacy inquiries:{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
        </p>
      </section>
    </LegalPageLayout>
  )
}
