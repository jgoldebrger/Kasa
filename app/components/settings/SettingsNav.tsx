'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  EnvelopeIcon,
  CalendarIcon,
  CreditCardIcon,
  UserGroupIcon,
  PhotoIcon,
  TagIcon,
  GlobeAltIcon,
  IdentificationIcon,
  ClockIcon,
  TrashIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { Input } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

export type SettingsTabId =
  | 'email'
  | 'eventTypes'
  | 'paymentPlans'
  | 'automation'
  | 'kevittel'
  | 'cycle'
  | 'branding'
  | 'letterhead'
  | 'labels'
  | 'localization'
  | 'activity'
  | 'members'
  | 'billing'
  | 'trash'

interface NavItem {
  id: SettingsTabId
  labelKey: MessageKey
  icon: ReactNode
  privileged?: boolean
  keywords?: string
}

interface NavSection {
  id: string
  titleKey: MessageKey
  items: NavItem[]
}

const ALL_SECTIONS: NavSection[] = [
  {
    id: 'organization',
    titleKey: 'settings.organization',
    items: [
      {
        id: 'email',
        labelKey: 'settings.email',
        icon: <EnvelopeIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'smtp gmail configuration',
      },
      {
        id: 'branding',
        labelKey: 'settings.branding',
        icon: <PhotoIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'logo colors',
      },
      {
        id: 'members',
        labelKey: 'settings.nav.members',
        icon: <UserGroupIcon className="h-4 w-4" aria-hidden="true" />,
        privileged: true,
        keywords: 'invite users roles',
      },
      {
        id: 'localization',
        labelKey: 'settings.localization',
        icon: <GlobeAltIcon className="h-4 w-4" aria-hidden="true" />,
        privileged: true,
        keywords: 'currency locale language',
      },
    ],
  },
  {
    id: 'finance',
    titleKey: 'settings.nav.section.finance',
    items: [
      {
        id: 'paymentPlans',
        labelKey: 'settings.nav.paymentPlans',
        icon: <CreditCardIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'plans dues pricing',
      },
      {
        id: 'eventTypes',
        labelKey: 'settings.eventTypes',
        icon: <CalendarIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'lifecycle events amounts',
      },
      {
        id: 'cycle',
        labelKey: 'settings.cycle',
        icon: <CalendarIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'hebrew year billing period',
      },
      {
        id: 'billing',
        labelKey: 'settings.nav.billing',
        icon: <CreditCardIcon className="h-4 w-4" aria-hidden="true" />,
        privileged: true,
        keywords: 'subscription stripe',
      },
    ],
  },
  {
    id: 'communications',
    titleKey: 'settings.nav.section.communications',
    items: [
      {
        id: 'letterhead',
        labelKey: 'settings.nav.letterhead',
        icon: <IdentificationIcon className="h-4 w-4" aria-hidden="true" />,
        privileged: true,
        keywords: 'statements receipts address',
      },
      {
        id: 'labels',
        labelKey: 'settings.nav.labels',
        icon: <TagIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'print labels envelopes',
      },
      {
        id: 'kevittel',
        labelKey: 'settings.nav.kevittel',
        icon: <UserGroupIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'print hebrew families',
      },
    ],
  },
  {
    id: 'automation',
    titleKey: 'settings.nav.section.automation',
    items: [
      {
        id: 'automation',
        labelKey: 'settings.nav.rules',
        icon: <Cog6ToothIcon className="h-4 w-4" aria-hidden="true" />,
        keywords: 'auto send statements monthly',
      },
    ],
  },
  {
    id: 'admin',
    titleKey: 'settings.nav.section.admin',
    items: [
      {
        id: 'activity',
        labelKey: 'settings.nav.activity',
        icon: <ClockIcon className="h-4 w-4" aria-hidden="true" />,
        privileged: true,
        keywords: 'audit log history',
      },
      {
        id: 'trash',
        labelKey: 'settings.nav.trash',
        icon: <TrashIcon className="h-4 w-4" aria-hidden="true" />,
        privileged: true,
        keywords: 'deleted restore purge',
      },
    ],
  },
]

export interface SettingsNavProps {
  activeId: SettingsTabId
  onChange: (id: SettingsTabId) => void
  canSeePrivilegedTabs: boolean
}

function matchesQuery(
  item: NavItem,
  sectionTitle: string,
  query: string,
  t: (key: MessageKey) => string,
): boolean {
  const haystack = [t(item.labelKey), item.keywords ?? '', sectionTitle].join(' ').toLowerCase()
  return haystack.includes(query)
}

export default function SettingsNav({
  activeId,
  onChange,
  canSeePrivilegedTabs,
}: SettingsNavProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const sections = useMemo(() => {
    return ALL_SECTIONS.map((section) => {
      const title = t(section.titleKey)
      return {
        id: section.id,
        title,
        items: section.items
          .filter((item) => {
            if (item.privileged && !canSeePrivilegedTabs) return false
            if (!normalizedQuery) return true
            return matchesQuery(item, title, normalizedQuery, t) || item.id === activeId
          })
          .map((item) => ({
            ...item,
            label: t(item.labelKey),
          })),
      }
    }).filter((section) => section.items.length > 0)
  }, [activeId, canSeePrivilegedTabs, normalizedQuery, t])

  return (
    <nav aria-label={t('settings.nav.ariaLabel')} className="surface-card p-3 sm:p-4">
      <div className="mb-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.nav.searchPlaceholder')}
          aria-label={t('settings.nav.filterAriaLabel')}
          leftIcon={<MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />}
          className="text-sm"
        />
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.id}>
            <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-fg-muted mb-1">
              {section.title}
            </h2>
            <ul className="space-y-0.5" role="list">
              {section.items.map((item) => {
                const selected = item.id === activeId
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onChange(item.id)}
                      aria-current={selected ? 'page' : undefined}
                      className={`focus-ring w-full inline-flex items-center gap-2 rounded-md px-2.5 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 text-sm text-start transition-colors ${
                        selected
                          ? 'bg-accent/10 text-accent font-semibold'
                          : 'text-fg-muted font-medium hover:bg-fg/5 hover:text-fg'
                      }`}
                    >
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}

        {sections.length === 0 && (
          <p className="px-2 py-4 text-sm text-fg-muted text-center">
            {t('settings.nav.noResults')}
          </p>
        )}
      </div>
    </nav>
  )
}
