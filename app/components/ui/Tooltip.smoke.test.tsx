/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Tooltip as Component } from './Tooltip'

describe('Tooltip smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(<Component content="Tip">Hover</Component>)
    expect(container).toBeDefined()
  })
})
