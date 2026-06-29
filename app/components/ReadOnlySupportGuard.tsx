'use client'

import { ReactNode } from 'react'
import { Alert } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'

interface ReadOnlySupportGuardProps {
  children?: ReactNode
  className?: string
}

/** Shows a view-only alert when platform support mode is read-only. */
export default function ReadOnlySupportGuard({ children, className }: ReadOnlySupportGuardProps) {
  const t = useT()
  const { readOnly, loading } = useSupportModeReadOnly()

  if (loading || !readOnly) {
    return children ? <>{children}</> : null
  }

  return (
    <div className={className}>
      <Alert variant="warning" title={t('admin.supportMode.viewOnlyNotice')} />
      {children}
    </div>
  )
}
