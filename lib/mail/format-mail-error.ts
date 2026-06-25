/** Operator-facing copy for nodemailer / SMTP failures. */
export function formatMailError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const msg = raw.trim() || 'Unknown mail error'

  if (/invalid login|username and password not accepted|535|534/i.test(msg)) {
    return (
      'Gmail rejected the login. Use a 16-character app password (not your regular Gmail password) ' +
      'and re-save email settings. Generate one at myaccount.google.com/apppasswords.'
    )
  }
  if (/self signed certificate|certificate/i.test(msg)) {
    return `SMTP TLS error: ${msg}`
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return `Could not reach Gmail SMTP (${msg}). Try again in a few minutes.`
  }
  return msg
}
