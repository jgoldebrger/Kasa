import { describe, expect, it } from 'vitest'
import { TASK_TEMPLATES, dueDateFromOffset, getTaskTemplate } from './templates'

describe('task templates', () => {
  it('includes annual dues and event follow-up templates', () => {
    expect(TASK_TEMPLATES.map((t) => t.id)).toEqual(['annual-dues-reminder', 'event-follow-up'])
  })

  it('getTaskTemplate returns a template by id', () => {
    const tpl = getTaskTemplate('event-follow-up')
    expect(tpl?.dueDaysOffset).toBe(3)
    expect(tpl?.priority).toBe('high')
  })

  it('dueDateFromOffset adds days in local calendar', () => {
    const base = new Date(2025, 5, 1) // June 1, 2025 local
    expect(dueDateFromOffset(7, base)).toBe('2025-06-08')
  })
})
