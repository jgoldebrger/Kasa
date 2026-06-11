/** Strip CR/LF, quotes, and cap length so SMTP From headers cannot be injected. */
export function sanitizeFromName(input: string | undefined | null): string {
  const cleaned = String(input ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .trim()
    .slice(0, 120)
  return cleaned || 'Kasa Family Management'
}
