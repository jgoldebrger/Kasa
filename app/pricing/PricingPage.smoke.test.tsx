/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PublicPlan } from '@/lib/billing/public-plans'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) =>
    (
      ({
        'pricing.hero.title': 'Simple pricing for every kehilla',
        'welcome.brand': 'Kasa',
        'pricing.backToHome': 'Back to home',
        'pricing.hero.subtitle': 'Subtitle',
        'pricing.institutionNote': 'Institution note',
        'pricing.contactUs': 'Contact us',
        'pricing.customQuote': 'Custom quote',
        'auth.signIn': 'Sign in',
      }) as Record<string, string>
    )[key] ?? key,
}))

vi.mock('./PricingActions', () => ({
  default: ({ tier }: { tier: string }) => <div data-testid={`pricing-action-${tier}`} />,
}))

import PricingPageClient from './PricingPageClient'

const mockPlans: PublicPlan[] = [
  {
    tier: 'starter',
    name: 'Starter',
    description: 'Small kehilla',
    highlights: ['Up to 75 families'],
    familyCap: 75,
    priceLabel: '$49/mo',
    interval: 'month',
    available: true,
  },
  {
    tier: 'community',
    name: 'Community',
    description: 'Growing community',
    highlights: ['Up to 300 families'],
    familyCap: 300,
    priceLabel: '$149/mo',
    interval: 'month',
    available: true,
  },
  {
    tier: 'institution',
    name: 'Institution',
    description: 'Large org',
    highlights: ['Unlimited families'],
    familyCap: null,
    priceLabel: 'Custom',
    interval: null,
    available: true,
  },
]

describe('PricingPageClient smoke', () => {
  it('renders tier comparison headings from dynamic plans', () => {
    render(<PricingPageClient initialPlans={mockPlans} />)
    expect(screen.getByRole('heading', { name: /simple pricing/i })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Starter' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Community' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Institution' })).toBeDefined()
    expect(screen.getByText('$49/mo')).toBeDefined()
  })
})
