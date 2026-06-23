import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import LegalFooterLinks from '@/app/components/legal/LegalFooterLinks'
import { getHelpArticle, HELP_ARTICLES } from '@/lib/help/articles'
import { SUPPORT_CONTACT_EMAIL } from '@/lib/legal/contacts'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = getHelpArticle(slug)
  if (!article) return { title: 'Help — Kasa' }
  return {
    title: `${article.title} — Kasa Help`,
    description: article.summary,
  }
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params
  const article = getHelpArticle(slug)
  if (!article) notFound()

  return (
    <div className="min-h-screen bg-app">
      <div className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <header className="mb-8">
          <Link
            href="/help"
            className="focus-ring inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg mb-6"
          >
            ← Help Center
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-fg mb-2">{article.title}</h1>
          <p className="text-sm text-fg-muted">{article.summary}</p>
        </header>

        <article className="space-y-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h2]:mb-3 [&_p]:text-sm [&_p]:text-fg-muted [&_p]:leading-relaxed">
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </article>

        <section className="mt-12 rounded-lg border border-border bg-surface p-6">
          <p className="text-sm text-fg-muted">
            Questions? Contact{' '}
            <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-accent hover:underline">
              {SUPPORT_CONTACT_EMAIL}
            </a>
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
