/**
 * Full organization data export for backup, migration, and GDPR portability.
 * Sensitive fields (passwords, encrypted secrets) are redacted.
 */

import { Types } from 'mongoose'
import {
  Organization,
  OrgMembership,
  User,
  Family,
  FamilyMember,
  Payment,
  Withdrawal,
  LifecycleEvent,
  LifecycleEventPayment,
  YearlyCalculation,
  Statement,
  EmailConfig,
  CycleConfig,
  CycleCharge,
  SavedPaymentMethod,
  RecurringPayment,
  Task,
  Notification,
  SavedReport,
  AuditLog,
  EmailJob,
  Invite,
  PaymentPlan,
} from '@/lib/models'
import { loadAllByIdCursor } from '@/lib/org-pagination'

const REDACTED = '[REDACTED]'

function serializeDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (key === '__v') continue
    if (value instanceof Types.ObjectId) {
      out[key] = value.toString()
    } else if (value instanceof Date) {
      out[key] = value.toISOString()
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) =>
        v && typeof v === 'object' && !(v instanceof Date)
          ? serializeDoc(v as Record<string, unknown>)
          : v,
      )
    } else if (value && typeof value === 'object') {
      out[key] = serializeDoc(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

function redactEmailConfig(doc: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!doc) return null
  const serialized = serializeDoc(doc)
  if ('password' in serialized) serialized.password = REDACTED
  return serialized
}

function redactOrganization(doc: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!doc) return null
  const serialized = serializeDoc(doc)
  // Stripe IDs are kept for migration reference; no raw secrets on org doc.
  return serialized
}

async function loadOrgCollection<T extends { _id: unknown }>(
  model: { find: (filter: Record<string, unknown>) => unknown },
  organizationId: string,
): Promise<T[]> {
  return loadAllByIdCursor<T>(
    (filter, limit) =>
      (
        model.find(filter) as {
          sort: (s: Record<string, number>) => {
            limit: (n: number) => { lean: () => Promise<T[]> }
          }
        }
      )
        .sort({ _id: 1 })
        .limit(limit)
        .lean(),
    { organizationId: new Types.ObjectId(organizationId) },
  )
}

export interface OrgExportBundle {
  exportedAt: string
  organizationId: string
  version: '1.0'
  organization: Record<string, unknown> | null
  memberships: Record<string, unknown>[]
  users: Record<string, unknown>[]
  paymentPlans: Record<string, unknown>[]
  families: Record<string, unknown>[]
  familyMembers: Record<string, unknown>[]
  payments: Record<string, unknown>[]
  withdrawals: Record<string, unknown>[]
  lifecycleEvents: Record<string, unknown>[]
  lifecycleEventPayments: Record<string, unknown>[]
  yearlyCalculations: Record<string, unknown>[]
  statements: Record<string, unknown>[]
  emailConfig: Record<string, unknown> | null
  cycleConfig: Record<string, unknown> | null
  cycleCharges: Record<string, unknown>[]
  savedPaymentMethods: Record<string, unknown>[]
  recurringPayments: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  notifications: Record<string, unknown>[]
  savedReports: Record<string, unknown>[]
  auditLogs: Record<string, unknown>[]
  emailJobs: Record<string, unknown>[]
  invites: Record<string, unknown>[]
}

export async function buildOrgExportBundle(organizationId: string): Promise<OrgExportBundle> {
  const orgOid = new Types.ObjectId(organizationId)

  const org = await Organization.findById(orgOid).lean<Record<string, unknown>>()

  const memberships = await OrgMembership.find({ organizationId: orgOid }).lean<
    Record<string, unknown>[]
  >()
  const userIds = [...new Set(memberships.map((m) => String(m.userId)))]
  const usersRaw =
    userIds.length > 0
      ? await User.find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
          .select('-password -twoFactorSecret -twoFactorBackupCodes')
          .lean<Record<string, unknown>[]>()
      : []

  const [
    paymentPlans,
    families,
    familyMembers,
    payments,
    withdrawals,
    lifecycleEvents,
    lifecycleEventPayments,
    yearlyCalculations,
    statements,
    emailConfigRaw,
    cycleConfigRaw,
    cycleCharges,
    savedPaymentMethods,
    recurringPayments,
    tasks,
    notifications,
    savedReports,
    auditLogs,
    emailJobs,
    invites,
  ] = await Promise.all([
    loadOrgCollection(PaymentPlan, organizationId),
    loadOrgCollection(Family, organizationId),
    loadOrgCollection(FamilyMember, organizationId),
    loadOrgCollection(Payment, organizationId),
    loadOrgCollection(Withdrawal, organizationId),
    loadOrgCollection(LifecycleEvent, organizationId),
    loadOrgCollection(LifecycleEventPayment, organizationId),
    loadOrgCollection(YearlyCalculation, organizationId),
    loadOrgCollection(Statement, organizationId),
    EmailConfig.findOne({ organizationId: orgOid }).lean<Record<string, unknown>>(),
    CycleConfig.findOne({ organizationId: orgOid }).lean<Record<string, unknown>>(),
    loadOrgCollection(CycleCharge, organizationId),
    loadOrgCollection(SavedPaymentMethod, organizationId),
    loadOrgCollection(RecurringPayment, organizationId),
    loadOrgCollection(Task, organizationId),
    loadOrgCollection(Notification, organizationId),
    loadOrgCollection(SavedReport, organizationId),
    loadOrgCollection(AuditLog, organizationId),
    loadOrgCollection(EmailJob, organizationId),
    loadOrgCollection(Invite, organizationId),
  ])

  return {
    exportedAt: new Date().toISOString(),
    organizationId,
    version: '1.0',
    organization: redactOrganization(org),
    memberships: memberships.map(serializeDoc),
    users: usersRaw.map(serializeDoc),
    paymentPlans: paymentPlans.map(serializeDoc),
    families: families.map(serializeDoc),
    familyMembers: familyMembers.map(serializeDoc),
    payments: payments.map(serializeDoc),
    withdrawals: withdrawals.map(serializeDoc),
    lifecycleEvents: lifecycleEvents.map(serializeDoc),
    lifecycleEventPayments: lifecycleEventPayments.map(serializeDoc),
    yearlyCalculations: yearlyCalculations.map(serializeDoc),
    statements: statements.map(serializeDoc),
    emailConfig: redactEmailConfig(emailConfigRaw),
    cycleConfig: cycleConfigRaw ? serializeDoc(cycleConfigRaw) : null,
    cycleCharges: cycleCharges.map(serializeDoc),
    savedPaymentMethods: savedPaymentMethods.map(serializeDoc),
    recurringPayments: recurringPayments.map(serializeDoc),
    tasks: tasks.map(serializeDoc),
    notifications: notifications.map(serializeDoc),
    savedReports: savedReports.map(serializeDoc),
    auditLogs: auditLogs.map(serializeDoc),
    emailJobs: emailJobs.map(serializeDoc),
    invites: invites.map(serializeDoc),
  }
}
