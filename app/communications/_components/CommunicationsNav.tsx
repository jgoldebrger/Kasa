'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

const LINKS = [
  { href: '/communications', labelKey: 'communications.nav.main', fallback: 'Send & log' },
  {
    href: '/communications/templates',
    labelKey: 'communications.nav.templates',
    fallback: 'Templates',
  },
  {
    href: '/communications/scheduled',
    labelKey: 'communications.nav.scheduled',
    fallback: 'Scheduled',
  },
  {
    href: '/communications/jobs',
    labelKey: 'communications.nav.jobs',
    fallback: 'Job history',
  },
  {
    href: '/communications/analytics',
    labelKey: 'communications.nav.analytics',
    fallback: 'Analytics',
  },
] as const

export default function CommunicationsNav() {
  const pathname = usePathname()
  const t = useT()

  return (
    <div className="flex flex-wrap gap-2 border-b border-border">
      {LINKS.map((link) => {
        const isActive =
          link.href === '/communications'
            ? pathname === '/communications'
            : pathname?.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {t(link.labelKey as MessageKey, link.fallback)}
          </Link>
        )
      })}
    </div>
  )
}
