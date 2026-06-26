import nodemailer from 'nodemailer'
import { normalizeGmailAppPassword } from './normalize-app-password'

export interface GmailTransportCreds {
  email: string
  password: string
}

const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
} as const

export function normalizeTransportCreds(creds: GmailTransportCreds): GmailTransportCreds {
  return {
    email: creds.email.trim(),
    password: normalizeGmailAppPassword(creds.password),
  }
}

export function createGmailTransport(
  creds: GmailTransportCreds,
  opts: { port?: 465 | 587 } = {},
): nodemailer.Transporter {
  const normalized = normalizeTransportCreds(creds)
  const port = opts.port ?? 465
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: normalized.email, pass: normalized.password },
    ...SMTP_TIMEOUTS,
  })
}

/** Verify Gmail SMTP credentials, trying port 465 then 587 (Vercel-friendly). */
export async function verifyGmailCreds(creds: GmailTransportCreds): Promise<void> {
  let lastErr: unknown
  for (const port of [465, 587] as const) {
    try {
      await createGmailTransport(creds, { port }).verify()
      return
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

function createFallbackTransport(creds: GmailTransportCreds): nodemailer.Transporter | null {
  const host = process.env.ORG_SMTP_FALLBACK_HOST?.trim()
  if (!host) return null
  const port = parseInt(process.env.ORG_SMTP_FALLBACK_PORT || '587', 10)
  const secure = process.env.ORG_SMTP_FALLBACK_SECURE === 'true'
  const normalized = normalizeTransportCreds(creds)
  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: {
      user: process.env.ORG_SMTP_FALLBACK_USER?.trim() || normalized.email,
      pass: process.env.ORG_SMTP_FALLBACK_PASS?.trim() || normalized.password,
    },
    ...SMTP_TIMEOUTS,
  })
}

function wrapSendMailWithFallback(
  facade: nodemailer.Transporter,
  senders: Array<nodemailer.Transporter['sendMail']>,
): nodemailer.Transporter {
  const originalSendMail = facade.sendMail.bind(facade)
  facade.sendMail = ((...args: Parameters<typeof originalSendMail>) => {
    const run = async () => {
      let lastErr: unknown
      for (const send of senders) {
        try {
          return await send(...args)
        } catch (err) {
          lastErr = err
        }
      }
      throw lastErr
    }
    const callback = args[args.length - 1]
    if (typeof callback === 'function') {
      run()
        .then((info) => (callback as (err: Error | null, info: unknown) => void)(null, info))
        .catch((err) => (callback as (err: Error | null, info: unknown) => void)(err, null))
      return
    }
    return run()
  }) as typeof facade.sendMail
  return facade
}

/**
 * Gmail transport with automatic port 587 retry and optional env fallback host.
 * Port 465 SSL often times out on serverless; 587 STARTTLS is more reliable.
 */
export function createTransportWithFallback(creds: GmailTransportCreds): nodemailer.Transporter {
  const normalized = normalizeTransportCreds(creds)
  const chain: nodemailer.Transporter[] = [
    createGmailTransport(normalized, { port: 465 }),
    createGmailTransport(normalized, { port: 587 }),
  ]
  const envFallback = createFallbackTransport(normalized)
  if (envFallback) chain.push(envFallback)

  const facade = chain[0]
  return wrapSendMailWithFallback(
    facade,
    chain.map((t) => t.sendMail.bind(t)),
  )
}
