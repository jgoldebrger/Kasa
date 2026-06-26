import { EmailConfig } from '@/lib/models'
import { safeDecrypt, decryptFailureMessage } from '@/lib/encryption'
import { sanitizeFromName } from '@/lib/email-from-name'
import { normalizeGmailAppPassword } from '@/lib/mail/normalize-app-password'

export interface OrgEmailConfigCreds {
  email: string
  password: string
  fromName: string
  replyTo?: string
}

export type LoadOrgEmailConfigResult =
  | { ok: true; config: OrgEmailConfigCreds }
  | { ok: false; error: string; status: 400 | 500 }

export async function loadOrgEmailConfig(
  organizationId: string,
): Promise<LoadOrgEmailConfigResult> {
  const doc = await EmailConfig.findOne({ isActive: true, organizationId })
  if (!doc) {
    return {
      ok: false,
      status: 400,
      error: 'Email configuration not found. Please configure email settings first.',
    }
  }
  const decrypted = safeDecrypt(doc.password)
  if (!decrypted.ok) {
    return { ok: false, status: 500, error: decryptFailureMessage(decrypted.reason) }
  }
  if (!decrypted.value.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Email password is missing. Re-save your Gmail app password in settings.',
    }
  }
  return {
    ok: true,
    config: {
      email: doc.email,
      password: normalizeGmailAppPassword(decrypted.value),
      fromName: sanitizeFromName(doc.fromName),
      replyTo: doc.replyTo?.trim() || undefined,
    },
  }
}
