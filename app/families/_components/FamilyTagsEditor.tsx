'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { useT } from '@/lib/client/i18n'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'

const MAX_TAGS = 20
const MAX_TAG_LEN = 50

interface FamilyTagsEditorProps {
  familyId: string
  tags: string[]
  onUpdated?: (tags: string[]) => void
  className?: string
}

export default function FamilyTagsEditor({
  familyId,
  tags: initialTags,
  onUpdated,
  className = '',
}: FamilyTagsEditorProps) {
  const t = useT()
  const toast = useToast()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [tags, setTags] = useState<string[]>(initialTags ?? [])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTags(initialTags ?? [])
  }, [initialTags])

  const saveTags = useCallback(
    async (next: string[]) => {
      setSaving(true)
      try {
        const res = await fetch(`/api/families/${familyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: next }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          const message =
            data && typeof data === 'object' && 'error' in data
              ? String(data.error)
              : t('families.tags.errorSave')
          toast.error(message)
          setTags(initialTags ?? [])
          return
        }
        const saved = Array.isArray(data?.tags) ? data.tags : next
        setTags(saved)
        onUpdated?.(saved)
        invalidateCache(/^\/api\/families/)
        toast.success(t('families.tags.saved'))
      } catch {
        toast.error(t('common.networkErrorShort'))
        setTags(initialTags ?? [])
      } finally {
        setSaving(false)
      }
    },
    [familyId, initialTags, onUpdated, t, toast],
  )

  const addTag = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    if (trimmed.length > MAX_TAG_LEN) {
      toast.error(t('families.tags.tooLong'))
      return
    }
    const key = trimmed.toLowerCase()
    if (tags.some((tag) => tag.toLowerCase() === key)) {
      setInput('')
      return
    }
    if (tags.length >= MAX_TAGS) {
      toast.error(t('families.tags.tooMany'))
      return
    }
    const next = [...tags, trimmed]
    setTags(next)
    setInput('')
    void saveTags(next)
  }

  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag)
    setTags(next)
    void saveTags(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]!)
    }
  }

  if (supportReadOnly) {
    if (tags.length === 0) return null
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {tags.map((tag) => (
          <Badge key={tag} variant="muted" size="md" className="normal-case tracking-normal">
            {tag}
          </Badge>
        ))}
      </div>
    )
  }

  return (
    <div className={className}>
      <p className="mb-1.5 text-sm text-fg-muted">{t('families.tags.label')}</p>
      <div
        className="flex min-h-[2.25rem] flex-wrap items-center gap-1.5 rounded-md border border-border bg-app px-2 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-0.5 rounded-sm bg-fg/10 px-2 py-0.5 text-xs text-fg"
          >
            {tag}
            <button
              type="button"
              className="rounded p-0.5 text-fg-muted hover:text-fg focus-ring"
              aria-label={t('families.tags.remove').replace('{tag}', tag)}
              disabled={saving}
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
            >
              <XMarkIcon className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          disabled={saving || tags.length >= MAX_TAGS}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (input.trim()) addTag(input)
          }}
          placeholder={tags.length === 0 ? t('families.tags.placeholder') : ''}
          className="min-w-[6rem] flex-1 border-0 bg-transparent py-0.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-0"
          aria-label={t('families.tags.addInput')}
        />
      </div>
      <p className="mt-1 text-xs text-fg-muted">{t('families.tags.hint')}</p>
    </div>
  )
}
