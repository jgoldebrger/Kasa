/**
 * POST /api/statements/send-emails
 */

import { EmailJob, EmailConfig } from '@/lib/models'
import { statement as statementSchemas } from '@/lib/schemas'
import { findActiveEmailJob, sweepStaleEmailJobs, kickoffEmailWorker } from '@/lib/email-jobs'
import { checkRateLimit } from '@/lib/rate-limit'
import { EMailableFamilyFilter, familyBatches } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: statementSchemas.statementSendEmailsBody,
  name: 'POST /api/statements/send-emails',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'send-statement-emails',
      { limit: 5, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { fromDate: from, toDate: to } = body

    await sweepStaleEmailJobs({
      organizationId: ctx!.organizationId,
      kind: 'statements',
    })

    const activeJob = await findActiveEmailJob({
      organizationId: ctx!.organizationId,
      kind: 'statements',
    })
    if (activeJob) {
      return {
        status: 409,
        data: {
          error:
            'A statement email job is already in progress. Wait for it to finish or poll its status.',
          jobId: String(activeJob._id),
          status: activeJob.status,
        },
      }
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

    const families: { _id: unknown }[] = []
    for await (const batch of familyBatches(ctx!.organizationId, {
      select: '_id',
      extraFilter: EMailableFamilyFilter,
    })) {
      families.push(...batch)
    }

    if (families.length === 0) {
      return {
        data: {
          message: 'No families with email addresses found',
          sent: 0,
          failed: 0,
          totalFamilies: 0,
        },
      }
    }

    const job = await EmailJob.create({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      kind: 'statements',
      status: 'queued',
      fromDate: from,
      toDate: to,
      totalFamilies: families.length,
      pending: families.map((f) => f._id),
      startedAt: new Date(),
    })

    const kickoff = await kickoffEmailWorker({
      request,
      workerPath: '/api/statements/send-emails/worker',
      jobId: job._id.toString(),
      organizationId: ctx!.organizationId,
      body: { jobId: job._id.toString(), organizationId: ctx!.organizationId },
    })
    if (!kickoff.ok) {
      return {
        status: 500,
        data: { error: 'Failed to start email worker', jobId: job._id.toString() },
      }
    }

    return {
      status: 202,
      data: {
        jobId: job._id.toString(),
        totalFamilies: families.length,
        status: 'queued',
      },
    }
  },
})
