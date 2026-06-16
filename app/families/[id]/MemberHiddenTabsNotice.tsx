'use client'

import { InformationCircleIcon } from '@heroicons/react/24/outline'

/**
 * Shown to non-admin org members on family detail — explains that financial
 * tabs (payments, statements, etc.) are admin-only.
 */
export default function MemberHiddenTabsNotice() {
  return (
    <div
      className="mx-6 mt-4 mb-0 flex items-start gap-3 rounded-md border border-border bg-app-subtle p-4"
      role="note"
      aria-label="Admin-managed features"
    >
      <InformationCircleIcon
        className="h-5 w-5 shrink-0 text-fg-muted mt-0.5"
        aria-hidden="true"
      />
      <p className="text-sm text-fg-muted">
        Payments and statements are managed by your organization admin.
      </p>
    </div>
  )
}
