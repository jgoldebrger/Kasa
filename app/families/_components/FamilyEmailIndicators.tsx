'use client'

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Badge, Tooltip } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

export interface FamilyEmailStatus {
  email?: string
  emailDeliverabilityWarning?: boolean
  emailFormatInvalid?: boolean
}

interface FamilyEmailIndicatorsProps {
  family: FamilyEmailStatus
  /** Show compact icon-only indicators (list rows). */
  compact?: boolean
}

export default function FamilyEmailIndicators({
  family,
  compact = false,
}: FamilyEmailIndicatorsProps) {
  const t = useT()
  const hasEmail = Boolean(family.email?.trim())
  if (!hasEmail) return null

  const showDeliverability = family.emailDeliverabilityWarning === true
  const showInvalid = family.emailFormatInvalid === true
  if (!showDeliverability && !showInvalid) return null

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1">
        {showInvalid && (
          <Tooltip content={t('families.email.formatInvalid')}>
            <ExclamationTriangleIcon
              className="h-4 w-4 shrink-0 text-danger"
              aria-label={t('families.email.formatInvalid')}
            />
          </Tooltip>
        )}
        {showDeliverability && (
          <Tooltip content={t('families.email.deliverabilityWarning')}>
            <ExclamationTriangleIcon
              className="h-4 w-4 shrink-0 text-warning"
              aria-label={t('families.email.deliverabilityWarningShort')}
            />
          </Tooltip>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {showInvalid && (
        <Badge size="sm" variant="danger">
          {t('families.email.formatInvalid')}
        </Badge>
      )}
      {showDeliverability && (
        <Badge size="sm" variant="warning">
          {t('families.email.deliverabilityWarningShort')}
        </Badge>
      )}
    </span>
  )
}
