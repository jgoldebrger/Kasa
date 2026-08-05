'use client'

import Link from 'next/link'
import { useId } from 'react'
import type { MessageKey } from '@/lib/i18n/load-locale'
import {
  FAMILY_TAB_GROUPS,
  FAMILY_TABS,
  familyTabHref,
  filterVisibleFamilyTabs,
  groupVisibleFamilyTabs,
  resolveFamilyTabLabel,
  type FamilyTabId,
} from './index'

export interface FamilyClusteredTabNavProps {
  familyId: string
  activeTab: FamilyTabId
  isAdmin: boolean
  memberFinancialAccess: boolean
  t: (key: MessageKey, fallback?: string) => string
  /** Accessible name for the navigation landmark. */
  label?: string
  className?: string
}

export function FamilyClusteredTabNav({
  familyId,
  activeTab,
  isAdmin,
  memberFinancialAccess,
  t,
  label = 'Family sections',
  className = '',
}: FamilyClusteredTabNavProps) {
  const groupId = useId()
  const visibleTabs = filterVisibleFamilyTabs(FAMILY_TABS, { isAdmin, memberFinancialAccess })
  const groupedTabs = groupVisibleFamilyTabs(visibleTabs)

  return (
    <nav
      aria-label={label}
      className={`-mx-2 overflow-x-auto border-b border-border px-2 sm:mx-0 sm:px-0 ${className}`}
      style={{ scrollbarWidth: 'thin' }}
    >
      <div className="flex min-w-max items-end gap-1">
        {groupedTabs.map((group, groupIndex) => {
          const groupDef = FAMILY_TAB_GROUPS.find((entry) => entry.id === group.group)
          const groupLabel = groupDef ? t(groupDef.labelKey, group.group) : group.group

          return (
            <div key={group.group} className="flex items-end">
              {groupIndex > 0 && (
                <span
                  aria-hidden="true"
                  className="mx-1 mb-2.5 inline-block h-6 w-px shrink-0 self-center bg-border"
                />
              )}
              <div className="flex flex-col">
                <span className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  {groupLabel}
                </span>
                <div className="flex gap-1">
                  {group.tabs.map((tab) => {
                    const selected = tab.id === activeTab
                    return (
                      <Link
                        key={tab.id}
                        id={`${groupId}-tab-${tab.id}`}
                        href={familyTabHref(familyId, tab.id)}
                        aria-current={selected ? 'page' : undefined}
                        className={`focus-ring relative -mb-px inline-flex min-h-[var(--touch-target)] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:min-h-0 ${
                          selected
                            ? 'border-accent text-fg'
                            : 'border-transparent text-fg-muted hover:border-border-strong hover:text-fg'
                        }`}
                      >
                        {resolveFamilyTabLabel(tab, t)}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
