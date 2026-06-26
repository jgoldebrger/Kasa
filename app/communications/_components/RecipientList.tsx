'use client'

import { Badge, Button, SkeletonRows } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import {
  filterFamiliesBySegment,
  isSelectableFamily,
  RECIPIENT_SEGMENTS,
  segmentCount,
  type RecipientSegment,
} from './recipient-segments'
import type { FamilyOption } from './types'

interface RecipientListProps {
  families: FamilyOption[]
  loading: boolean
  selectedIds: Set<string>
  segment: RecipientSegment
  onSegmentChange: (segment: RecipientSegment) => void
  hasBalanceData?: boolean
  onToggle: (id: string) => void
  onSelectAll: () => void
}

function SegmentChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string
  count: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${
        selected
          ? 'bg-accent text-accent-fg border-accent'
          : 'border-border text-fg hover:bg-surface'
      }`}
    >
      <span>{label}</span>
      <span
        className={`tabular rounded-full px-1.5 py-0.5 text-[10px] ${
          selected ? 'bg-accent-fg/15' : 'bg-app-subtle text-fg-muted'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

const SEGMENT_LABEL_KEYS: Record<RecipientSegment, MessageKey> = {
  all: 'communications.segment.all',
  'has-email': 'communications.segment.hasEmail',
  'opted-out': 'communications.segment.optedOut',
  'deliverability-warning': 'communications.segment.deliverabilityWarning',
  'invalid-format': 'communications.segment.invalidFormat',
  'balance-gt-zero': 'communications.segment.balanceGtZero',
}

const SEGMENT_FALLBACKS: Record<RecipientSegment, string> = {
  all: 'All',
  'has-email': 'Has email',
  'opted-out': 'Opted out',
  'deliverability-warning': 'Delivery issues',
  'invalid-format': 'Invalid format',
  'balance-gt-zero': 'Balance > 0',
}

export default function RecipientList({
  families,
  loading,
  selectedIds,
  segment,
  onSegmentChange,
  hasBalanceData = true,
  onToggle,
  onSelectAll,
}: RecipientListProps) {
  const t = useT()

  const visibleSegments = RECIPIENT_SEGMENTS.filter(
    (s) => s !== 'balance-gt-zero' || hasBalanceData,
  )
  const filteredFamilies = filterFamiliesBySegment(families, segment)
  const selectableInView = filteredFamilies.filter(isSelectableFamily)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-fg">
          {t('communications.field.recipients')}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={selectableInView.length === 0}
        >
          {t('communications.selectAll')}
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {visibleSegments.map((s) => (
          <SegmentChip
            key={s}
            label={t(SEGMENT_LABEL_KEYS[s], SEGMENT_FALLBACKS[s])}
            count={segmentCount(families, s)}
            selected={segment === s}
            onClick={() => onSegmentChange(s)}
          />
        ))}
      </div>

      {loading ? (
        <SkeletonRows count={4} />
      ) : filteredFamilies.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('communications.segment.empty')}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {filteredFamilies.map((f) => {
            const optedOut = Boolean(f.communicationsOptOut)
            const invalidFormat = Boolean(f.email?.trim() && f.emailFormatInvalid)
            const noEmail = !f.email?.trim()
            const disabled = optedOut || noEmail
            return (
              <label
                key={f._id}
                className={`flex items-center gap-3 px-3 py-2 ${
                  disabled
                    ? 'opacity-50 cursor-not-allowed bg-app-subtle'
                    : 'hover:bg-app-subtle cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(f._id)}
                  onChange={() => !disabled && onToggle(f._id)}
                  disabled={disabled}
                  className="rounded border-border disabled:cursor-not-allowed"
                />
                <span className={`font-medium flex-1 ${disabled ? 'text-fg-muted' : 'text-fg'}`}>
                  {f.name}
                </span>
                {optedOut && (
                  <Badge size="sm" variant="warning">
                    {t('communications.optedOut')}
                  </Badge>
                )}
                {invalidFormat && !optedOut && (
                  <Badge size="sm" variant="danger">
                    {t('communications.segment.invalidFormatBadge')}
                  </Badge>
                )}
                {f.emailDeliverabilityWarning && !optedOut && !invalidFormat && (
                  <Badge size="sm" variant="danger">
                    {t('communications.deliverability.badge')}
                  </Badge>
                )}
                {(f.openBalance ?? 0) > 0 && hasBalanceData && (
                  <span className="text-xs tabular text-fg-muted shrink-0">
                    {t('communications.segment.balance').replace(
                      '{amount}',
                      (f.openBalance ?? 0).toFixed(2),
                    )}
                  </span>
                )}
                <span className="text-xs text-fg-muted truncate max-w-[12rem]">
                  {f.email || t('communications.segment.noEmail')}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
