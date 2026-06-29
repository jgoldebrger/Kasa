'use client'

import Link from 'next/link'
import {
  UserGroupIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useState } from 'react'
import { useT } from '@/lib/client/i18n'
import { useMemberOnboarding } from '@/lib/client/useMemberOnboarding'
import { openGlobalSearch } from '@/lib/client/open-global-search'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { familyTabHref } from '@/app/families/[id]/_lib/constants'

interface AssignedFamily {
  id: string
  name: string
}

export default function MemberWelcomeChecklist() {
  const t = useT()
  const { visitedFamilies, viewedFamily, viewedStatements } = useMemberOnboarding()
  const [assignedFamilies, setAssignedFamilies] = useState<AssignedFamily[]>([])

  const loadAssigned = async () => {
    try {
      const data = await cachedFetch<{ families?: AssignedFamily[] }>(
        '/api/member/assigned-families',
        { ttl: 30_000 },
      )
      setAssignedFamilies(Array.isArray(data.families) ? data.families : [])
    } catch {
      setAssignedFamilies([])
    }
  }

  useEffect(() => {
    void loadAssigned()
  }, [])

  useOrgChanged(() => {
    void loadAssigned()
  })

  const primaryFamily = assignedFamilies[0] ?? null
  const familyListHref = primaryFamily ? `/families/${primaryFamily.id}` : '/families'
  const membersHref = primaryFamily ? familyTabHref(primaryFamily.id, 'members') : '/families'
  const statementsHref = primaryFamily ? familyTabHref(primaryFamily.id, 'statements') : '/families'

  const familyNamesLabel =
    assignedFamilies.length === 0
      ? null
      : assignedFamilies.length === 1
        ? assignedFamilies[0].name
        : assignedFamilies.map((f) => f.name).join(', ')

  const steps = [
    {
      title: t('dashboard.member.browseFamilies'),
      href: familyListHref,
      done: visitedFamilies,
    },
    {
      title: t('dashboard.member.viewMembers'),
      href: membersHref,
      done: viewedFamily,
    },
    {
      title: t('dashboard.member.viewStatements'),
      href: statementsHref,
      done: viewedStatements,
    },
  ]

  return (
    <section
      className="mb-8 surface-card p-5 sm:p-6 animate-ui-fade"
      aria-labelledby="member-welcome-title"
    >
      <div className="flex items-start gap-3">
        <div
          className="inline-flex items-center justify-center h-10 w-10 rounded-md bg-accent/10 text-accent shrink-0"
          aria-hidden="true"
        >
          <UserGroupIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="member-welcome-title" className="text-base font-semibold text-fg">
            {t('dashboard.welcomeKasa')}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            {familyNamesLabel
              ? t('dashboard.member.subtitleWithFamily').replace('{family}', familyNamesLabel)
              : t('dashboard.memberSubtitle')}
          </p>
          {assignedFamilies.length > 1 && (
            <ul
              className="mt-2 flex flex-wrap gap-2"
              aria-label={t('dashboard.member.yourFamilies')}
            >
              {assignedFamilies.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/families/${f.id}`}
                    className="focus-ring inline-flex items-center rounded-md border border-border bg-app-subtle px-2.5 py-1 text-xs font-medium text-fg hover:bg-fg/5"
                  >
                    {f.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ol className="mt-4 divide-y divide-border rounded-md border border-border bg-app-subtle overflow-hidden">
            {steps.map((s, i) => (
              <li key={s.title}>
                <Link
                  href={s.href}
                  className="focus-ring flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-fg hover:bg-fg/5 transition-colors"
                >
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent"
                    aria-hidden="true"
                  >
                    {s.done ? <CheckCircleIcon className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className="flex-1 truncate">{s.title}</span>
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="h-4 w-4 text-fg-subtle shrink-0 rtl:rotate-180"
                  />
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={familyListHref}
              className="focus-ring inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium min-h-[var(--touch-target)] sm:min-h-0"
            >
              {primaryFamily
                ? t('dashboard.member.openFamily').replace('{family}', primaryFamily.name)
                : t('dashboard.member.browseFamilies')}
            </Link>
            <button
              type="button"
              onClick={openGlobalSearch}
              className="focus-ring inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border bg-surface text-fg hover:bg-fg/5 transition-colors text-sm font-medium min-h-[var(--touch-target)] sm:min-h-0"
            >
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('dashboard.member.searchFamilies')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
