'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

const LINKS = [
  { href: '/payments', labelKey: 'payments.nav.all' },
  { href: '/payments/disputes', labelKey: 'payments.nav.disputes' },
] as const

export default function PaymentsNav() {
  const pathname = usePathname()
  const t = useT()

  return (
    <div className="flex flex-wrap gap-2 border-b border-border mb-6">
      {LINKS.map((link) => {
        const isActive =
          link.href === '/payments' ? pathname === '/payments' : pathname?.startsWith(link.href)
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
            {t(link.labelKey as MessageKey)}
          </Link>
        )
      })}
    </div>
  )
}
