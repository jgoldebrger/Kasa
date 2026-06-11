/** Reflected/stored XSS probe payloads — safe for automated testing (no exfil). */
export const XSS_PAYLOADS = {
  basic: [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "'-alert(1)-'",
    '<svg/onload=alert(1)>',
    'javascript:alert(1)',
  ],
  encoded: [
    '%3Cscript%3Ealert(1)%3C/script%3E',
    '&#60;script&#62;alert(1)&#60;/script&#62;',
    '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
  ],
  dom: [
    '#<img src=x onerror=alert(1)>',
    '?q=<img src=x onerror=alert(1)>',
  ],
  /** Markers that should never appear unescaped in HTML output. */
  markers: ['onerror=alert', '<script>', 'javascript:alert'],
} as const

export const XSS_CANARY = 'sec-xss-canary-7f3a9b2c'

export function xssCanaryPayload(suffix = ''): string {
  return `<img src=x onerror="${XSS_CANARY}${suffix}">`
}

export function assertNoXssReflection(body: string, canary = XSS_CANARY): string[] {
  const issues: string[] = []
  for (const marker of XSS_PAYLOADS.markers) {
    if (body.includes(marker)) issues.push(`Reflected dangerous marker: ${marker}`)
  }
  if (body.includes(canary)) issues.push(`XSS canary reflected: ${canary}`)
  return issues
}
