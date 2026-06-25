'use client'

import Link from 'next/link'
import {
  UserGroupIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { useT } from '@/lib/client/i18n'
import { useMemberOnboarding } from '@/lib/client/useMemberOnboarding'
import { openGlobalSearch } from '@/lib/client/open-global-search'

export default function MemberWelcomeChecklist() {
  const t = useT()
  const { visitedFamilies, viewedFamily } = useMemberOnboarding()

  const steps = [
    {
      title: t('dashboard.member.browseFamilies'),
      href: '/families',
      done: visitedFamilies,
    },
    {
      title: t('dashboard.member.viewMembers'),
      href: '/families',
      done: viewedFamily,
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
          <p className="mt-1 text-sm text-fg-muted">{t('dashboard.memberSubtitle')}</p>
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
              href="/families"
              className="focus-ring inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium min-h-[var(--touch-target)] sm:min-h-0"
            >
              {t('dashboard.member.browseFamilies')}
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
