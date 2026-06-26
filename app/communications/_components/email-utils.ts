import { mergeFieldSamples } from '@/lib/mail/merge-field-definitions'
import { sanitizeEmailHtml } from '@/lib/client/sanitize-email-html'

/** Escape HTML entities in plain text. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Process inline markdown: links, bold, italic. */
function processInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = escapeHtml(url)
    return `<a href="${safeUrl}" style="color: #2563eb;">${label}</a>`
  })
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
  return out
}

const EMAIL_WRAPPER_STYLE = 'font-family: Arial, sans-serif; line-height: 1.6;'

function wrapEmailHtml(inner: string): string {
  return `<div style="${EMAIL_WRAPPER_STYLE}">${inner}</div>`
}

/** True when body was saved from the rich editor (or other HTML source). */
export function isLikelyHtmlBody(text: string): boolean {
  return /<\s*(p|div|br|ul|ol|li|strong|b|em|i|a)\b/i.test(text)
}

/** Convert lightweight markdown body to an HTML fragment (no outer wrapper). */
export function markdownToEditorHtml(md: string): string {
  const wrapped = markdownToHtml(md)
  const match = /^<div[^>]*>([\s\S]*)<\/div>$/i.exec(wrapped)
  return match ? match[1] : wrapped
}

/** Convert compose body to HTML for the rich editor. */
export function bodyToEditorHtml(body: string): string {
  if (!body.trim()) return ''
  if (isLikelyHtmlBody(body)) return body
  return markdownToEditorHtml(body)
}

/** Convert compose body to HTML for sending. */
export function bodyToEmailHtml(body: string): string {
  if (!body.trim()) return ''
  if (isLikelyHtmlBody(body)) {
    return wrapEmailHtml(sanitizeEmailHtml(body))
  }
  return markdownToHtml(body)
}

/** Strip HTML to plain text for the text fallback. */
export function htmlToPlainText(html: string): string {
  if (!html.trim()) return ''
  if (typeof document === 'undefined') {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  const root = document.createElement('div')
  root.innerHTML = html
  root.querySelectorAll('li').forEach((li) => {
    const prefix = document.createTextNode('• ')
    li.insertBefore(prefix, li.firstChild)
  })
  root.querySelectorAll('br').forEach((br) => {
    br.replaceWith(document.createTextNode('\n'))
  })
  root.querySelectorAll('p, div').forEach((block) => {
    block.append(document.createTextNode('\n'))
  })

  return (root.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Plain-text fallback for any compose body format. */
export function bodyToPlainText(body: string): string {
  if (!body.trim()) return ''
  if (isLikelyHtmlBody(body)) return htmlToPlainText(body)
  return markdownToPlainText(body)
}

/** Whether the compose body has no visible text. */
export function composeBodyIsEmpty(body: string): boolean {
  return !bodyToPlainText(body).trim()
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

  return wrapEmailHtml(parts.join(''))
}

/** Strip markdown to plain text for the text fallback. */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
}

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
