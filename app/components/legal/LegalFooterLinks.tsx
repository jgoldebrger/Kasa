import Link from 'next/link'

interface LegalFooterLinksProps {
  className?: string
  /** Render links inline (default) or stacked. */
  layout?: 'inline' | 'stacked'
}

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/subprocessors', label: 'Subprocessors' },
] as const

/**
 * Shared footer links to legal / compliance pages.
 */
export default function LegalFooterLinks({
  className = '',
  layout = 'inline',
}: LegalFooterLinksProps) {
  const linkClass =
    'focus-ring text-fg-muted hover:text-fg underline-offset-2 hover:underline transition-colors'

  if (layout === 'stacked') {
    return (
      <nav aria-label="Legal" className={`flex flex-col gap-1 ${className}`}>
        {LEGAL_LINKS.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass}>
            {item.label}
          </Link>
        ))}
      </nav>
    )
  }

  return (
    <nav
      aria-label="Legal"
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 ${className}`}
    >
      {LEGAL_LINKS.map((item, index) => (
        <span key={item.href} className="inline-flex items-center gap-3">
          {index > 0 && (
            <span className="text-fg-subtle select-none" aria-hidden="true">
              ·
            </span>
          )}
          <Link href={item.href} className={linkClass}>
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  )
}
