/** Strip whitespace from Gmail app passwords (users often paste with spaces). */
export function normalizeGmailAppPassword(p: string): string {
  return p.replace(/\s+/g, '')
}
