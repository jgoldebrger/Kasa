import type { MessageKey } from '@/lib/i18n/load-locale'

export type TaskTemplateId = 'annual-dues-reminder' | 'event-follow-up'

export type TaskTemplate = {
  id: TaskTemplateId
  labelKey: MessageKey
  titleKey: MessageKey
  descriptionKey: MessageKey
  /** Days from today for the default due date */
  dueDaysOffset: number
  priority: 'low' | 'medium' | 'high' | 'urgent'
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'annual-dues-reminder',
    labelKey: 'tasks.templates.annualDuesReminder.label',
    titleKey: 'tasks.templates.annualDuesReminder.title',
    descriptionKey: 'tasks.templates.annualDuesReminder.description',
    dueDaysOffset: 7,
    priority: 'medium',
  },
  {
    id: 'event-follow-up',
    labelKey: 'tasks.templates.eventFollowUp.label',
    titleKey: 'tasks.templates.eventFollowUp.title',
    descriptionKey: 'tasks.templates.eventFollowUp.description',
    dueDaysOffset: 3,
    priority: 'high',
  },
]

export function getTaskTemplate(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id)
}

/** ISO date string (YYYY-MM-DD) for today + offset in local calendar. */
export function dueDateFromOffset(days: number, base = new Date()): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
