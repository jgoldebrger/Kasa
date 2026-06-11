/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => null),
}))

vi.mock('./PricingActions', () => ({
  default: ({ tier }: { tier: string }) => <div data-testid={`pricing-action-${tier}`} />,
}))

import PricingPage from './page'

describe('PricingPage smoke', () => {
  it('renders tier comparison headings', async () => {
    const ui = await PricingPage()
    render(ui)
    expect(screen.getByRole('heading', { name: /simple pricing/i })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Starter' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Community' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Institution' })).toBeDefined()
  })
})
