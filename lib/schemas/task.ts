import { z } from 'zod'
import { isoDate, objectId, optionalString, trimmedName } from './common'

const assigneeEmail = z.string().trim().toLowerCase().email().max(254)

const taskFields = {
  title: trimmedName,
  description: optionalString(2000),
  dueDate: isoDate,
  /** Legacy: free-text notification email. Prefer assigneeMembershipId for new tasks. */
  email: assigneeEmail.optional(),
  assigneeUserId: objectId.optional().nullable(),
  assigneeMembershipId: objectId.optional().nullable(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  relatedFamilyId: objectId.optional().nullable(),
  relatedMemberId: objectId.optional().nullable(),
  relatedPaymentId: objectId.optional().nullable(),
  notes: optionalString(2000),
}

export const taskBody = z.object(taskFields).superRefine((data, ctx) => {
  const hasAssignee = Boolean(data.assigneeMembershipId || data.assigneeUserId)
  const hasEmail = Boolean(data.email)
  if (!hasAssignee && !hasEmail) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Assignee or email is required',
      path: ['assigneeMembershipId'],
    })
  }
})

export const taskUpdateBody = z.object(taskFields).partial().extend({
  completedAt: isoDate.optional().nullable(),
})

export type TaskBodyInput = z.infer<typeof taskBody>
