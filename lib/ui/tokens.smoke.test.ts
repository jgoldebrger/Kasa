import { describe, it, expect } from 'vitest'
import tailwindConfig from '../../tailwind.config.js'

describe('design tokens', () => {
  it('exposes soft status colors on the Tailwind theme', () => {
    const colors = (tailwindConfig as { theme: { extend: { colors: Record<string, unknown> } } })
      .theme.extend.colors
    expect(colors).toHaveProperty('success-soft')
    expect(colors).toHaveProperty('warning-soft')
    expect(colors).toHaveProperty('danger-soft')
    expect(colors).toHaveProperty('danger-fg')
  })
})
