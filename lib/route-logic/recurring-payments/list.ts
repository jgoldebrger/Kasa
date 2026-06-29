import { Types } from 'mongoose'
import { Family, Organization, Payment, RecurringPayment, Task } from '@/lib/models'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { startOfDayInTimeZone } from '@/lib/date-utils'
import { ORG_CONNECT_WITH_TIMEZONE_SELECT } from '@/lib/stripe/client'

export type RecurringLastStatus = 'success' | 'failed' | 'overdue' | 'scheduled'

export interface RecurringPaymentListItem {
  _id: string
  familyId: {
    _id: string
    name: string
    email?: string
    deletedAt?: string | null
  } | null
  amount: number
  frequency: string
  startDate: string
  nextPaymentDate: string
  isActive: boolean
  notes?: string
  savedPaymentMethod: {
    _id: string
    last4: string
    cardType: string
    expiryMonth: number
    expiryYear: number
    nameOnCard?: string
    isActive: boolean
    isDefault?: boolean
    legacyPlatformAccount?: boolean
  } | null
  lastStatus: RecurringLastStatus
  lastStatusAt?: string
  lastError?: string
  isOverdue: boolean
}

export interface FailedRecurringChargeItem {
  recurringPaymentId: string
  familyId: string
  familyName: string
  amount: number
  nextPaymentDate: string
  savedPaymentMethodId: string
  cardLabel: string
  lastError?: string
  taskId?: string
}

export interface ListRecurringPaymentsResult {
  recurringPayments: RecurringPaymentListItem[]
  failedQueue: FailedRecurringChargeItem[]
}

function serializeFamily(family: unknown): RecurringPaymentListItem['familyId'] {
  if (!family || typeof family !== 'object' || !('_id' in family)) return null
  const f = family as {
    _id: Types.ObjectId | string
    name?: string
    email?: string
    deletedAt?: Date | string | null
  }
  return {
    _id: String(f._id),
    name: f.name ?? 'Unknown',
    email: f.email,
    deletedAt: f.deletedAt ? new Date(f.deletedAt as string | Date).toISOString() : null,
  }
}

function serializeSavedMethod(method: unknown): RecurringPaymentListItem['savedPaymentMethod'] {
  if (!method || typeof method !== 'object' || !('_id' in method)) return null
  const m = method as {
    _id: Types.ObjectId | string
    last4?: string
    cardType?: string
    expiryMonth?: number
    expiryYear?: number
    nameOnCard?: string
    isActive?: boolean
    isDefault?: boolean
    legacyPlatformAccount?: boolean
  }
  return {
    _id: String(m._id),
    last4: m.last4 ?? '????',
    cardType: m.cardType ?? 'Card',
    expiryMonth: m.expiryMonth ?? 0,
    expiryYear: m.expiryYear ?? 0,
    nameOnCard: m.nameOnCard,
    isActive: m.isActive !== false,
    isDefault: m.isDefault,
    legacyPlatformAccount: m.legacyPlatformAccount,
  }
}

function cardLabel(method: RecurringPaymentListItem['savedPaymentMethod']): string {
  if (!method) return '—'
  return `${method.cardType} •••• ${method.last4}`
}

function deriveLastStatus(
  isOverdue: boolean,
  lastPaymentDate: Date | null,
  nextPaymentDate: Date,
  pendingDeclineError?: string,
): { lastStatus: RecurringLastStatus; lastStatusAt?: string; lastError?: string } {
  if (isOverdue) {
    return {
      lastStatus: pendingDeclineError ? 'failed' : 'overdue',
      lastStatusAt: nextPaymentDate.toISOString(),
      lastError: pendingDeclineError,
    }
  }
  if (lastPaymentDate) {
    return {
      lastStatus: 'success',
      lastStatusAt: lastPaymentDate.toISOString(),
    }
  }
  return { lastStatus: 'scheduled' }
}

export async function listRecurringPaymentsForOrg(
  organizationId: string,
  opts?: { familyId?: string; activeOnly?: boolean },
): Promise<ListRecurringPaymentsResult> {
  const activeOnly = opts?.activeOnly !== false
  const query: Record<string, unknown> = { organizationId }
  if (opts?.familyId) query.familyId = opts.familyId
  if (activeOnly) query.isActive = true

  const org = await Organization.findById(organizationId)
    .select(ORG_CONNECT_WITH_TIMEZONE_SELECT)
    .lean<{ timezone?: string }>()
  const today = startOfDayInTimeZone(org?.timezone)

  const rows = await collectCompoundCursorPages<{
    _id: Types.ObjectId
    familyId?: unknown
    savedPaymentMethodId?: unknown
    amount: number
    frequency?: string
    startDate?: Date
    nextPaymentDate?: Date
    isActive?: boolean
    notes?: string
  }>(
    (filter, limit) =>
      RecurringPayment.find(filter)
        .populate({
          path: 'familyId',
          select: 'name email organizationId deletedAt',
          match: { organizationId },
          options: { includeDeleted: true },
        })
        .populate({
          path: 'savedPaymentMethodId',
          select:
            'last4 cardType expiryMonth expiryYear nameOnCard isDefault isActive organizationId legacyPlatformAccount',
          match: { organizationId },
        })
        .sort({ nextPaymentDate: 1, _id: 1 })
        .limit(limit)
        .lean()
        .exec() as Promise<
        Array<{
          _id: Types.ObjectId
          familyId?: unknown
          savedPaymentMethodId?: unknown
          amount: number
          frequency?: string
          startDate?: Date
          nextPaymentDate?: Date
          isActive?: boolean
          notes?: string
        }>
      >,
    query,
    'nextPaymentDate',
    1,
    (last) => ({
      v: last.nextPaymentDate ? new Date(last.nextPaymentDate).getTime() : null,
      id: String(last._id),
    }),
  )

  const recurringIds = rows.map((r) => r._id)
  const familyIds = rows
    .map((r) => serializeFamily(r.familyId)?._id)
    .filter((id): id is string => !!id)

  const [lastPayments, declineTasks] = await Promise.all([
    recurringIds.length > 0
      ? Payment.aggregate<{ _id: Types.ObjectId; paymentDate: Date }>([
          {
            $match: {
              organizationId: new Types.ObjectId(organizationId),
              recurringPaymentId: { $in: recurringIds },
              deletedAt: null,
            },
          },
          { $sort: { paymentDate: -1 } },
          {
            $group: {
              _id: '$recurringPaymentId',
              paymentDate: { $first: '$paymentDate' },
            },
          },
        ])
      : Promise.resolve([]),
    familyIds.length > 0
      ? Task.find({
          organizationId,
          relatedFamilyId: { $in: familyIds },
          status: { $in: ['pending', 'in_progress'] },
          title: /^Payment Declined/,
        })
          .sort({ createdAt: -1 })
          .select('_id relatedFamilyId description')
          .lean<
            Array<{
              _id: Types.ObjectId
              relatedFamilyId?: Types.ObjectId
              description?: string
            }>
          >()
      : Promise.resolve([]),
  ])

  const lastPaymentByRecurring = new Map(lastPayments.map((p) => [String(p._id), p.paymentDate]))
  const declineByFamily = new Map<string, { taskId: string; error?: string }>()
  for (const task of declineTasks) {
    const fid = task.relatedFamilyId ? String(task.relatedFamilyId) : ''
    if (!fid || declineByFamily.has(fid)) continue
    const match = task.description?.match(/Error:\s*(.+)$/i)
    declineByFamily.set(fid, {
      taskId: String(task._id),
      error: match?.[1]?.trim(),
    })
  }

  const recurringPayments: RecurringPaymentListItem[] = rows.map((row) => {
    const family = serializeFamily(row.familyId)
    const savedPaymentMethod = serializeSavedMethod(row.savedPaymentMethodId)
    const nextPaymentDate = row.nextPaymentDate ? new Date(row.nextPaymentDate) : new Date()
    const isOverdue = row.isActive !== false && nextPaymentDate <= today
    const familyDecline = family?._id ? declineByFamily.get(family._id) : undefined
    const lastPaymentDate = lastPaymentByRecurring.get(String(row._id)) ?? null
    const status = deriveLastStatus(
      isOverdue,
      lastPaymentDate,
      nextPaymentDate,
      familyDecline?.error,
    )

    return {
      _id: String(row._id),
      familyId: family,
      amount: row.amount,
      frequency: row.frequency ?? 'monthly',
      startDate: row.startDate
        ? new Date(row.startDate).toISOString()
        : nextPaymentDate.toISOString(),
      nextPaymentDate: nextPaymentDate.toISOString(),
      isActive: row.isActive !== false,
      notes: row.notes,
      savedPaymentMethod,
      lastStatus: status.lastStatus,
      lastStatusAt: status.lastStatusAt,
      lastError: status.lastError,
      isOverdue,
    }
  })

  const failedQueue: FailedRecurringChargeItem[] = recurringPayments
    .filter((r) => r.isOverdue && r.familyId && !r.familyId.deletedAt)
    .map((r) => {
      const decline = r.familyId?._id ? declineByFamily.get(r.familyId._id) : undefined
      return {
        recurringPaymentId: r._id,
        familyId: r.familyId!._id,
        familyName: r.familyId!.name,
        amount: r.amount,
        nextPaymentDate: r.nextPaymentDate,
        savedPaymentMethodId: r.savedPaymentMethod?._id ?? '',
        cardLabel: cardLabel(r.savedPaymentMethod),
        lastError: r.lastError ?? decline?.error,
        taskId: decline?.taskId,
      }
    })
    .filter((r) => r.savedPaymentMethodId)

  return { recurringPayments, failedQueue }
}

export async function validateRecurringFamilyFilter(
  organizationId: string,
  familyId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!Types.ObjectId.isValid(familyId)) {
    return { ok: false, status: 400, error: 'Invalid familyId' }
  }
  const fam = await Family.findOne({ _id: familyId, organizationId }).select('_id')
  if (!fam) {
    return { ok: false, status: 404, error: 'Family not found' }
  }
  return { ok: true }
}
