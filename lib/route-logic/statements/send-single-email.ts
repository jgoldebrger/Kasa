import { EmailConfig, Statement } from '@/lib/models'
import { safeDecrypt, decryptFailureMessage } from '@/lib/encryption'
import { sanitizeFromName } from '@/lib/email-from-name'
import { sendOneFamilyStatement } from '@/lib/statements/send-statement'
import { checkRateLimit } from '@/lib/rate-limit'
import { statement as statementSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: statementSchemas.statementSendSingleEmailBody,
  name: 'POST /api/statements/send-single-email',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'send-single-email',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const statementId = body.statement._id

    const dbStatement = await Statement.findOne({
      _id: statementId,
      organizationId: ctx!.organizationId,
    })
    if (!dbStatement) {
      return { status: 404, data: { error: 'Statement not found' } }
    }

    const emailConfigDoc = await EmailConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })
    if (!emailConfigDoc) {
      return {
        status: 400,
        data: { error: 'Email configuration not found. Please configure email settings first.' },
      }
    }

    const decrypted = safeDecrypt(emailConfigDoc.password)
    if (!decrypted.ok) {
      return { status: 500, data: { error: decryptFailureMessage(decrypted.reason) } }
    }

    const result = await sendOneFamilyStatement({
      organizationId: ctx!.organizationId,
      familyId: dbStatement.familyId.toString(),
      fromDate: dbStatement.fromDate,
      toDate: dbStatement.toDate,
      config: {
        email: emailConfigDoc.email,
        password: decrypted.value,
        fromName: sanitizeFromName(emailConfigDoc.fromName),
      },
    })

    if (!result.ok) {
      return {
        status: 500,
        data: { error: result.error || 'Failed to send statement email' },
      }
    }

    return {
      data: {
        message: 'Statement sent successfully',
        sent: true,
        email: result.email,
      },
    }
  },
})
