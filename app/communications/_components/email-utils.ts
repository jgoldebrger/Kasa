/** Escape HTML entities in plain text. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Process inline markdown: bold, italic, links. */
function processInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = escapeHtml(url)
    return `<a href="${safeUrl}" style="color: #2563eb;">${label}</a>`
  })
  return out
}

/** Convert lightweight markdown body to HTML for sending. */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const parts: string[] = []
  let inList = false

  for (const line of lines) {
    const bulletMatch = /^[-*]\s+(.*)/.exec(line)
    if (bulletMatch) {
      if (!inList) {
        parts.push('<ul style="margin: 0.5em 0; padding-left: 1.5em;">')
        inList = true
      }
      parts.push(`<li>${processInline(bulletMatch[1])}</li>`)
    } else {
      if (inList) {
        parts.push('</ul>')
        inList = false
      }
      if (line.trim()) {
        parts.push(`<p style="margin: 0.5em 0;">${processInline(line)}</p>`)
      }
    }
  }
  if (inList) parts.push('</ul>')

  return `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${parts.join('')}</div>`
}

/** Strip markdown to plain text for the text fallback. */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
}

import { mergeFieldSamples } from '@/lib/mail/merge-field-definitions'

/** Substitute merge fields for preview (sample values). */
export function substituteMergeFields(
  text: string,
  overrides: Record<string, string> = {},
): string {
  const samples = { ...mergeFieldSamples(), ...overrides }
  let out = text
  for (const [key, sample] of Object.entries(samples)) {
    if (!sample) continue
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), sample)
  }
  return out
}

/** Default tax receipt year — last completed calendar year. */
export function defaultTaxReceiptYear(): number {
  return new Date().getFullYear() - 1
}

export function taxReceiptYearOptions(): number[] {
  const max = new Date().getFullYear()
  const years: number[] = []
  for (let y = max; y >= max - 8; y--) years.push(y)
  return years
}

/** Map compose attachments to API shape (`contentBase64`). */
export function attachmentsForApi(
  attachments: { filename: string; content: string; contentType: string }[],
) {
  return attachments.map((a) => ({
    filename: a.filename,
    contentBase64: a.content,
    contentType: a.contentType,
  }))
}

/** Extract a user-visible message from handler JSON (incl. Zod validation). */
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const d = data as Record<string, unknown>
  if (typeof d.error !== 'string') return fallback
  const issues = d.issues as Array<{ message?: string }> | undefined
  if (Array.isArray(issues) && issues.length > 0) {
    const detail = issues
      .map((i) => i.message)
      .filter(Boolean)
      .join(', ')
    return detail ? `${d.error}: ${detail}` : d.error
  }
  return d.error
}
