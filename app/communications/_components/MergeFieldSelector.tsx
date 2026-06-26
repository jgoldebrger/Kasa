'use client'

import { useState } from 'react'
import { Select } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import {
  MERGE_FIELD_CATEGORY_ORDER,
  MERGE_FIELD_DEFINITIONS,
  mergeFieldToken,
  type MergeFieldCategory,
} from '@/lib/mail/merge-field-definitions'

const CATEGORY_LABEL_KEYS: Record<MergeFieldCategory, MessageKey> = {
  family: 'communications.mergeField.category.family',
  billing: 'communications.mergeField.category.billing',
  dates: 'communications.mergeField.category.dates',
  organization: 'communications.mergeField.category.organization',
}

interface MergeFieldSelectorProps {
  onInsert: (token: string) => void
  disabled?: boolean
  className?: string
}

export default function MergeFieldSelector({
  onInsert,
  disabled,
  className = '',
}: MergeFieldSelectorProps) {
  const t = useT()
  const [resetKey, setResetKey] = useState(0)

  return (
    <Select
      key={resetKey}
      value=""
      disabled={disabled}
      onChange={(e) => {
        const key = e.target.value
        if (!key) return
        onInsert(mergeFieldToken(key as Parameters<typeof mergeFieldToken>[0]))
        setResetKey((k) => k + 1)
      }}
      className={className}
      aria-label={t('communications.mergeField.insert')}
    >
      <option value="">{t('communications.mergeField.insert')}</option>
      {MERGE_FIELD_CATEGORY_ORDER.map((category) => {
        const fields = MERGE_FIELD_DEFINITIONS.filter((d) => d.category === category)
        if (fields.length === 0) return null
        return (
          <optgroup key={category} label={t(CATEGORY_LABEL_KEYS[category])}>
            {fields.map((field) => (
              <option key={field.key} value={field.key}>
                {t(field.labelKey as MessageKey)} ({mergeFieldToken(field.key)})
              </option>
            ))}
          </optgroup>
        )
      })}
    </Select>
  )
}
