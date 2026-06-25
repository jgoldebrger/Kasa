import nodemailer from 'nodemailer'

export interface GmailTransportCreds {
  email: string
  password: string
}

export function createGmailTransport(creds: GmailTransportCreds): nodemailer.Transporter {
  // Explicit host/port is more reliable on serverless (Vercel) than `service: 'gmail'`.
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
  })
}

function createFallbackTransport(creds: GmailTransportCreds): nodemailer.Transporter | null {
  const host = process.env.ORG_SMTP_FALLBACK_HOST?.trim()
  if (!host) return null
  const port = parseInt(process.env.ORG_SMTP_FALLBACK_PORT || '587', 10)
  const secure = process.env.ORG_SMTP_FALLBACK_SECURE === 'true'
  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: {
      user: process.env.ORG_SMTP_FALLBACK_USER?.trim() || creds.email,
      pass: process.env.ORG_SMTP_FALLBACK_PASS?.trim() || creds.password,
    },
  })
}

/**
 * Gmail transport with one retry on a fallback SMTP host when
 * `ORG_SMTP_FALLBACK_HOST` is configured and the primary connection fails.
 */
export function createTransportWithFallback(creds: GmailTransportCreds): nodemailer.Transporter {
  const primary = createGmailTransport(creds)
  const fallback = createFallbackTransport(creds)
  if (!fallback) return primary

  const originalSendMail = primary.sendMail.bind(primary)
  primary.sendMail = ((...args: Parameters<typeof originalSendMail>) => {
    const run = async () => {
      try {
        return await originalSendMail(...args)
      } catch (primaryErr) {
        try {
          return await fallback.sendMail(...args)
        } catch {
          throw primaryErr
        }
      }
    }
    const callback = args[args.length - 1]
    if (typeof callback === 'function') {
      run()
        .then((info) => (callback as (err: Error | null, info: unknown) => void)(null, info))
        .catch((err) => (callback as (err: Error | null, info: unknown) => void)(err, null))
      return
    }
    return run()
  }) as typeof primary.sendMail

  return primary
}
