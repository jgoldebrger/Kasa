'use client'

import { InformationCircleIcon } from '@heroicons/react/24/outline'
import { useT } from '@/lib/client/i18n'
import { useFamilyDetail } from './FamilyDetailContext'

/**
 * Shown to non-admin org members on family detail — explains financial
 * access or that admin manages payments when not email-linked.
 */
export default function MemberHiddenTabsNotice() {
  const t = useT()
  const { memberFinancialAccess } = useFamilyDetail()

  const profileAccess = `${t('family.tabGroup.profile')}: ${t('family.tab.info')}, ${t('family.members')}, ${t('family.subFamilies')}`

  return (
    <div
      className="mb-0 mt-4 flex items-start gap-3 rounded-md border border-border bg-app-subtle p-4 ms-6 me-6"
      role="note"
      aria-label={t('memberPortal.noticeAria')}
    >
      <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm text-fg-muted">
          {memberFinancialAccess
            ? t('memberPortal.noticeLinked')
            : t('memberPortal.noticeUnlinked')}
        </p>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-fg-muted">
          <li>{profileAccess}</li>
          {memberFinancialAccess ? (
            <li>
              {t('memberPortal.currentBalance')}, {t('memberPortal.makePayment')},{' '}
              {t('memberPortal.viewStatements')}
            </li>
          ) : (
            <li>{t('memberPortal.noFinancialAccessHint')}</li>
          )}
        </ul>
      </div>
    </div>
  )
}
