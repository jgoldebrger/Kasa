/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import RecordEventModal from './RecordEventModal'

vi.mock('@/lib/client-cache', () => ({
  cachedFetch: vi.fn().mockResolvedValue([]),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/client/useOrgChanged', () => ({
  useOrgChanged: () => {},
}))

vi.mock('@/lib/client/useCurrency', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))

vi.mock('@/app/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => key,
}))

describe('RecordEventModal smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing when closed', () => {
    const { container } = render(<RecordEventModal open={false} onClose={() => {}} />)
    expect(container).toBeDefined()
  })

  it('renders without crashing when open', () => {
    const { container } = render(<RecordEventModal open onClose={() => {}} />)
    expect(container).toBeDefined()
  })
})
