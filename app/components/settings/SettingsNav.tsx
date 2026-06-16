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
  label: string
  icon: ReactNode
  privileged?: boolean
  keywords?: string
}

interface NavSection {
  id: string
  title: string
  items: NavItem[]
}

const ALL_SECTIONS: NavSection[] = [
  {
    id: 'organization',
    title: 'Organization',
    items: [
      { id: 'email', label: 'Email', icon: <EnvelopeIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'smtp gmail configuration' },
      { id: 'branding', label: 'Branding', icon: <PhotoIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'logo colors' },
      { id: 'members', label: 'Members', icon: <UserGroupIcon className="h-4 w-4" aria-hidden="true" />, privileged: true, keywords: 'invite users roles' },
      { id: 'localization', label: 'Localization', icon: <GlobeAltIcon className="h-4 w-4" aria-hidden="true" />, privileged: true, keywords: 'currency locale language' },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    items: [
      { id: 'paymentPlans', label: 'Payment Plans', icon: <CreditCardIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'plans dues pricing' },
      { id: 'eventTypes', label: 'Event Types', icon: <CalendarIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'lifecycle events amounts' },
      { id: 'cycle', label: 'Cycle', icon: <CalendarIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'hebrew year billing period' },
      { id: 'billing', label: 'Billing', icon: <CreditCardIcon className="h-4 w-4" aria-hidden="true" />, privileged: true, keywords: 'subscription stripe' },
    ],
  },
  {
    id: 'communications',
    title: 'Communications',
    items: [
      { id: 'letterhead', label: 'Letterhead', icon: <IdentificationIcon className="h-4 w-4" aria-hidden="true" />, privileged: true, keywords: 'statements receipts address' },
      { id: 'labels', label: 'Mail Labels', icon: <TagIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'print labels envelopes' },
      { id: 'kevittel', label: 'Kevittel', icon: <UserGroupIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'print hebrew families' },
    ],
  },
  {
    id: 'automation',
    title: 'Automation',
    items: [
      { id: 'automation', label: 'Rules', icon: <Cog6ToothIcon className="h-4 w-4" aria-hidden="true" />, keywords: 'auto send statements monthly' },
    ],
  },
  {
    id: 'admin',
    title: 'Admin',
    items: [
      { id: 'activity', label: 'Activity', icon: <ClockIcon className="h-4 w-4" aria-hidden="true" />, privileged: true, keywords: 'audit log history' },
      { id: 'trash', label: 'Recycle bin', icon: <TrashIcon className="h-4 w-4" aria-hidden="true" />, privileged: true, keywords: 'deleted restore purge' },
    ],
  },
]

export interface SettingsNavProps {
  activeId: SettingsTabId
  onChange: (id: SettingsTabId) => void
  canSeePrivilegedTabs: boolean
}

function matchesQuery(item: NavItem, sectionTitle: string, query: string): boolean {
  const haystack = [item.label, item.keywords ?? '', sectionTitle].join(' ').toLowerCase()
  return haystack.includes(query)
}

export default function SettingsNav({ activeId, onChange, canSeePrivilegedTabs }: SettingsNavProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const sections = useMemo(() => {
    return ALL_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.privileged && !canSeePrivilegedTabs) return false
        if (!normalizedQuery) return true
        return matchesQuery(item, section.title, normalizedQuery) || item.id === activeId
      }),
    })).filter((section) => section.items.length > 0)
  }, [activeId, canSeePrivilegedTabs, normalizedQuery])

  return (
    <nav aria-label="Settings sections" className="surface-card p-3 sm:p-4">
      <div className="mb-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to find a setting"
          aria-label="Filter settings"
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
          <p className="px-2 py-4 text-sm text-fg-muted text-center">No settings match your search.</p>
        )}
      </div>
    </nav>
  )
}
