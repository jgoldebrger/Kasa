'use client'

import Link from 'next/link'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { useFamilyDetail } from './FamilyDetailContext'
import { FAMILY_TABS, familyTabHref, resolveFamilyTabLabel } from './_lib/constants'
import { useT } from '@/lib/client/i18n'

function BreadcrumbSeparator() {
  return (
    <li aria-hidden="true" className="flex shrink-0 items-center">
      <ChevronRightIcon className="h-3.5 w-3.5 rtl:rotate-180" />
    </li>
  )
}

export default function FamilyTabNav() {
  const { familyId, activeTab, isAdmin } = useFamilyDetail()
  const t = useT()

  const visibleTabs = FAMILY_TABS.filter((tab) => !tab.adminOnly || isAdmin)

  return (
    <div className="border-b border-border">
      <nav
        className="-mx-2 flex gap-1 overflow-x-auto px-2 sm:mx-0 sm:px-0"
        aria-label="Family sections"
      >
        {visibleTabs.map((tab) => {
          const href = familyTabHref(familyId, tab.id)
          const isActive = activeTab === tab.id
          return (
            <Link
              key={tab.id}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={`focus-ring relative inline-flex shrink-0 items-center whitespace-nowrap px-4 py-2.5 -mb-px text-sm font-medium transition-colors min-h-[var(--touch-target)] md:min-h-0 border-b-2 ${
                isActive
                  ? 'border-accent text-fg font-semibold'
                  : 'border-transparent text-fg-muted hover:text-fg hover:border-border-strong'
              }`}
            >
              {resolveFamilyTabLabel(tab, t)}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
