'use client'

import { Badge, Button, SkeletonRows } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { FamilyOption } from './types'

interface RecipientListProps {
  families: FamilyOption[]
  loading: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
}

export default function RecipientList({
  families,
  loading,
  selectedIds,
  onToggle,
  onSelectAll,
}: RecipientListProps) {
  const t = useT()

  const emailableFamilies = families.filter((f) => f.email)
  const selectableFamilies = emailableFamilies.filter((f) => !f.communicationsOptOut)

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
          disabled={selectableFamilies.length === 0}
        >
          {t('communications.selectAll')}
        </Button>
      </div>
      {loading ? (
        <SkeletonRows count={4} />
      ) : emailableFamilies.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('communications.noEmailableFamilies')}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {emailableFamilies.map((f) => {
            const optedOut = Boolean(f.communicationsOptOut)
            return (
              <label
                key={f._id}
                className={`flex items-center gap-3 px-3 py-2 ${
                  optedOut
                    ? 'opacity-50 cursor-not-allowed bg-app-subtle'
                    : 'hover:bg-app-subtle cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(f._id)}
                  onChange={() => !optedOut && onToggle(f._id)}
                  disabled={optedOut}
                  className="rounded border-border disabled:cursor-not-allowed"
                />
                <span className={`font-medium flex-1 ${optedOut ? 'text-fg-muted' : 'text-fg'}`}>
                  {f.name}
                </span>
                {optedOut && (
                  <Badge size="sm" variant="warning">
                    {t('communications.optedOut')}
                  </Badge>
                )}
                {f.emailDeliverabilityWarning && !optedOut && (
                  <Badge size="sm" variant="danger">
                    {t('communications.deliverability.badge')}
                  </Badge>
                )}
                <span className="text-xs text-fg-muted truncate max-w-[12rem]">{f.email}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
