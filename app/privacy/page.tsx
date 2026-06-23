import type { Metadata } from 'next'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'
import { SESSION_COOKIES } from '@/lib/legal/cookie-notice'
import {
  LEGAL_LAST_UPDATED,
  PRIVACY_CONTACT_EMAIL,
  SUPPORT_CONTACT_EMAIL,
} from '@/lib/legal/contacts'

export const metadata: Metadata = {
  title: 'Privacy Policy — Kasa',
  description: 'How Kasa collects, uses, and protects personal information.',
}

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LEGAL_LAST_UPDATED}>
      <section>
        <h2>1. Introduction</h2>
        <p>
          This Privacy Policy describes how Kasa (&quot;we,&quot; &quot;us,&quot; or
          &quot;our&quot;) processes personal information when you use our family membership
          management platform (the &quot;Service&quot;). This policy applies to account holders,
          organization administrators, and individuals whose information organizations enter into
          Kasa (such as family members).
        </p>
        <p>
          When an organization uses Kasa, that organization is the controller of member and family
          data it enters. Kasa acts as a processor on the organization&apos;s instructions, as
          further described in our{' '}
          <a href="/dpa" className="text-accent hover:underline">
            Data Processing Addendum
          </a>
          .
        </p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <p>Depending on how your organization uses Kasa, we may process:</p>
        <ul>
          <li>Account information (name, email address, password hash, two-factor settings)</li>
          <li>Organization and family membership records entered by your administrators</li>
          <li>Payment and billing data processed through Stripe</li>
          <li>Usage, audit, and security logs (IP address, user agent, action timestamps)</li>
          <li>Communications sent through the Service (e.g., statements and receipts)</li>
        </ul>
      </section>

      <section>
        <h2>3. How we use information and lawful bases</h2>
        <p>We use personal information to:</p>
        <ul>
          <li>Provide, secure, and improve the Service</li>
          <li>Authenticate users and enforce role-based access controls</li>
          <li>Process platform subscriptions and member payments</li>
          <li>Generate financial statements and tax receipts on your organization&apos;s behalf</li>
          <li>Respond to support requests and comply with legal obligations</li>
        </ul>
        <p>Our lawful bases for processing (where GDPR applies) include:</p>
        <ul>
          <li>
            <strong>Contract</strong> — to provide the Service you or your organization requested
          </li>
          <li>
            <strong>Legitimate interests</strong> — to secure the Service, prevent fraud, and
            improve reliability, balanced against your rights
          </li>
          <li>
            <strong>Legal obligation</strong> — where we must retain or disclose data by law
          </li>
          <li>
            <strong>Consent</strong> — where required for optional features; you may withdraw
            consent without affecting lawfulness of prior processing
          </li>
        </ul>
        <p>
          For California residents, we do not sell personal information and do not use it for
          cross-context behavioral advertising.
        </p>
      </section>

      <section>
        <h2>4. Cookies and similar technologies</h2>
        <p>
          Kasa uses strictly necessary cookies to operate the Service. We do not use advertising or
          cross-site tracking cookies.
        </p>
        <ul>
          {SESSION_COOKIES.map((cookie) => (
            <li key={cookie.name}>
              <strong>{cookie.name}</strong> — {cookie.purpose} Retention: {cookie.duration}.
            </li>
          ))}
        </ul>
        <p>
          If we introduce optional analytics cookies in the future, we will update this policy and
          request consent where required.
        </p>
      </section>

      <section>
        <h2>5. Sharing and subprocessors</h2>
        <p>
          We share personal information with service providers that help us operate the Service. A
          current list is available on our{' '}
          <a href="/subprocessors" className="text-accent hover:underline">
            Subprocessors
          </a>{' '}
          page. We require subprocessors to protect personal information under written agreements.
        </p>
        <p>
          <strong>International transfers.</strong> We primarily process data in the United States.
          Where personal information is transferred from the EEA, UK, or Switzerland, we rely on
          appropriate safeguards such as Standard Contractual Clauses incorporated in our DPA.
        </p>
        <p>
          <strong>Law enforcement.</strong> We may disclose information when required by law, court
          order, or to protect the rights, property, or safety of Kasa, our customers, or others. We
          will notify organizations where legally permitted before disclosure.
        </p>
        <p>
          <strong>Business transfers.</strong> If we are involved in a merger, acquisition, or sale
          of assets, personal information may be transferred as part of that transaction. We will
          notify affected organizations before personal information becomes subject to a different
          privacy policy.
        </p>
      </section>

      <section>
        <h2>6. Data retention and security</h2>
        <p>
          We retain personal information for as long as needed to provide the Service and fulfill
          the purposes described in this policy. Deleted records may remain in backups for up to 30
          days. Organization owners can export data at any time from Settings → Data export.
        </p>
        <p>
          We implement technical and organizational measures designed to protect personal
          information, including encryption of secrets at rest (AES-256-GCM), TLS in transit,
          role-based access controls, audit logging, and regular security testing.
        </p>
      </section>

      <section>
        <h2>7. Your rights</h2>
        <p>
          Depending on your jurisdiction, you may have rights to access, correct, delete, or port
          your personal information, or to object to or restrict certain processing.
        </p>
        <ul>
          <li>
            <strong>Account holders</strong> — update profile information in Account settings;
            enable two-factor authentication; request account deletion via{' '}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </li>
          <li>
            <strong>Organization members and families</strong> — contact your kehilla administrator
            first, as they control the data. Administrators can export or correct records in Kasa,
            or contact us to assist with data subject requests
          </li>
          <li>
            <strong>EEA/UK residents</strong> — you may lodge a complaint with your local
            supervisory authority. We will respond to verified requests within 30 days
          </li>
        </ul>
        <p>
          To exercise rights, email{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          . We may need to verify your identity before fulfilling a request.
        </p>
      </section>

      <section>
        <h2>8. Children</h2>
        <p>
          The Service is not directed at children under 13. Organizations may store information
          about minors as part of family membership records under their own policies and consents.
          If you believe we have collected personal information from a child without appropriate
          authorization, contact us at{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section>
        <h2>9. Contact</h2>
        <p>
          For privacy-related questions:{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          . General support:{' '}
          <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {SUPPORT_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalPageLayout>
  )
}
