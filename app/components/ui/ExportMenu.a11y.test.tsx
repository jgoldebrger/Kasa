/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import ExportMenu from './ExportMenu'

afterEach(cleanup)

describe('ExportMenu a11y', () => {
  it('focuses on open, wraps with arrows, and restores trigger focus on Escape', () => {
    render(<ExportMenu onExportCsv={() => {}} onExportXlsx={() => {}} rowCount={2} />)

    const trigger = screen.getByRole('button', { name: 'Export' })
    fireEvent.click(trigger)
    const items = screen.getAllByRole('menuitem')

    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
