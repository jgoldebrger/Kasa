'use client'

import { usePathname } from 'next/navigation'
import { TabNav } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

const LINKS = [
  { id: 'all', href: '/payments', labelKey: 'payments.nav.all' },
  { id: 'disputes', href: '/payments/disputes', labelKey: 'payments.nav.disputes' },
] as const

export default function PaymentsNav() {
  const pathname = usePathname()
  const t = useT()

  const activeId =
    LINKS.find((link) =>
      link.href === '/payments' ? pathname === '/payments' : pathname?.startsWith(link.href),
    )?.id ?? 'all'

  return (
    <TabNav
      label={t('payments.title')}
      activeId={activeId}
      className="mb-6"
      items={LINKS.map((link) => ({
        id: link.id,
        href: link.href,
        label: t(link.labelKey as MessageKey),
      }))}
    />
  )
}
