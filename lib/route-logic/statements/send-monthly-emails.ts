/**
 * POST /api/statements/send-monthly-emails
 */

import { Types } from 'mongoose'
import { EmailJob, EmailConfig, Organization } from '@/lib/models'
import { previousStatementPeriodBounds } from '@/lib/date-utils'
import { logError } from '@/lib/log'
import { findActiveEmailJob, sweepStaleEmailJobs, kickoffEmailWorker } from '@/lib/email-jobs'
import { checkRateLimit } from '@/lib/rate-limit'
import { EMailableFamilyFilter, familyBatches } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org-or-cron',
  minRole: 'admin',
  name: 'POST /api/statements/send-monthly-emails',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'send-monthly-emails',
      { limit: 3, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    await sweepStaleEmailJobs({
      organizationId: ctx!.organizationId,
      kind: 'statements',
    }).catch((err) => {
      logError(err, {
        module: 'statements/send-monthly-emails',
        phase: 'sweep-stale',
      })
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
    }).select('_id')
    if (!emailConfigDoc) {
      return {
        status: 400,
        data: { error: 'Email configuration not found. Please configure email settings first.' },
      }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('timezone monthlyStatementCalendar')
      .lean<{ timezone?: string; monthlyStatementCalendar?: 'gregorian' | 'hebrew' }>()
    const { fromDate: previousMonth, toDate: lastDayOfPreviousMonth } =
      previousStatementPeriodBounds(org?.monthlyStatementCalendar, org?.timezone)

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
          status: 'completed',
        },
      }
    }

    const userId =
      ctx!.userId && Types.ObjectId.isValid(ctx!.userId) ? ctx!.userId : undefined

    const job = await EmailJob.create({
      organizationId: ctx!.organizationId,
      ...(userId ? { userId } : {}),
      kind: 'statements',
      status: 'queued',
      fromDate: previousMonth,
      toDate: lastDayOfPreviousMonth,
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
      logError(new Error(kickoff.error), {
        module: 'statements/send-monthly-emails',
        jobId: String(job._id),
        phase: 'trigger',
      })
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
        month: previousMonth.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
        }),
      },
    }
  },
})
