'use client'

import { useRef } from 'react'
import { BoldIcon, ItalicIcon, LinkIcon, ListBulletIcon } from '@heroicons/react/24/outline'
import { useT } from '@/lib/client/i18n'
import { insertAtCursor } from '@/lib/client/insert-at-cursor'
import MergeFieldSelector from './MergeFieldSelector'

interface EmailComposeEditorProps {
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  placeholder?: string
  rows?: number
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder = 'text',
) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = textarea.value.slice(start, end) || placeholder
  const next =
    textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end)
  const cursor = start + before.length + selected.length + after.length
  return { next, cursor }
}

export default function EmailComposeEditor({
  value,
  onChange,
  label,
  hint,
  placeholder,
  rows = 8,
}: EmailComposeEditorProps) {
  const t = useT()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const applyWrap = (before: string, after: string, placeholderText?: string) => {
    const el = textareaRef.current
    if (!el) return
    const { next, cursor } = wrapSelection(el, before, after, placeholderText)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(cursor, cursor)
    })
  }

  const insertLink = () => {
    const el = textareaRef.current
    if (!el) return
    const url = window.prompt(t('communications.editor.linkPrompt'), 'https://')
    if (!url) return
    const { next, cursor } = wrapSelection(el, '[', `](${url})`, 'link text')
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(cursor, cursor)
    })
  }

  const insertBullet = () => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const prefix = value.slice(0, lineStart)
    const suffix = value.slice(lineStart)
    const bulletLine = suffix.startsWith('- ') ? suffix : `- ${suffix}`
    onChange(prefix + bulletLine)
    requestAnimationFrame(() => el.focus())
  }

  const toolbarBtn =
    'focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg'

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-fg">{label}</label>}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-0.5 border-b border-border bg-app-subtle px-2 py-1">
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.bold')}
            onClick={() => applyWrap('**', '**', 'bold')}
          >
            <BoldIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.italic')}
            onClick={() => applyWrap('*', '*', 'italic')}
          >
            <ItalicIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.link')}
            onClick={insertLink}
          >
            <LinkIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.bulletList')}
            onClick={insertBullet}
          >
            <ListBulletIcon className="h-4 w-4" />
          </button>
          <div className="ml-auto min-w-[10rem] max-w-[14rem]">
            <MergeFieldSelector
              className="h-8 text-xs"
              onInsert={(token) => {
                const el = textareaRef.current
                if (!el) return
                insertAtCursor(el, value, token, onChange)
              }}
            />
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="focus-ring w-full resize-y border-0 bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
        />
      </div>
      {hint && <p className="text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}
