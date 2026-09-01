/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import FamilyTabNav from './FamilyTabNav'

vi.mock('./FamilyDetailContext', () => ({
  useFamilyDetail: () => ({
    familyId: 'fam-1',
    activeTab: 'members',
    isAdmin: true,
    memberFinancialAccess: false,
  }),
}))
vi.mock('@/lib/client/i18n', () => ({ useT: () => (k: string, fb?: string) => fb ?? k }))

describe('FamilyTabNav a11y', () => {
  it('exposes grouped family section nav with current page', () => {
    render(<FamilyTabNav />)
    expect(screen.getByRole('navigation', { name: /family sections/i })).toBeDefined()
    expect(screen.getByRole('link', { current: 'page' })).toBeDefined()
  })
})
