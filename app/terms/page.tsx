import type { Metadata } from 'next'
import LegalPageLayout from '@/app/components/legal/LegalPageLayout'

export const metadata: Metadata = {
  title: 'Terms of Service — Kasa',
  description: 'Terms governing use of the Kasa family membership management platform.',
}

const LAST_UPDATED = 'June 9, 2026'

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <section>
        <h2>1. Agreement</h2>
        <p>
          These Terms of Service (&quot;Terms&quot;) govern access to and use of the Kasa
          platform (the &quot;Service&quot;) provided by Kasa (&quot;we,&quot; &quot;us,&quot;
          or &quot;our&quot;). By using the Service, you agree to these Terms. This document
          is a <strong>template</strong> and must be reviewed by qualified legal counsel
          before external publication.
        </p>
      </section>

      <section>
        <h2>2. Eligibility and accounts</h2>
        <p>
          The Service is offered on an invitation-only basis during early access. You must
          provide accurate account information and keep your credentials secure. You are
          responsible for activity under your account.
        </p>
        <p>
          <strong>[TEMPLATE]</strong> Add minimum age requirements and organization
          administrator responsibilities.
        </p>
      </section>

      <section>
        <h2>3. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service in violation of applicable law</li>
          <li>Attempt to gain unauthorized access to the Service or other accounts</li>
          <li>Interfere with or disrupt the integrity or performance of the Service</li>
          <li>Upload malicious code or misuse payment features</li>
        </ul>
      </section>

      <section>
        <h2>4. Customer data</h2>
        <p>
          Your organization retains ownership of the data you submit to the Service
          (&quot;Customer Data&quot;). You grant us a limited license to host, process, and
          display Customer Data solely to provide and improve the Service.
        </p>
        <p>
          <strong>[TEMPLATE]</strong> Add data-processing terms, subprocessors reference, and
          any Business Associate or GDPR processor language if applicable.
        </p>
      </section>

      <section>
        <h2>5. Fees and payment</h2>
        <p>
          <strong>[TEMPLATE]</strong> Describe subscription plans, billing cycles, taxes,
          refunds, and payment-provider terms (e.g., Stripe). Organizations are responsible
          for charges they authorize through the Service.
        </p>
      </section>

      <section>
        <h2>6. Intellectual property</h2>
        <p>
          We and our licensors own the Service, including software, branding, and
          documentation. These Terms do not grant you any rights to our trademarks or
          proprietary technology except as needed to use the Service.
        </p>
      </section>

      <section>
        <h2>7. Disclaimers and limitation of liability</h2>
        <p>
          <strong>[TEMPLATE]</strong> THE SERVICE IS PROVIDED &quot;AS IS&quot; TO THE MAXIMUM
          EXTENT PERMITTED BY LAW. ADD DISCLAIMERS AND LIABILITY CAPS APPROPRIATE FOR YOUR
          JURISDICTION AND BUSINESS MODEL.
        </p>
      </section>

      <section>
        <h2>8. Termination</h2>
        <p>
          Either party may terminate access as described in your order or organization
          agreement. Upon termination, your right to use the Service ends. Provisions that by
          their nature should survive termination will survive.
        </p>
      </section>

      <section>
        <h2>9. Changes</h2>
        <p>
          We may update these Terms from time to time. We will post the revised Terms with an
          updated &quot;Last updated&quot; date. Material changes should be communicated as
          required by law.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          <strong>[TEMPLATE]</strong> Questions about these Terms:{' '}
          <span className="font-mono text-fg">legal@example.com</span> (replace with your
          designated contact).
        </p>
      </section>
    </LegalPageLayout>
  )
}
