export type SetupProgressStepId =
  | 'paymentPlans'
  | 'eventTypes'
  | 'email'
  | 'cycle'
  | 'stripeConnect'
  | 'firstFamily'
  | 'firstPayment'

export interface SetupProgressStep {
  id: SetupProgressStepId
  done: boolean
  href: string
  optional?: boolean
}

export interface SetupProgressPayload {
  organizationId: string
  steps: SetupProgressStep[]
  completed: number
  total: number
  complete: boolean
  /** True when the three core setup steps (plans, events, email) are done. */
  requiredComplete: boolean
  canDismiss: boolean
}

import {
  CycleConfig,
  EmailConfig,
  Family,
  LifecycleEvent,
  Organization,
  Payment,
  PaymentPlan,
} from '@/lib/models'

const REQUIRED_STEP_IDS: SetupProgressStepId[] = ['paymentPlans', 'eventTypes', 'email']

const STEP_DEFS: { id: SetupProgressStepId; href: string; optional?: boolean }[] = [
  { id: 'paymentPlans', href: '/settings?tab=paymentPlans' },
  { id: 'eventTypes', href: '/settings?tab=eventTypes' },
  { id: 'email', href: '/settings?tab=email' },
  { id: 'cycle', href: '/settings?tab=cycle', optional: true },
  { id: 'stripeConnect', href: '/settings?tab=billing', optional: true },
  { id: 'firstFamily', href: '/families', optional: true },
  { id: 'firstPayment', href: '/families', optional: true },
]

export async function loadSetupProgress(organizationId: string): Promise<SetupProgressPayload> {
  const [
    paymentPlanCount,
    eventTypeCount,
    emailConfigured,
    cycleConfigured,
    orgStripeConnect,
    familyCount,
    paymentCount,
  ] = await Promise.all([
    PaymentPlan.countDocuments({ organizationId }),
    LifecycleEvent.countDocuments({ organizationId }),
    EmailConfig.exists({ organizationId, isActive: true }),
    CycleConfig.exists({ organizationId, isActive: true }),
    Organization.findById(organizationId)
      .select('stripeConnectAccountId stripeConnectChargesEnabled')
      .lean<{ stripeConnectAccountId?: string | null; stripeConnectChargesEnabled?: boolean }>(),
    Family.countDocuments({ organizationId }),
    Payment.countDocuments({ organizationId }),
  ])

  const doneById: Record<SetupProgressStepId, boolean> = {
    paymentPlans: paymentPlanCount > 0,
    eventTypes: eventTypeCount > 0,
    email: !!emailConfigured,
    cycle: !!cycleConfigured,
    // Complete when org has linked Connect with charges enabled.
    stripeConnect: Boolean(
      orgStripeConnect?.stripeConnectAccountId && orgStripeConnect?.stripeConnectChargesEnabled,
    ),
    firstFamily: familyCount > 0,
    firstPayment: paymentCount > 0,
  }

  const steps: SetupProgressStep[] = STEP_DEFS.map(({ id, href, optional }) => ({
    id,
    done: doneById[id],
    href,
    optional,
  }))

  const completed = steps.filter((s) => s.done).length
  const total = steps.length
  const requiredComplete = REQUIRED_STEP_IDS.every((id) => doneById[id])

  return {
    organizationId,
    steps,
    completed,
    total,
    complete: completed === total,
    requiredComplete,
    canDismiss: requiredComplete,
  }
}
