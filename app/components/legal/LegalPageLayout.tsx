import Link from 'next/link'
import type { ReactNode } from 'react'
import LegalFooterLinks from './LegalFooterLinks'

interface LegalPageLayoutProps {
  title: string
  lastUpdated: string
  children: ReactNode
  /** When true, shows a counsel-review notice (legacy template mode). */
  showTemplateNotice?: boolean
}

/**
 * Shared shell for public legal / compliance pages.
 */
export default function LegalPageLayout({
  title,
  lastUpdated,
  children,
  showTemplateNotice = false,
}: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-app">
      <div className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <header className="mb-8">
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
            <span className="text-lg font-semibold text-fg">Kasa</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-fg mb-2">{title}</h1>
          <p className="text-sm text-fg-muted">Last updated: {lastUpdated}</p>
        </header>

        {showTemplateNotice && (
          <div
            role="note"
            className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-fg"
          >
            <strong className="font-semibold">Draft — requires legal review.</strong> The text below
            must be reviewed by qualified counsel before external publication.
          </div>
        )}

        <article className="space-y-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h2]:mb-3 [&_p]:text-sm [&_p]:text-fg-muted [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-sm [&_ul]:text-fg-muted [&_ul]:space-y-1 [&_li]:leading-relaxed">
          {children}
        </article>

        <footer className="mt-16 pt-8 border-t border-border text-center text-sm text-fg-muted space-y-3">
          <LegalFooterLinks />
          <p>&copy; {new Date().getFullYear()} Kasa</p>
        </footer>
      </div>
    </div>
  )
}
