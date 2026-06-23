import type { Metadata } from 'next'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ENTITY_NAME,
  LEGAL_LAST_UPDATED,
  PRIVACY_CONTACT_EMAIL,
  SUPPORT_CONTACT_EMAIL,
} from '@/lib/legal/contacts'

export const metadata: Metadata = {
  title: 'Terms of Service — Kasa',
  description: 'Terms governing use of the Kasa family membership management platform.',
}

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated={LEGAL_LAST_UPDATED}>
      <section>
        <h2>1. Agreement</h2>
        <p>
          These Terms of Service (&quot;Terms&quot;) govern access to and use of the Kasa platform
          (the &quot;Service&quot;) provided by {LEGAL_ENTITY_NAME} (&quot;we,&quot; &quot;us,&quot;
          or &quot;our&quot;). By creating an account, accepting an invitation, or using the
          Service, you agree to these Terms on behalf of yourself and any organization you
          administer.
        </p>
        <p>
          If you use the Service on behalf of a kehilla, synagogue, or other organization, you
          represent that you have authority to bind that organization to these Terms.
        </p>
      </section>

      <section>
        <h2>2. Eligibility and accounts</h2>
        <p>
          The Service is offered on an invitation-only basis during early access. You must be at
          least 18 years old (or the age of majority in your jurisdiction) to create an account.
          Organization administrators must provide accurate account and billing information and are
          responsible for:
        </p>
        <ul>
          <li>Managing user invitations and role assignments within their organization</li>
          <li>Ensuring members comply with these Terms and applicable law</li>
          <li>
            Maintaining the security of credentials and enabling two-factor authentication where
            appropriate
          </li>
          <li>All activity conducted under accounts they provision</li>
        </ul>
        <p>
          You are responsible for activity under your account. Notify us promptly at{' '}
          <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {SUPPORT_CONTACT_EMAIL}
          </a>{' '}
          if you suspect unauthorized access.
        </p>
      </section>

      <section>
        <h2>3. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service in violation of applicable law or third-party rights</li>
          <li>Attempt to gain unauthorized access to the Service or other accounts</li>
          <li>Interfere with or disrupt the integrity or performance of the Service</li>
          <li>
            Upload malicious code, scrape the Service without permission, or misuse payment features
          </li>
          <li>Process cardholder data outside the payment flows we provide</li>
        </ul>
      </section>

      <section>
        <h2>4. Customer data</h2>
        <p>
          Your organization retains ownership of the data you submit to the Service (&quot;Customer
          Data&quot;), including family records, payment history, and communications. You grant us a
          limited license to host, process, back up, and display Customer Data solely to provide,
          secure, and improve the Service.
        </p>
        <p>
          We act as a data processor with respect to personal information your organization enters
          about members and families. Our processing is governed by these Terms and, where
          applicable, our{' '}
          <a href="/dpa" className="text-accent hover:underline">
            Data Processing Addendum
          </a>
          . A current list of subprocessors is published on our{' '}
          <a href="/subprocessors" className="text-accent hover:underline">
            Subprocessors
          </a>{' '}
          page.
        </p>
        <p>
          You are responsible for obtaining any consents required to collect and process personal
          information about your members and for the accuracy of Customer Data you submit.
        </p>
      </section>

      <section>
        <h2>5. Fees and payment</h2>
        <p>
          Access to the Service requires a paid platform subscription unless we agree otherwise in
          writing. Current plans (Starter, Community, and Institution) are described on our{' '}
          <a href="/pricing" className="text-accent hover:underline">
            Pricing
          </a>{' '}
          page. Subscriptions renew automatically each billing period until cancelled through the
          billing portal or by contacting support.
        </p>
        <ul>
          <li>Fees are quoted exclusive of applicable taxes unless stated otherwise</li>
          <li>
            Payment processing is handled by Stripe; their terms apply to payment transactions
          </li>
          <li>
            We may change plan pricing with at least 30 days&apos; notice before your next renewal
          </li>
          <li>Refunds are provided only where required by law or expressly stated in your order</li>
        </ul>
        <p>
          Organizations may also collect member dues through the Service. You authorize charges you
          initiate on behalf of families and are responsible for disputes with your members
          regarding those charges.
        </p>
      </section>

      <section>
        <h2>6. Intellectual property</h2>
        <p>
          We and our licensors own the Service, including software, branding, and documentation.
          These Terms do not grant you any rights to our trademarks or proprietary technology except
          as needed to use the Service. You may not reverse engineer, copy, or create derivative
          works of the Service except as permitted by law.
        </p>
      </section>

      <section>
        <h2>7. Disclaimers and limitation of liability</h2>
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; TO THE MAXIMUM
          EXTENT PERMITTED BY LAW. WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT
          THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT FINANCIAL CALCULATIONS WILL
          MEET YOUR SPECIFIC ACCOUNTING OR TAX REQUIREMENTS.
        </p>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY WILL BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, OR
          DATA. OUR TOTAL LIABILITY ARISING FROM OR RELATED TO THE SERVICE IN ANY TWELVE-MONTH
          PERIOD WILL NOT EXCEED THE GREATER OF (A) THE FEES YOU PAID US FOR THE SERVICE IN THAT
          PERIOD OR (B) ONE HUNDRED U.S. DOLLARS (US$100).
        </p>
        <p>
          Some jurisdictions do not allow certain limitations; in those cases our liability is
          limited to the fullest extent permitted by law.
        </p>
      </section>

      <section>
        <h2>8. Termination</h2>
        <p>
          You may cancel your subscription at any time through Settings → Billing or the Stripe
          customer portal. We may suspend or terminate access if you materially breach these Terms,
          fail to pay fees, or if required by law.
        </p>
        <p>
          Upon termination, your right to use the Service ends. Organization owners may export
          Customer Data before closure via Settings → Data export. We will delete or return Customer
          Data per our{' '}
          <a href="/privacy" className="text-accent hover:underline">
            Privacy Policy
          </a>{' '}
          and DPA, subject to legal retention requirements. Provisions that by their nature should
          survive termination will survive.
        </p>
      </section>

      <section>
        <h2>9. Changes</h2>
        <p>
          We may update these Terms from time to time. We will post the revised Terms with an
          updated &quot;Last updated&quot; date and, for material changes, notify organization
          owners by email or in-app notice at least 30 days before the change takes effect where
          required by law.
        </p>
      </section>

      <section>
        <h2>10. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of the State of New York, United States, without
          regard to conflict-of-law principles. Disputes will be resolved in the state or federal
          courts located in New York County, New York, and each party consents to personal
          jurisdiction there, except where prohibited by applicable consumer protection law.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Questions about these Terms:{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          . Privacy inquiries:{' '}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-accent hover:underline">
            {PRIVACY_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalPageLayout>
  )
}
