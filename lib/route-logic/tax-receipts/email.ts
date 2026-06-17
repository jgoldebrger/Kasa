/**
 * POST /api/tax-receipts/email
 */

import { Types } from 'mongoose'
import { EmailJob, EmailConfig, Payment } from '@/lib/models'
import { findActiveEmailJob, sweepStaleEmailJobs, kickoffEmailWorker } from '@/lib/email-jobs'
import { familyBatches } from '@/lib/org-pagination'
import { checkRateLimit } from '@/lib/rate-limit'
import { membershipDuesYearFilter } from '@/lib/tax-receipts/queries'
import { handler } from '@/lib/api/handler'
import { report as reportSchemas } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: reportSchemas.taxReceiptEmailBody,
  name: 'POST /api/tax-receipts/email',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'tax-receipt-email',
      { limit: 5, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { year: yearNum, familyIds } = body

    await sweepStaleEmailJobs({
      organizationId: ctx!.organizationId,
      kind: 'tax-receipts',
    }).catch((err) => {
      console.error('[tax-receipts/email] sweep failed (continuing):', err)
    })

    const activeJob = await findActiveEmailJob({
      organizationId: ctx!.organizationId,
      kind: 'tax-receipts',
    })
    if (activeJob) {
      return {
        status: 409,
        data: {
          error:
            'A tax-receipt email job is already in progress. Wait for it to finish or poll its status.',
          jobId: String(activeJob._id),
          status: activeJob.status,
        },
      }
    }

    const cfg = await EmailConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })
    if (!cfg) {
      return {
        status: 400,
        data: { error: 'Email configuration not found. Please configure email settings first.' },
      }
    }

    const orgId = new Types.ObjectId(String(ctx!.organizationId))

    const paidAgg = await Payment.aggregate([
      {
        $match: await membershipDuesYearFilter(yearNum, ctx!.organizationId),
      },
      {
        $group: {
          _id: '$familyId',
          total: {
            $sum: {
              $max: [
                0,
                {
                  $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$refundedAmount', 0] }],
                },
              ],
            },
          },
        },
      },
      { $match: { total: { $gt: 0 } } },
    ])
    const paidFamilyIds = new Set(paidAgg.map((r: any) => String(r._id)))

    const baseFilter: Record<string, unknown> = {
      organizationId: orgId,
      emailOptOut: { $ne: true },
      $and: [{ email: { $exists: true } }, { email: { $ne: null } }, { email: { $ne: '' } }],
    }
    if (Array.isArray(familyIds) && familyIds.length > 0) {
      const validIds = familyIds.map((id: string) => new Types.ObjectId(id))
      baseFilter._id = { $in: validIds }
    }

    const { organizationId: _orgId, ...familyExtraFilter } = baseFilter
    const eligible: { _id: unknown }[] = []
    for await (const batch of familyBatches(String(ctx!.organizationId), {
      select: '_id',
      extraFilter: familyExtraFilter,
    })) {
      for (const f of batch) {
        if (paidFamilyIds.has(String(f._id))) eligible.push(f)
      }
    }

    if (eligible.length === 0) {
      return {
        data: {
          message:
            'No eligible families (must have an email on file, not opted out, and at least one dues payment in the year).',
          sent: 0,
          failed: 0,
          totalFamilies: 0,
        },
      }
    }

    const job = await EmailJob.create({
      organizationId: orgId,
      userId: ctx!.userId,
      kind: 'tax-receipts',
      status: 'queued',
      year: yearNum,
      totalFamilies: eligible.length,
      pending: eligible.map((f) => f._id),
      startedAt: new Date(),
    })

    const kickoff = await kickoffEmailWorker({
      request,
      workerPath: '/api/tax-receipts/email/worker',
      jobId: job._id.toString(),
      organizationId: String(ctx!.organizationId),
      body: { jobId: job._id.toString(), organizationId: String(ctx!.organizationId) },
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
        totalFamilies: eligible.length,
        status: 'queued',
      },
    }
  },
})
