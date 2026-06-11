import type { Metadata } from 'next'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'
import { SESSION_COOKIES } from '@/lib/legal/cookie-notice'

export const metadata: Metadata = {
  title: 'Privacy Policy — Kasa',
  description: 'How Kasa collects, uses, and protects personal information.',
}

const LAST_UPDATED = 'June 9, 2026'

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <section>
        <h2>1. Introduction</h2>
        <p>
          This Privacy Policy describes how Kasa (&quot;we,&quot; &quot;us,&quot; or
          &quot;our&quot;) processes personal information when you use our family membership
          management platform (the &quot;Service&quot;). This document is a{' '}
          <strong>template</strong> and must be reviewed by qualified legal counsel before
          external publication.
        </p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <p>Depending on how your organization uses Kasa, we may process:</p>
        <ul>
          <li>Account information (name, email address, password hash)</li>
          <li>Organization and family membership records you or your admins enter</li>
          <li>Payment and billing data processed through our payment provider</li>
          <li>Usage, audit, and security logs</li>
          <li>Communications you send through the Service (e.g., statements)</li>
        </ul>
      </section>

      <section>
        <h2>3. How we use information</h2>
        <p>We use personal information to:</p>
        <ul>
          <li>Provide, secure, and improve the Service</li>
          <li>Authenticate users and enforce role-based access controls</li>
          <li>Process payments and generate financial statements on your behalf</li>
          <li>Respond to support requests and comply with legal obligations</li>
        </ul>
        <p>
          <strong>[TEMPLATE]</strong> Add lawful bases (e.g., contract, legitimate interests,
          consent) as required by applicable privacy laws (GDPR, CCPA, etc.).
        </p>
      </section>

      <section>
        <h2>4. Cookies and similar technologies</h2>
        <p>
          Kasa uses strictly necessary cookies to operate the Service. We do not use
          advertising or cross-site tracking cookies.
        </p>
        <ul>
          {SESSION_COOKIES.map((cookie) => (
            <li key={cookie.name}>
              <strong>{cookie.name}</strong> — {cookie.purpose} Retention: {cookie.duration}.
            </li>
          ))}
        </ul>
        <p>
          <strong>[TEMPLATE]</strong> Describe any additional analytics or third-party cookies
          if introduced in the future.
        </p>
      </section>

      <section>
        <h2>5. Sharing and subprocessors</h2>
        <p>
          We share personal information with service providers that help us operate the
          Service (e.g., hosting, email delivery, payment processing). A current list is
          available on our <a href="/subprocessors" className="text-accent hover:underline">Subprocessors</a> page.
        </p>
        <p>
          <strong>[TEMPLATE]</strong> Add sections on international transfers, law-enforcement
          requests, and business transfers as applicable.
        </p>
      </section>

      <section>
        <h2>6. Data retention and security</h2>
        <p>
          We retain personal information for as long as needed to provide the Service and
          fulfill the purposes described in this policy, unless a longer retention period is
          required by law. We implement technical and organizational measures designed to
          protect personal information, including encryption of secrets at rest and
          access controls.
        </p>
      </section>

      <section>
        <h2>7. Your rights</h2>
        <p>
          <strong>[TEMPLATE]</strong> Depending on your jurisdiction, you may have rights to
          access, correct, delete, or port your personal information, or to object to or
          restrict certain processing. Describe how users can exercise these rights and any
          appeal process.
        </p>
      </section>

      <section>
        <h2>8. Contact</h2>
        <p>
          <strong>[TEMPLATE]</strong> For privacy-related questions, contact:{' '}
          <span className="font-mono text-fg">privacy@example.com</span> (replace with your
          designated privacy contact).
        </p>
      </section>
    </LegalPageLayout>
  )
}
