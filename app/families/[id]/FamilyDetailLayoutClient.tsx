'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { FamilyDetailProvider, useFamilyDetail } from './FamilyDetailContext'
import FamilyHeader from './FamilyHeader'
import FamilyTabNav from './FamilyTabNav'
import MemberHiddenTabsNotice from './MemberHiddenTabsNotice'
import { FAMILY_TABS, resolveFamilyTabLabel } from './_lib/constants'
import type { FamilyDetails } from './_lib/helpers'
import { useT } from '@/lib/client/i18n'

function BreadcrumbSeparator() {
  return (
    <li aria-hidden="true" className="flex shrink-0 items-center">
      <ChevronRightIcon className="h-3.5 w-3.5 rtl:rotate-180" />
    </li>
  )
}

const FamilyModals = dynamic(() => import('./_components/FamilyModals'), {
  loading: () => null,
})

function FamilyDetailShell({ children }: { children: React.ReactNode }) {
  const { roleLoading, loading, data, isAdmin, router, activeTab } = useFamilyDetail()
  const t = useT()
  const activeTabDef = FAMILY_TABS.find((tab) => tab.id === activeTab)
  const activeTabLabel = activeTabDef ? resolveFamilyTabLabel(activeTabDef, t) : undefined

  if (roleLoading || loading) {
    return (
      <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app">
        <div className="max-w-7xl mx-auto">
          <div className="ui-skeleton h-8 w-40 mb-4" />
          <div className="ui-skeleton h-10 w-2/3 mb-2" />
          <div className="ui-skeleton h-5 w-1/2 mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="ui-skeleton h-28" />
            <div className="ui-skeleton h-28" />
            <div className="ui-skeleton h-28" />
          </div>
          <div className="ui-skeleton h-96" />
        </div>
      </main>
    )
  }

  if (!data?.family) {
    return (
      <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4 text-fg">Family not found</h1>
          <p className="text-fg">
            The family you&apos;re looking for doesn&apos;t exist or couldn&apos;t be loaded.
          </p>
          <button
            onClick={() => router.push('/families')}
            className="focus-ring mt-4 inline-flex items-center gap-1 text-accent hover:text-accent-hover rounded"
          >
            ← Back to Families
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app">
      <div className="max-w-7xl mx-auto">
        <Link
          href="/families"
          className="mb-2 inline-flex items-center gap-1 text-accent hover:text-accent-hover focus-ring rounded"
        >
          ← Back to Families
        </Link>

        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-fg-muted">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
            <li>
              <Link href="/families" className="hover:text-fg focus-ring rounded">
                {t('nav.families')}
              </Link>
            </li>
            <BreadcrumbSeparator />
            <li className="text-fg truncate max-w-[12rem] sm:max-w-none">{data.family.name}</li>
            {activeTab !== 'info' && activeTabLabel && (
              <>
                <BreadcrumbSeparator />
                <li className="text-fg" aria-current="page">
                  {activeTabLabel}
                </li>
              </>
            )}
          </ol>
        </nav>

        <FamilyHeader />

        <div className="bg-surface rounded-lg shadow mt-3">
          <FamilyTabNav />
          {!isAdmin && <MemberHiddenTabsNotice />}
          <div className="p-6">{children}</div>
        </div>

        <FamilyModals />
      </div>
    </main>
  )
}

export default function FamilyDetailLayoutClient({
  children,
  initialSummary = null,
}: {
  children: React.ReactNode
  initialSummary?: FamilyDetails | null
}) {
  return (
    <FamilyDetailProvider initialSummary={initialSummary}>
      <Suspense
        fallback={
          <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app">
            <div className="max-w-7xl mx-auto ui-skeleton h-96" />
          </main>
        }
      >
        <FamilyDetailShell>{children}</FamilyDetailShell>
      </Suspense>
    </FamilyDetailProvider>
  )
}
