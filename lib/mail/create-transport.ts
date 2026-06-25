import nodemailer from 'nodemailer'

export interface GmailTransportCreds {
  email: string
  password: string
}

export function createGmailTransport(creds: GmailTransportCreds): nodemailer.Transporter {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: creds.email, pass: creds.password },
  })
}
