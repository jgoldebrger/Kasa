/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tabs } from './Tabs'

describe('Tabs a11y', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('dir', 'rtl')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('dir')
  })

  it('moves selection with ArrowRight toward the previous item in rtl', () => {
    const onChange = vi.fn()
    render(
      <Tabs
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ]}
        activeId="b"
        onChange={onChange}
      />,
    )
    const tabB = screen.getByRole('tab', { name: 'B' })
    tabB.focus()

    fireEvent.keyDown(tabB, { key: 'ArrowRight' })

    expect(onChange).toHaveBeenCalledWith('a')
  })
})
