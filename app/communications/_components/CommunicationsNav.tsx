'use client'

import { usePathname } from 'next/navigation'
import { TabNav } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

const LINKS = [
  {
    id: 'main',
    href: '/communications',
    labelKey: 'communications.nav.main',
    fallback: 'Send & log',
  },
  {
    id: 'templates',
    href: '/communications/templates',
    labelKey: 'communications.nav.templates',
    fallback: 'Templates',
  },
  {
    id: 'scheduled',
    href: '/communications/scheduled',
    labelKey: 'communications.nav.scheduled',
    fallback: 'Scheduled',
  },
  {
    id: 'jobs',
    href: '/communications/jobs',
    labelKey: 'communications.nav.jobs',
    fallback: 'Job history',
  },
  {
    id: 'analytics',
    href: '/communications/analytics',
    labelKey: 'communications.nav.analytics',
    fallback: 'Analytics',
  },
  {
    id: 'automations',
    href: '/communications/automations',
    labelKey: 'communications.nav.automations',
    fallback: 'Automations',
  },
] as const

export default function CommunicationsNav() {
  const pathname = usePathname()
  const t = useT()

  const activeId =
    LINKS.find((link) =>
      link.href === '/communications'
        ? pathname === '/communications'
        : pathname?.startsWith(link.href),
    )?.id ?? 'main'

  return (
    <TabNav
      label={t('communications.title')}
      activeId={activeId}
      items={LINKS.map((link) => ({
        id: link.id,
        href: link.href,
        label: t(link.labelKey as MessageKey, link.fallback),
      }))}
    />
  )
}
