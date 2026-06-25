'use client'

import { Button, Input, Select } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

export interface EmailLogFilterValues {
  status: string
  kind: string
  dateFrom: string
  dateTo: string
}

interface EmailLogFiltersProps {
  values: EmailLogFilterValues
  onChange: (values: EmailLogFilterValues) => void
  onApply: () => void
  onClear: () => void
  loading?: boolean
}

const STATUS_OPTIONS = ['', 'queued', 'sent', 'opened', 'clicked', 'failed'] as const
const KIND_OPTIONS = ['', 'custom', 'statement', 'tax-receipt', 'task-reminder', 'file'] as const

export default function EmailLogFilters({
  values,
  onChange,
  onApply,
  onClear,
  loading,
}: EmailLogFiltersProps) {
  const t = useT()

  const set = (patch: Partial<EmailLogFilterValues>) => onChange({ ...values, ...patch })

  const clear = () => onClear()

  const hasFilters = values.status || values.kind || values.dateFrom || values.dateTo

  return (
    <div className="flex flex-wrap items-end gap-3 p-4 border-b border-border bg-app-subtle/50">
      <Select
        label={t('communications.filter.status' as MessageKey, 'Status')}
        value={values.status}
        onChange={(e) => set({ status: e.target.value })}
        className="min-w-[140px]"
      >
        <option value="">
          {t('communications.filter.allStatuses' as MessageKey, 'All statuses')}
        </option>
        {STATUS_OPTIONS.filter(Boolean).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Select
        label={t('communications.filter.kind' as MessageKey, 'Kind')}
        value={values.kind}
        onChange={(e) => set({ kind: e.target.value })}
        className="min-w-[160px]"
      >
        <option value="">{t('communications.filter.allKinds' as MessageKey, 'All kinds')}</option>
        {KIND_OPTIONS.filter(Boolean).map((k) => (
          <option key={k} value={k}>
            {k.replace(/-/g, ' ')}
          </option>
        ))}
      </Select>
      <Input
        type="date"
        label={t('communications.filter.dateFrom' as MessageKey, 'From')}
        value={values.dateFrom}
        onChange={(e) => set({ dateFrom: e.target.value })}
        className="w-auto min-w-[150px]"
      />
      <Input
        type="date"
        label={t('communications.filter.dateTo' as MessageKey, 'To')}
        value={values.dateTo}
        onChange={(e) => set({ dateTo: e.target.value })}
        className="w-auto min-w-[150px]"
      />
      <Button type="button" variant="secondary" loading={loading} onClick={onApply}>
        {t('communications.filter.apply' as MessageKey, 'Apply')}
      </Button>
      {hasFilters && (
        <Button type="button" variant="ghost" onClick={clear}>
          {t('communications.filter.clear' as MessageKey, 'Clear')}
        </Button>
      )}
    </div>
  )
}
