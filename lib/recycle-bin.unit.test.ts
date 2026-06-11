import { describe, expect, it } from 'vitest'
import { RECYCLABLE_MODELS } from './recycle-bin'

describe('RECYCLABLE_MODELS.describe', () => {
  it('formats labels for all recyclable kinds', () => {
    expect(RECYCLABLE_MODELS.family.describe({ name: 'Cohen' })).toBe('Cohen')
    expect(RECYCLABLE_MODELS.family.describe({})).toBe('Unnamed family')

    expect(
      RECYCLABLE_MODELS.familyMember.describe({ firstName: 'Avi', lastName: 'Katz' }),
    ).toBe('Avi Katz')
    expect(RECYCLABLE_MODELS.familyMember.describe({})).toBe('Unnamed member')

    expect(
      RECYCLABLE_MODELS.payment.describe({
        amount: 100,
        refundedAmount: 20,
        paymentDate: new Date('2024-03-01'),
      }),
    ).toBe('$80 on 2024-03-01')
    expect(RECYCLABLE_MODELS.payment.describe({ amount: 50 })).toBe('$50')

    expect(RECYCLABLE_MODELS.statement.describe({ statementNumber: 'S-12' })).toBe('S-12')
    expect(RECYCLABLE_MODELS.statement.describe({})).toBe('Statement')

    expect(RECYCLABLE_MODELS.task.describe({ title: 'Call' })).toBe('Call')
    expect(RECYCLABLE_MODELS.task.describe({})).toBe('Untitled task')

    expect(RECYCLABLE_MODELS.lifecycleEvent.describe({ name: 'Wedding' })).toBe('Wedding')
    expect(RECYCLABLE_MODELS.lifecycleEvent.describe({ type: 'bar_mitzvah' })).toBe(
      'bar_mitzvah',
    )

    expect(
      RECYCLABLE_MODELS.lifecycleEventPayment.describe({
        eventType: 'wedding',
        eventDate: new Date('2024-06-15'),
      }),
    ).toBe('wedding — 2024-06-15')
    expect(RECYCLABLE_MODELS.lifecycleEventPayment.describe({ eventType: 'bm' })).toBe('bm')

    expect(RECYCLABLE_MODELS.paymentPlan.describe({ name: 'Gold' })).toBe('Gold')

    expect(
      RECYCLABLE_MODELS.withdrawal.describe({
        amount: 25,
        withdrawalDate: new Date('2024-01-10'),
      }),
    ).toBe('$25 on 2024-01-10')

    expect(
      RECYCLABLE_MODELS.cycleCharge.describe({
        amount: 500,
        cycleYear: 2024,
        chargeDate: new Date('2024-09-01'),
      }),
    ).toBe('$500 (cycle 2024) on 2024-09-01')
  })
})
