/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EmptyState as Component } from './EmptyState'

describe('EmptyState smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(Component, { title: 'Empty' }) as React.ReactElement)
    expect(container).toBeDefined()
  })
})
