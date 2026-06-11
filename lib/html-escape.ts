/**
 * Escape an arbitrary value for safe interpolation into HTML *text* / attribute
 * contexts. Use whenever rendering user-controlled data via document.write,
 * innerHTML, or any string-based HTML template.
 *
 * Not a substitute for proper DOM APIs (`textContent`, React's JSX), but
 * adequate for our print-window flows where we already build an HTML string.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
