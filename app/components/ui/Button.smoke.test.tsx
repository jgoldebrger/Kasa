/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Button as Component } from './Button'

describe('Button smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(Component, null, 'Label') as React.ReactElement)
    expect(container).toBeDefined()
  })
})
