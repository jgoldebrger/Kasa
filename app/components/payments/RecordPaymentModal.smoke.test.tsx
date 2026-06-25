/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import RecordPaymentModal from './RecordPaymentModal'

vi.mock('@/lib/client-cache', () => ({
  cachedFetch: vi.fn().mockResolvedValue({ items: [] }),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/client/useOrgChanged', () => ({
  useOrgChanged: () => {},
}))

vi.mock('@/app/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => key,
}))

describe('RecordPaymentModal smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing when closed', () => {
    const { container } = render(<RecordPaymentModal open={false} onClose={() => {}} />)
    expect(container).toBeDefined()
  })

  it('renders without crashing when open', () => {
    const { container } = render(<RecordPaymentModal open onClose={() => {}} />)
    expect(container).toBeDefined()
  })
})
