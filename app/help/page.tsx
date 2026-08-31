import type { Metadata } from 'next'
import Link from 'next/link'
import JsonLd from '@/app/components/seo/JsonLd'
import LegalFooterLinks from '@/app/components/legal/LegalFooterLinks'
import { resolveAppBaseUrl } from '@/lib/app-base-url'
import { HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/help/articles'
import { SUPPORT_CONTACT_EMAIL } from '@/lib/legal/contacts'
import {
  faqPageJsonLd,
  helpHubFaqItems,
  organizationJsonLd,
  webPageJsonLd,
} from '@/lib/seo/json-ld'
import { publicPageMetadata } from '@/lib/seo/metadata'

const TITLE = 'Treasurer Help Center — Kasa'
const DESCRIPTION =
  'How kehilla treasurers set up Kasa: payment plans, CSV import, statements, Stripe, and Hebrew-calendar billing.'

export const metadata: Metadata = publicPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/help',
})

export default function HelpCenterPage() {
  const baseUrl = resolveAppBaseUrl()
  const faqItems = helpHubFaqItems()
  return (
    <div className="min-h-screen bg-app">
      <JsonLd data={organizationJsonLd(baseUrl)} />
      <JsonLd
        data={webPageJsonLd({
          baseUrl,
          path: '/help',
          name: TITLE,
          description: DESCRIPTION,
        })}
      />
      <JsonLd data={faqPageJsonLd(faqItems)} />
      <div className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <header className="mb-10">
          <Link
            href="/welcome"
            className="focus-ring inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg mb-6"
          >
            ← Back to Kasa
          </Link>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold text-sm">
              K
            </div>
            <span className="text-lg font-semibold text-fg">Kasa Help Center</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-fg mb-2">
            Guides for kehilla treasurers
          </h1>
          <p className="text-sm text-fg-muted">
            Step-by-step guides for dues, statements, family import, and Hebrew-calendar billing.
          </p>
        </header>

        <div className="space-y-10">
          {HELP_CATEGORIES.map((cat) => {
            const articles = HELP_ARTICLES.filter((a) => a.category === cat.id)
            if (articles.length === 0) return null
            return (
              <section key={cat.id}>
                <h2 className="text-lg font-semibold text-fg mb-3">{cat.label}</h2>
                <ul className="space-y-2">
                  {articles.map((article) => (
                    <li key={article.slug}>
                      <Link
                        href={`/help/${article.slug}`}
                        className="focus-ring block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent/40 transition-colors"
                      >
                        <span className="font-medium text-fg">{article.title}</span>
                        <p className="text-sm text-fg-muted mt-0.5">{article.summary}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>

        <section className="mt-12">
          <h2 className="text-lg font-semibold text-fg mb-3">Frequently asked</h2>
          <dl className="space-y-4">
            {faqItems.map((item) => (
              <div
                key={item.question}
                className="rounded-lg border border-border bg-surface px-4 py-3"
              >
                <dt className="font-medium text-fg">{item.question}</dt>
                <dd className="text-sm text-fg-muted mt-1">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12 rounded-lg border border-border bg-surface p-6">
          <h2 className="font-semibold text-fg mb-2">Still need help?</h2>
          <p className="text-sm text-fg-muted">
            Email{' '}
            <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-accent hover:underline">
              {SUPPORT_CONTACT_EMAIL}
            </a>{' '}
            or review our{' '}
            <Link href="/trust" className="text-accent hover:underline">
              Trust &amp; Security
            </Link>{' '}
            page for compliance questions.
          </p>
        </section>

        <footer className="mt-16 pt-8 border-t border-border text-center text-sm text-fg-muted space-y-3">
          <LegalFooterLinks />
          <p>&copy; {new Date().getFullYear()} Kasa</p>
        </footer>
      </div>
    </div>
  )
}
