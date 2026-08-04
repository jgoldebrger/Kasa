/**
 * @vitest-environment happy-dom
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ImportModal from './ImportModal'

vi.mock('@/app/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => key,
}))

afterEach(cleanup)

describe('ImportModal a11y', () => {
  it('exposes the open dialog and labels its file input', () => {
    render(<ImportModal open type="families" onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: 'import.title' })).toBeTruthy()
    expect(screen.getByLabelText(/import\.dropOrBrowse/).getAttribute('type')).toBe('file')
  })
})

describe('ImportModal tokens', () => {
  it('does not use raw green/amber palette classes', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/components/ui/ImportModal.tsx'),
      'utf8',
    )

    expect(src).not.toMatch(/\b(bg|text|border)-(green|amber)-/)
  })

  it('uses logical spacing and text alignment utilities', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/components/ui/ImportModal.tsx'),
      'utf8',
    )

    expect(src).not.toMatch(/\bml-/)
    expect(src).not.toMatch(/\btext-left\b/)
  })
})
