/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SettingsView from './SettingsView'

describe('SettingsView smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <SettingsView
        initialEmailConfig={{ email: 'admin@example.com', configured: true }}
        initialEventTypes={[
          { _id: 'evt-1', type: 'bar_mitzvah', name: 'Bar Mitzvah', amount: 100 },
        ]}
        initialPaymentPlans={[{ _id: 'plan-1', name: 'Standard', yearlyPrice: 500 }]}
        initialCycleConfig={{ enabled: false }}
        initialCurrentRole="admin"
      />,
    )
    expect(container).toBeDefined()
  })
})
