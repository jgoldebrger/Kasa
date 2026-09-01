/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FamilyMemberModal } from './FamilyMemberModal'

vi.mock('../../FamilyDetailContext', () => ({
  useFamilyDetail: () => ({
    isAdmin: true,
    showMemberModal: true,
    editingMember: null,
    setEditingMember: vi.fn(),
    memberForm: {
      firstName: '',
      hebrewFirstName: '',
      lastName: '',
      hebrewLastName: '',
      birthDate: '',
      hebrewBirthDate: '',
      gender: '',
      weddingDate: '',
      spouseName: '',
      spouseFirstName: '',
      spouseHebrewName: '',
      spouseFatherHebrewName: '',
      spouseCellPhone: '',
      phone: '',
      email: '',
      address: '',
      city: '',
      state: '',
      zip: '',
    },
    setMemberForm: vi.fn(),
    setShowMemberModal: vi.fn(),
    handleAddMember: vi.fn(),
    handleUpdateMember: vi.fn(),
  }),
}))

describe('FamilyMemberModal smoke', () => {
  it('renders dialog when open', () => {
    render(<FamilyMemberModal />)
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Add Child' })).toBeDefined()
  })
})
