export type SetupProgressStepId =
  | 'paymentPlans'
  | 'eventTypes'
  | 'email'
  | 'firstFamily'
  | 'firstPayment'

export interface SetupProgressStep {
  id: SetupProgressStepId
  done: boolean
  href: string
}

export interface SetupProgressPayload {
  organizationId: string
  steps: SetupProgressStep[]
  completed: number
  total: number
  complete: boolean
}

import {
  EmailConfig,
  Family,
  LifecycleEvent,
  Payment,
  PaymentPlan,
} from '@/lib/models'

const STEP_DEFS: { id: SetupProgressStepId; href: string }[] = [
  { id: 'paymentPlans', href: '/settings?tab=paymentPlans' },
  { id: 'eventTypes', href: '/settings?tab=eventTypes' },
  { id: 'email', href: '/settings?tab=email' },
  { id: 'firstFamily', href: '/families' },
  { id: 'firstPayment', href: '/families' },
]

export async function loadSetupProgress(organizationId: string): Promise<SetupProgressPayload> {
  const [paymentPlanCount, eventTypeCount, emailConfigured, familyCount, paymentCount] =
    await Promise.all([
      PaymentPlan.countDocuments({ organizationId }),
      LifecycleEvent.countDocuments({ organizationId }),
      EmailConfig.exists({ organizationId, isActive: true }),
      Family.countDocuments({ organizationId }),
      Payment.countDocuments({ organizationId }),
    ])

  const doneById: Record<SetupProgressStepId, boolean> = {
    paymentPlans: paymentPlanCount > 0,
    eventTypes: eventTypeCount > 0,
    email: !!emailConfigured,
    firstFamily: familyCount > 0,
    firstPayment: paymentCount > 0,
  }

  const steps: SetupProgressStep[] = STEP_DEFS.map(({ id, href }) => ({
    id,
    done: doneById[id],
    href,
  }))

  const completed = steps.filter((s) => s.done).length
  const total = steps.length

  return {
    organizationId,
    steps,
    completed,
    total,
    complete: completed === total,
  }
}
