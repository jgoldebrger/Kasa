/**
 * GET /api/emails/analytics?days=30|90
 *
 * Communications email metrics (kind: custom) over daily buckets.
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { EmailMessage } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

const analyticsQuery = z.object({
  days: z
    .enum(['30', '90'])
    .optional()
    .transform((v) => (v === '90' ? 90 : 30)),
})

const SENT_STATUSES = ['sent', 'opened', 'clicked'] as const

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function buildDayRange(days: number): string[] {
  const out: string[] = []
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(utcDayKey(d))
  }
  return out
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: analyticsQuery,
  name: 'GET /api/emails/analytics',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-analytics',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const days = query?.days ?? 30
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - days)
    since.setUTCHours(0, 0, 0, 0)

    const topCampaignsSince = new Date()
    topCampaignsSince.setUTCDate(topCampaignsSince.getUTCDate() - 30)
    topCampaignsSince.setUTCHours(0, 0, 0, 0)

    const orgOid = new Types.ObjectId(ctx!.organizationId)
    const baseMatch = {
      organizationId: orgOid,
      kind: 'custom',
      createdAt: { $gte: since },
    }

    const [statusAgg, openedAgg, clickedAgg, topCampaignsAgg] = await Promise.all([
      EmailMessage.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              status: '$status',
            },
            count: { $sum: 1 },
          },
        },
      ]),
      EmailMessage.aggregate([
        {
          $match: {
            ...baseMatch,
            $or: [{ status: 'opened' }, { status: 'clicked' }, { openCount: { $gt: 0 } }],
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
      ]),
      EmailMessage.aggregate([
        {
          $match: {
            ...baseMatch,
            $or: [{ status: 'clicked' }, { clickCount: { $gt: 0 } }],
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
      ]),
      EmailMessage.aggregate([
        {
          $match: {
            organizationId: orgOid,
            kind: 'custom',
            campaignId: { $exists: true, $ne: null },
            createdAt: { $gte: topCampaignsSince },
            status: { $in: [...SENT_STATUSES] },
          },
        },
        {
          $group: {
            _id: '$campaignId',
            sent: { $sum: 1 },
            subject: { $first: '$subject' },
          },
        },
        { $sort: { sent: -1 } },
        { $limit: 10 },
      ]),
    ])

    const bucketMap = new Map<
      string,
      { sent: number; opened: number; clicked: number; failed: number }
    >()
    for (const day of buildDayRange(days)) {
      bucketMap.set(day, { sent: 0, opened: 0, clicked: 0, failed: 0 })
    }

    for (const row of statusAgg) {
      const day = String(row._id?.day ?? '')
      const status = String(row._id?.status ?? '')
      const count = row.count ?? 0
      if (!bucketMap.has(day)) continue
      const bucket = bucketMap.get(day)!
      if (status === 'failed') bucket.failed += count
      else if ((SENT_STATUSES as readonly string[]).includes(status)) bucket.sent += count
    }

    for (const row of openedAgg) {
      const day = String(row._id ?? '')
      if (bucketMap.has(day)) bucketMap.get(day)!.opened = row.count ?? 0
    }

    for (const row of clickedAgg) {
      const day = String(row._id ?? '')
      if (bucketMap.has(day)) bucketMap.get(day)!.clicked = row.count ?? 0
    }

    const buckets = buildDayRange(days).map((date) => ({
      date,
      ...bucketMap.get(date)!,
    }))

    const totals = buckets.reduce(
      (acc, b) => ({
        sent: acc.sent + b.sent,
        opened: acc.opened + b.opened,
        clicked: acc.clicked + b.clicked,
        failed: acc.failed + b.failed,
      }),
      { sent: 0, opened: 0, clicked: 0, failed: 0 },
    )

    const delivered = totals.sent
    const rates = {
      openRate: delivered > 0 ? totals.opened / delivered : 0,
      clickRate: delivered > 0 ? totals.clicked / delivered : 0,
      failureRate: delivered + totals.failed > 0 ? totals.failed / (delivered + totals.failed) : 0,
    }

    const topCampaigns = topCampaignsAgg.map((row) => ({
      campaignId: String(row._id),
      subject: row.subject ?? '',
      sent: row.sent ?? 0,
    }))

    return {
      data: {
        days,
        totals: { ...totals, total: delivered + totals.failed },
        rates,
        buckets,
        topCampaigns,
      },
    }
  },
})
