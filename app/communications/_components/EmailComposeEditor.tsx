'use client'

import { useEffect, useRef } from 'react'
import { BoldIcon, ItalicIcon, LinkIcon, ListBulletIcon } from '@heroicons/react/24/outline'
import { useT } from '@/lib/client/i18n'
import { insertTextInContentEditable } from '@/lib/client/insert-contenteditable'
import { sanitizeEmailHtml } from '@/lib/client/sanitize-email-html'
import { bodyToEditorHtml } from './email-utils'
import MergeFieldSelector from './MergeFieldSelector'

interface EmailComposeEditorProps {
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  placeholder?: string
  rows?: number
}

function isEmptyEditorHtml(html: string): boolean {
  const trimmed = html.replace(/\s/g, '')
  return (
    !trimmed || trimmed === '<br>' || trimmed === '<div><br></div>' || trimmed === '<p><br></p>'
  )
}

function normalizeEditorHtml(html: string): string {
  if (isEmptyEditorHtml(html)) return ''
  return sanitizeEmailHtml(html)
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
  const editorRef = useRef<HTMLDivElement>(null)
  const skipSyncRef = useRef(false)

  useEffect(() => {
    const el = editorRef.current
    if (!el || skipSyncRef.current) {
      skipSyncRef.current = false
      return
    }
    const nextHtml = bodyToEditorHtml(value)
    if (el.innerHTML !== nextHtml) {
      el.innerHTML = nextHtml
    }
  }, [value])

  const syncFromEditor = () => {
    const el = editorRef.current
    if (!el) return
    skipSyncRef.current = true
    onChange(normalizeEditorHtml(el.innerHTML))
  }

  const execFormat = (command: string, commandValue?: string) => {
    const el = editorRef.current
    if (!el) return
    el.focus()
    document.execCommand(command, false, commandValue)
    syncFromEditor()
  }

  const insertLink = () => {
    const url = window.prompt(t('communications.editor.linkPrompt'), 'https://')
    if (!url?.trim()) return
    const safeUrl =
      /^https?:\/\//i.test(url) || /^mailto:/i.test(url) ? url.trim() : `https://${url.trim()}`
    execFormat('createLink', safeUrl)
  }

  const toolbarBtn =
    'focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg'

  const minHeight = `${Math.max(rows * 1.5, 8)}rem`

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-fg">{label}</label>}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-0.5 border-b border-border bg-app-subtle px-2 py-1">
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.bold')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('bold')}
          >
            <BoldIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.italic')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('italic')}
          >
            <ItalicIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.link')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertLink}
          >
            <LinkIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolbarBtn}
            title={t('communications.editor.bulletList')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execFormat('insertUnorderedList')}
          >
            <ListBulletIcon className="h-4 w-4" />
          </button>
          <div className="ml-auto min-w-[10rem] max-w-[14rem]">
            <MergeFieldSelector
              className="h-8 text-xs"
              onInsert={(token) => {
                const el = editorRef.current
                if (!el) return
                el.focus()
                insertTextInContentEditable(token)
                syncFromEditor()
              }}
            />
          </div>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={placeholder}
          onInput={syncFromEditor}
          onBlur={syncFromEditor}
          onPaste={(e) => {
            e.preventDefault()
            const text = e.clipboardData.getData('text/plain')
            if (text) {
              insertTextInContentEditable(text)
              syncFromEditor()
            }
          }}
          style={{ minHeight }}
          className="focus-ring w-full resize-y border-0 bg-surface px-3 py-2 text-sm text-fg outline-none [&_a]:text-blue-600 [&_a]:underline [&_em]:italic [&_i]:italic [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]"
        />
      </div>
      {hint && <p className="text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}
