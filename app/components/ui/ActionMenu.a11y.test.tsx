/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import ActionMenu from './ActionMenu'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('dir')
})

describe('ActionMenu a11y', () => {
  it('focuses the first enabled item, moves with arrows, and restores focus on Escape', () => {
    render(
      <ActionMenu
        items={[
          { label: 'Unavailable', onClick: () => {}, disabled: true },
          { label: 'Edit', onClick: () => {} },
          { label: 'Delete', onClick: () => {}, destructive: true },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.click(trigger)
    const items = screen.getAllByRole('menuitem')

    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('supports Home, End, and direction-aware horizontal navigation', () => {
    render(
      <div dir="rtl">
        <ActionMenu
          items={[
            { label: 'Edit', onClick: () => {} },
            { label: 'Archive', onClick: () => {} },
            { label: 'Delete', onClick: () => {} },
          ]}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const items = screen.getAllByRole('menuitem')

    fireEvent.keyDown(items[0], { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2], { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[1], { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('does not reset focus when positioning updates', () => {
    render(
      <ActionMenu
        items={[
          { label: 'Edit', onClick: () => {} },
          { label: 'Delete', onClick: () => {} },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const items = screen.getAllByRole('menuitem')
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])

    fireEvent(window, new Event('resize'))

    expect(document.activeElement).toBe(items[1])
  })

  it('accepts logical and legacy physical alignment values', () => {
    const { rerender } = render(
      <ActionMenu align="start" items={[{ label: 'Edit', onClick: () => {} }]} />,
    )

    expect(screen.getByRole('button', { name: 'Actions' })).toBeTruthy()

    rerender(<ActionMenu align="left" items={[{ label: 'Edit', onClick: () => {} }]} />)
    rerender(<ActionMenu align="end" items={[{ label: 'Edit', onClick: () => {} }]} />)
    rerender(<ActionMenu align="right" items={[{ label: 'Edit', onClick: () => {} }]} />)
  })
})
