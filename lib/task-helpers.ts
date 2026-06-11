import { Task, Family } from './models'
import connectDB from './database'
import { notifyAdmins } from './notify'
import { sanitizeStripeErrorMessage } from './payments/sanitize'

/**
 * Create a task when a payment is declined
 */
export async function createPaymentDeclinedTask(
  familyId: string,
  paymentId: string | null,
  amount: number,
  errorMessage: string,
  organizationId: string,
  memberId?: string,
  stripePaymentIntentId?: string,
) {
  void stripePaymentIntentId
  try {
    await connectDB()

    const family = await Family.findOne({ _id: familyId, organizationId }).lean()
    if (!family) {
      console.error(`Family ${familyId} not found (org ${organizationId}) for task creation`)
      return null
    }

    const email = (family as any).email?.trim() || 'no-email-on-file'

    const task = await Task.create({
      organizationId,
      title: `Payment Declined: $${amount.toLocaleString()}`,
      description: `Payment attempt failed for ${(family as any).name || 'Family'}. Error: ${sanitizeStripeErrorMessage(errorMessage)}`,
      dueDate: new Date(),
      email,
      status: 'pending',
      priority: 'high',
      relatedFamilyId: familyId,
      relatedMemberId: memberId || undefined,
      relatedPaymentId: paymentId || undefined,
      notes:
        `Payment amount: $${amount.toLocaleString()}. This task was automatically created due to payment failure.`,
    })

    await notifyAdmins(organizationId, {
      kind: 'payment.failed',
      title: `Payment declined: ${(family as any).name || 'Family'}`,
      body: sanitizeStripeErrorMessage(errorMessage),
      link: '/tasks',
      metadata: {
        familyId,
        paymentId,
        amount,
      },
    })

    return task
  } catch (error: any) {
    console.error('Error creating payment declined task:', error)
    return null
  }
}

