/**
 * GET /api/admin/ops — platform ops dashboard aggregates (read-only).
 */

import { Types } from 'mongoose'
import { EmailMessage, Organization, User } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { loadSetupProgress } from '@/lib/organizations/setup-progress-data'

export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 7
const MAX_DAYS = 90
const MAX_ROWS = 25
const BOUNCE_RATE_THRESHOLD = 0.1
const MIN_SENDS_FOR_BOUNCE_RATE = 5

export const GET = handler({
  auth: 'admin',
  name: 'GET /api/admin/ops',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-ops', {
      limit: 30,
      windowMs: 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = request.nextUrl
    const daysRaw = Number(url.searchParams.get('days') || DEFAULT_DAYS)
    const days = Math.min(
      MAX_DAYS,
      Math.max(1, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : DEFAULT_DAYS),
    )
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [smtpFailureRows, bounceAggRows, stuckOrgs] = await Promise.all([
      EmailMessage.aggregate<{
        _id: Types.ObjectId
        failedCount: number
        lastFailedAt: Date
        lastError: string | null
      }>([
        { $match: { status: 'failed', createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$organizationId',
            failedCount: { $sum: 1 },
            lastFailedAt: { $max: '$createdAt' },
            lastError: { $last: '$error' },
          },
        },
        { $sort: { failedCount: -1, lastFailedAt: -1 } },
        { $limit: MAX_ROWS },
      ]),
      EmailMessage.aggregate<{
        _id: Types.ObjectId
        sentCount: number
        bouncedCount: number
      }>([
        {
          $match: {
            createdAt: { $gte: since },
            status: { $in: ['sent', 'opened', 'clicked', 'bounced'] },
          },
        },
        {
          $group: {
            _id: '$organizationId',
            sentCount: {
              $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 0, 1] },
            },
            bouncedCount: {
              $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] },
            },
          },
        },
        {
          $match: {
            bouncedCount: { $gt: 0 },
            $expr: {
              $gte: [{ $add: ['$sentCount', '$bouncedCount'] }, MIN_SENDS_FOR_BOUNCE_RATE],
            },
          },
        },
      ]),
      Organization.find({ setupCompletedAt: null })
        .sort({ createdAt: -1 })
        .limit(MAX_ROWS)
        .select('name slug ownerId createdAt setupCompletedAt')
        .lean<
          {
            _id: Types.ObjectId
            name?: string
            slug?: string
            ownerId?: Types.ObjectId
            createdAt?: Date
          }[]
        >(),
    ])

    const orgIds = [
      ...new Set([
        ...smtpFailureRows.map((r) => String(r._id)),
        ...bounceAggRows
          .filter((r) => {
            const total = r.sentCount + r.bouncedCount
            return total > 0 && r.bouncedCount / total >= BOUNCE_RATE_THRESHOLD
          })
          .map((r) => String(r._id)),
        ...stuckOrgs.map((o) => String(o._id)),
      ]),
    ]

    const orgDocs =
      orgIds.length > 0
        ? await Organization.find({ _id: { $in: orgIds } })
            .select('name slug')
            .lean<{ _id: Types.ObjectId; name?: string; slug?: string }[]>()
        : []
    const orgById = new Map(orgDocs.map((o) => [String(o._id), o]))

    const smtpFailures = smtpFailureRows.map((row) => {
      const org = orgById.get(String(row._id))
      return {
        organizationId: String(row._id),
        organizationName: org?.name || '',
        organizationSlug: org?.slug || '',
        failedCount: row.failedCount,
        lastFailedAt: row.lastFailedAt,
        lastError: row.lastError || null,
      }
    })

    const highBounceRate = bounceAggRows
      .map((row) => {
        const total = row.sentCount + row.bouncedCount
        const bounceRate = total > 0 ? row.bouncedCount / total : 0
        return { row, total, bounceRate }
      })
      .filter(
        ({ bounceRate, total }) =>
          total >= MIN_SENDS_FOR_BOUNCE_RATE && bounceRate >= BOUNCE_RATE_THRESHOLD,
      )
      .sort((a, b) => b.bounceRate - a.bounceRate)
      .slice(0, MAX_ROWS)
      .map(({ row, total, bounceRate }) => {
        const org = orgById.get(String(row._id))
        return {
          organizationId: String(row._id),
          organizationName: org?.name || '',
          organizationSlug: org?.slug || '',
          sentCount: row.sentCount,
          bouncedCount: row.bouncedCount,
          totalSends: total,
          bounceRate: Math.round(bounceRate * 1000) / 10,
        }
      })

    const ownerIds = [...new Set(stuckOrgs.map((o) => String(o.ownerId)).filter(Boolean))]
    const owners =
      ownerIds.length > 0
        ? await User.find({ _id: { $in: ownerIds } })
            .select('name email')
            .lean<{ _id: Types.ObjectId; name?: string; email?: string }[]>()
        : []
    const ownerById = new Map(owners.map((o) => [String(o._id), o]))

    const stuckOnboarding = await Promise.all(
      stuckOrgs.map(async (org) => {
        const progress = await loadSetupProgress(String(org._id))
        const owner = org.ownerId ? ownerById.get(String(org.ownerId)) : undefined
        const createdAt = org.createdAt ? new Date(org.createdAt) : null
        const daysSinceCreated =
          createdAt && !Number.isNaN(createdAt.getTime())
            ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
            : null
        return {
          organizationId: String(org._id),
          organizationName: org.name || '',
          organizationSlug: org.slug || '',
          ownerName: owner?.name || '',
          ownerEmail: owner?.email || '',
          daysSinceCreated,
          setupProgress: progress,
        }
      }),
    )

    return {
      data: {
        days,
        smtpFailures,
        highBounceRate,
        stuckOnboarding,
      },
    }
  },
})
