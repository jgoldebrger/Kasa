/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Textarea as Component } from './Textarea'

describe('Textarea smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(Component, { 'aria-label': 'smoke' }) as React.ReactElement)
    expect(container).toBeDefined()
  })
})
