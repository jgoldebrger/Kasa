/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Input as Component } from './Input'

describe('Input smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(Component, { 'aria-label': 'smoke' }) as React.ReactElement)
    expect(container).toBeDefined()
  })
})
