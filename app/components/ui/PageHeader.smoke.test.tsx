/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PageHeader as Component } from './PageHeader'

describe('PageHeader smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(Component, { title: 'Smoke' }) as React.ReactElement)
    expect(container).toBeDefined()
  })
})
