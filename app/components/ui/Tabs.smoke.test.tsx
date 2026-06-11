/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Tabs as Component } from './Tabs'

describe('Tabs smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(Component, { items: [{ id: 'a', label: 'Tab' }], activeId: 'a', onChange: () => {} }) as React.ReactElement)
    expect(container).toBeDefined()
  })
})
