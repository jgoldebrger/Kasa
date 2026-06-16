/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import FamiliesView from './FamiliesView'
import { FAMILIES_LIST_PAGE_SIZE } from '@/lib/client/families-list'

vi.mock('@/lib/client-cache', () => ({
  cachedFetch: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/client/useOrgChanged', () => ({
  useOrgChanged: () => {},
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/app/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
  useConfirm: () => vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/client/useCurrency', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n}` }),
}))

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
})

const stubFamily = {
  _id: 'fam-smoke-1',
  name: 'Smoke Family',
  weddingDate: '2020-06-01',
  currentPayment: 0,
  openBalance: 0,
}

const stubPlan = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Standard',
  yearlyPrice: 500,
}

describe('FamiliesView smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    const { container } = render(
      <FamiliesView
        initialFamilies={[stubFamily]}
        initialPaymentPlans={[stubPlan]}
      />,
    )
    expect(container).toBeDefined()
  })

  it('requests paginated families when no SSR prefetch is provided', async () => {
    const { cachedFetch } = await import('@/lib/client-cache')
    vi.mocked(cachedFetch).mockResolvedValueOnce({
      items: [stubFamily],
      nextCursor: 'cursor-2',
    })

    render(<FamiliesView initialPaymentPlans={[stubPlan]} />)

    await waitFor(() => {
      expect(cachedFetch).toHaveBeenCalledWith(
        `/api/families?limit=${FAMILIES_LIST_PAGE_SIZE}`,
        expect.objectContaining({ ttl: 30_000 }),
      )
    })

    expect((await screen.findAllByText('Smoke Family')).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Load more' }).length).toBeGreaterThan(0)
  })

  it('appends the next page when Load more is clicked', async () => {
    const { cachedFetch } = await import('@/lib/client-cache')
    vi.mocked(cachedFetch).mockResolvedValueOnce({
      items: [{ ...stubFamily, _id: 'fam-2', name: 'Page Two Family' }],
      nextCursor: null,
    })

    render(
      <FamiliesView
        initialFamilies={[stubFamily]}
        initialPaymentPlans={[stubPlan]}
        initialFamiliesNextCursor="cursor-2"
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Load more' })[0])

    await waitFor(() => {
      expect(cachedFetch).toHaveBeenCalledWith(
        `/api/families?limit=${FAMILIES_LIST_PAGE_SIZE}&cursor=cursor-2`,
        expect.objectContaining({ ttl: 30_000 }),
      )
    })

    expect((await screen.findAllByText('Page Two Family')).length).toBeGreaterThan(0)
  })

  it('POSTs family create when the modal form is submitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <FamiliesView
        initialFamilies={[]}
        initialPaymentPlans={[stubPlan]}
        isAdmin
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Family' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Add Family' })

    fireEvent.change(dialog.querySelector('input[autocomplete="family-name"]')!, {
      target: { value: 'New Family' },
    })
    fireEvent.change(dialog.querySelector('input[lang="he"]')!, {
      target: { value: 'משפחה' },
    })
    fireEvent.change(dialog.querySelector('input[type="date"]')!, {
      target: { value: '2020-06-01' },
    })
    fireEvent.change(dialog.querySelector('select')!, {
      target: { value: stubPlan._id },
    })

    const hebrewInputs = dialog.querySelectorAll('input[lang="he"]')
    fireEvent.change(hebrewInputs[1]!, { target: { value: 'דוד' } })
    fireEvent.change(hebrewInputs[3]!, { target: { value: 'שרה' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create family' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/families',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"name":"New Family"'),
        }),
      )
    })
  })
})
