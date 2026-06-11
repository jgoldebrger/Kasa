/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Modal as Component } from './Modal'

describe('Modal smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(Component, { open: false, onClose: () => {}, title: 'Smoke' }, 'body') as React.ReactElement)
    expect(container).toBeDefined()
  })
})
