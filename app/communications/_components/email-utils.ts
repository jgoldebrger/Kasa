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

/** Substitute merge fields for preview (sample values). */
export function substituteMergeFields(
  text: string,
  sample: { familyName?: string; balance?: string; dues?: string } = {},
): string {
  const familyName = sample.familyName ?? 'Sample Family'
  const balance = sample.balance ?? '$0.00'
  const dues = sample.dues ?? '$0.00'
  return text
    .replace(/\{\{familyName\}\}/gi, familyName)
    .replace(/\{\{balance\}\}/gi, balance)
    .replace(/\{\{dues\}\}/gi, dues)
}
