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

  return (
    <div
      className="mx-6 mt-4 mb-0 flex items-start gap-3 rounded-md border border-border bg-app-subtle p-4"
      role="note"
      aria-label={t('memberPortal.noticeAria')}
    >
      <InformationCircleIcon className="h-5 w-5 shrink-0 text-fg-muted mt-0.5" aria-hidden="true" />
      <p className="text-sm text-fg-muted">
        {memberFinancialAccess ? t('memberPortal.noticeLinked') : t('memberPortal.noticeUnlinked')}
      </p>
    </div>
  )
}
