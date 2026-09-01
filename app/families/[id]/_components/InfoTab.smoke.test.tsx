/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InfoTab from './InfoTab'

vi.mock('../FamilyDetailContext', () => ({
  useFamilyDetail: () => ({
    data: {
      family: {
        _id: 'fam-1',
        name: 'Test Family',
        weddingDate: '2020-06-01',
      },
      members: [],
      payments: [],
      balance: { balance: 0 },
    },
    isAdmin: true,
    familyId: 'fam-1',
    memberFinancialAccess: false,
    paymentPlans: [],
    getPlanNameById: () => 'Standard',
    setInfoForm: vi.fn(),
    setShowInfoModal: vi.fn(),
    renderEditableField: (_field: string, display: React.ReactNode) => display,
    setData: vi.fn(),
  }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

describe('InfoTab smoke', () => {
  it('renders FamilyPageHeader title for family profile', () => {
    render(<InfoTab />)
    expect(screen.getByRole('heading', { name: 'Family profile' })).toBeDefined()
  })
})
