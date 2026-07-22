const ALLOWED_TAGS = new Set([
  'P',
  'DIV',
  'BR',
  'STRONG',
  'B',
  'EM',
  'I',
  'A',
  'UL',
  'OL',
  'LI',
  'SPAN',
])

export function isSafeEmailHref(href: string): boolean {
  const trimmed = href.trim()
  return /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)
}

/** Regex-based sanitizer for SSR / Node (no DOM). */
function sanitizeEmailHtmlServer(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  out = out.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
    const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    const href = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '').trim()
    if (!isSafeEmailHref(href)) return ''
    const escaped = href.replace(/"/g, '&quot;')
    return `<a href="${escaped}" rel="noopener noreferrer" style="color: #2563eb;">`
  })

  const allowed = 'p|div|br|strong|b|em|i|a|ul|ol|li|span'
  out = out.replace(new RegExp(`<\\/?(?!${allowed}\\b)[a-z][^>]*>`, 'gi'), '')
  return out
}

/** Strip unsafe tags/attributes from rich email body HTML. */
export function sanitizeEmailHtml(html: string): string {
  if (!html.trim()) return ''
  if (typeof document === 'undefined') {
    return sanitizeEmailHtmlServer(html)
  }

  const template = document.createElement('template')
  template.innerHTML = html

  const sanitizeNode = (node: Node): void => {
    const children = Array.from(node.childNodes)
    for (const child of children) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as HTMLElement

      if (!ALLOWED_TAGS.has(el.tagName)) {
        const parent = el.parentNode
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el)
          parent.removeChild(el)
          sanitizeNode(parent)
        }
        continue
      }

      for (const attr of Array.from(el.attributes)) {
        if (el.tagName === 'A' && attr.name === 'href' && isSafeEmailHref(attr.value)) {
          continue
        }
        el.removeAttribute(attr.name)
      }

      if (el.tagName === 'A') {
        const href = el.getAttribute('href')
        if (!href || !isSafeEmailHref(href)) {
          const parent = el.parentNode
          if (parent) {
            while (el.firstChild) parent.insertBefore(el.firstChild, el)
            parent.removeChild(el)
          }
          continue
        }
        el.setAttribute('rel', 'noopener noreferrer')
        el.setAttribute('style', 'color: #2563eb;')
      }

      sanitizeNode(el)
    }
  }

  sanitizeNode(template.content)
  return template.innerHTML
}
