/**
 * GET /api/search?q=…
 *
 * Cross-resource search for the global header search box. Returns up
 * to a few hits each from Families, FamilyMembers, and Payments,
 * scoped to the current org.
 *
 * Implementation notes:
 *   - We use Mongoose `$regex` with anchored prefixes when possible
 *     (uses the existing `{org, name}` index for Family); for substring
 *     fallback we cap to a small `.limit()` so the collection scan can't
 *     hurt latency.
 *   - All regex inputs are escaped to prevent the user injecting a
 *     pathological pattern (`(.*?)+`) and DoSing us.
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { hasMinRole } from '@/lib/auth-helpers'
import { formatMoney } from '@/lib/currency'
import { netPaymentAmount } from '@/lib/money'
import { getOrgMoneyContext } from '@/lib/money.server'
import { checkRateLimit } from '@/lib/rate-limit'
import { formatLocaleDate } from '@/lib/date-utils'
import { sanitizePaymentNotes } from '@/lib/payments/sanitize'
import { loadByIdsInChunks } from '@/lib/org-pagination'
import { Family, FamilyMember, Payment } from '@/lib/models'

const PER_GROUP = 5
const MAX_TOTAL = 25

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
})

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  query: querySchema,
  name: 'GET /api/search',
  fn: async ({ ctx, query, request }) => {
    const searchLimit =
      process.env.SECURITY_STRICT_RATE_LIMITS === '1' ? 20 : 60
    const rateVerdict = await checkRateLimit(request, 'search', {
      limit: searchLimit,
      windowMs: 60_000,
    }, ctx!.organizationId)
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = new Types.ObjectId(ctx!.organizationId)
    const moneyCtx = await getOrgMoneyContext(String(ctx!.organizationId))
    const rx = new RegExp(escapeRegex(query!.q), 'i')
    const includePayments = hasMinRole(ctx!.role, 'admin')

    const [families, members, payments] = await Promise.all([
      Family.find({
        organizationId: orgId,
        $or: [{ name: rx }, { hebrewName: rx }, { email: rx }],
      })
        .select('_id name hebrewName email')
        .limit(PER_GROUP)
        .lean<any[]>(),
      FamilyMember.find({
        organizationId: orgId,
        $or: [
          { firstName: rx },
          { lastName: rx },
          { hebrewFirstName: rx },
          { hebrewLastName: rx },
          { englishName: rx },
        ],
      })
        .select('_id firstName lastName hebrewFirstName hebrewLastName familyId')
        .limit(PER_GROUP)
        .lean<any[]>(),
      // Payments rarely match on text, but a check number lookup is
      // useful for chasing a specific paper receipt. Skip entirely if
      // the query isn't at least 3 chars — too noisy otherwise.
      //
      // Previously this queried `description`, `reference`, and
      // `checkNumber` directly — none of which exist on the Payment
      // schema (notes + ccInfo.last4 + checkInfo.checkNumber are the
      // real shape). Every payment search silently matched nothing.
      includePayments && query!.q.length >= 3
        ? Payment.find({
            organizationId: orgId,
            $or: [
              { notes: rx },
              { 'checkInfo.checkNumber': rx },
              { 'checkInfo.bankName': rx },
              { 'ccInfo.last4': rx },
            ],
          })
            .select('_id amount notes checkInfo ccInfo familyId paymentDate')
            .sort({ paymentDate: -1 })
            .limit(PER_GROUP)
            .lean<any[]>()
        : Promise.resolve([] as any[]),
    ])

    // Hydrate member -> family name in one batched lookup.
    const familyIdsFromMembers = members
      .map((m) => m.familyId)
      .filter(Boolean)
      .map((id) => id.toString())
    const familyIdsFromPayments = payments
      .map((p) => p.familyId)
      .filter(Boolean)
      .map((id) => id.toString())
    const allRelatedFamilyIds = Array.from(
      new Set([...familyIdsFromMembers, ...familyIdsFromPayments]),
    )
    const relatedFams: Record<string, string> = {}
    if (allRelatedFamilyIds.length) {
      const docs = await loadByIdsInChunks<any>(
        (chunk) =>
          Family.find({ organizationId: orgId, _id: { $in: chunk } })
            .select('_id name')
            .lean<any[]>(),
        allRelatedFamilyIds,
      )
      for (const f of docs) relatedFams[f._id.toString()] = f.name || ''
    }

    const familyResults = families.map((f) => ({
      type: 'family' as const,
      id: f._id.toString(),
      label: f.name,
      sublabel: f.hebrewName || f.email || '',
      href: `/families/${f._id.toString()}`,
    }))

    const memberResults = members.map((m) => {
      const fam = m.familyId ? relatedFams[m.familyId.toString()] : ''
      const fullName = [m.firstName, m.lastName].filter(Boolean).join(' ') ||
        [m.hebrewFirstName, m.hebrewLastName].filter(Boolean).join(' ') ||
        '(unnamed)'
      return {
        type: 'member' as const,
        id: m._id.toString(),
        label: fullName,
        sublabel: fam || 'Family member',
        href: m.familyId ? `/families/${m.familyId.toString()}` : '/families',
      }
    })

    const paymentResults = payments
      .filter((p) => !p.familyId || relatedFams[p.familyId.toString()])
      .map((p) => {
      const fam = p.familyId ? relatedFams[p.familyId.toString()] : ''
      const checkRef = p.checkInfo?.checkNumber ? `Check #${p.checkInfo.checkNumber}` : ''
      const cardRef = p.ccInfo?.last4 ? `••${p.ccInfo.last4}` : ''
      const dateStr = p.paymentDate ? formatLocaleDate(p.paymentDate) : ''
      const safeNotes = sanitizePaymentNotes(p.notes)
      return {
        type: 'payment' as const,
        id: p._id.toString(),
        label: `${formatMoney(netPaymentAmount(p), moneyCtx)} — ${fam || 'payment'}`,
        sublabel: [checkRef || cardRef, safeNotes, dateStr].filter(Boolean).join(' · '),
        href: p.familyId ? `/families/${p.familyId.toString()}` : '/payments',
      }
    })

    const items = [...familyResults, ...memberResults, ...paymentResults].slice(
      0,
      MAX_TOTAL,
    )
    return { data: { items } }
  },
})
