'use client'

import { useRef } from 'react'
import { Input } from '@/app/components/ui'
import type { InputProps } from '@/app/components/ui'
import { insertAtCursor } from '@/lib/client/insert-at-cursor'
import MergeFieldSelector from './MergeFieldSelector'

interface SubjectFieldWithMergeFieldsProps extends Omit<InputProps, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
}

export default function SubjectFieldWithMergeFields({
  value,
  onChange,
  ...inputProps
}: SubjectFieldWithMergeFieldsProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            {...inputProps}
          />
        </div>
        <MergeFieldSelector
          className="h-10 w-full sm:w-auto sm:min-w-[11rem] sm:max-w-[14rem]"
          onInsert={(token) => {
            const el = inputRef.current
            if (!el) return
            insertAtCursor(el, value, token, onChange)
          }}
        />
      </div>
    </div>
  )
}
