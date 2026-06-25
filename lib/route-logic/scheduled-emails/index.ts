import { ScheduledEmail } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { scheduledEmail as scheduledEmailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/scheduled-emails',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'scheduled-emails-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rows = await ScheduledEmail.find({ organizationId: ctx!.organizationId })
      .sort({ scheduledFor: 1, _id: 1 })
      .limit(200)
      .lean<any[]>()

    return {
      data: {
        scheduledEmails: rows.map((r) => ({
          _id: String(r._id),
          subject: r.subject,
          html: r.html,
          text: r.text ?? null,
          familyIds: (r.familyIds ?? []).map(String),
          scheduledFor: r.scheduledFor,
          status: r.status,
          sentAt: r.sentAt ?? null,
          error: r.error ?? null,
          createdAt: r.createdAt,
        })),
      },
    }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: scheduledEmailSchemas.scheduledEmailBody,
  name: 'POST /api/scheduled-emails',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'scheduled-emails-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    if (body.scheduledFor.getTime() <= Date.now()) {
      return { status: 400, data: { error: 'scheduledFor must be in the future' } }
    }

    const doc = await ScheduledEmail.create({
      organizationId: ctx!.organizationId,
      subject: body.subject,
      html: body.html,
      text: body.text,
      familyIds: body.familyIds,
      scheduledFor: body.scheduledFor,
      status: 'pending',
      createdBy: ctx!.userId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'scheduled_email.create',
      resourceType: 'ScheduledEmail',
      resourceId: doc._id,
      metadata: {
        subject: body.subject,
        familyCount: body.familyIds.length,
        scheduledFor: body.scheduledFor.toISOString(),
      },
      request,
    })

    return {
      status: 201,
      data: {
        _id: String(doc._id),
        subject: doc.subject,
        scheduledFor: doc.scheduledFor,
        status: doc.status,
        familyIds: (doc.familyIds ?? []).map(String),
      },
    }
  },
})
