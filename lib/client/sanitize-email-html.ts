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

function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  return /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)
}

/** Strip unsafe tags/attributes from rich email body HTML. */
export function sanitizeEmailHtml(html: string): string {
  if (!html.trim()) return ''
  if (typeof document === 'undefined') {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '')
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
        if (el.tagName === 'A' && attr.name === 'href' && isSafeHref(attr.value)) {
          continue
        }
        el.removeAttribute(attr.name)
      }

      if (el.tagName === 'A') {
        const href = el.getAttribute('href')
        if (!href || !isSafeHref(href)) {
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
