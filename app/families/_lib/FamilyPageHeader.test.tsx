/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FamilyPageHeader } from './FamilyPageHeader'
import { Button } from '@/app/components/ui'

describe('FamilyPageHeader', () => {
  it('renders title and primary action with accessible heading', () => {
    render(<FamilyPageHeader title="Payments" primaryAction={<Button>Add Payment</Button>} />)
    expect(screen.getByRole('heading', { name: 'Payments' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add Payment' })).toBeDefined()
  })
})
