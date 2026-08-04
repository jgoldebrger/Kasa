/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Modal } from './Modal'

afterEach(cleanup)

describe('Modal a11y', () => {
  it('closes on Escape when dismissible', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Edit family">
        <button type="button">Inside</button>
      </Modal>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('exposes its title as the dialog name', () => {
    render(
      <Modal open onClose={() => {}} title="Edit family">
        Body
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'Edit family' })).toBeTruthy()
  })

  it('gives the close control a concise accessible name', () => {
    render(
      <Modal open onClose={() => {}} title="Edit family">
        Body
      </Modal>,
    )

    expect(screen.getByRole('button', { name: /^Close$/ })).toBeTruthy()
  })
})
