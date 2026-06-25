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
