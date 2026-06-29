export type TaskSortDir = 'asc' | 'desc'

export interface TaskSort {
  id: string
  dir: TaskSortDir
}

export interface TaskSortRow {
  title?: string | null
  dueDate?: string | Date | null
  priority?: string | null
  status?: string | null
  familyName?: string | null
  email?: string | null
  assigneeName?: string | null
}

const PRIORITY_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
}

const STATUS_ORDER: Record<string, number> = {
  pending: 1,
  in_progress: 2,
  completed: 3,
  cancelled: 4,
}

function dueDateMs(value: string | Date | null | undefined): number {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function comparePrimitive(aVal: string | number, bVal: string | number, dir: TaskSortDir): number {
  if (aVal < bVal) return dir === 'asc' ? -1 : 1
  if (aVal > bVal) return dir === 'asc' ? 1 : -1
  return 0
}

/** Client-side sort for task list tables (DataView column headers). */
export function sortTaskRows<T extends TaskSortRow>(rows: T[], sort: TaskSort | null): T[] {
  if (!sort) return rows

  const sorted = [...rows]
  sorted.sort((a, b) => {
    let aVal: string | number
    let bVal: string | number

    switch (sort.id) {
      case 'title':
        aVal = (a.title || '').toLowerCase()
        bVal = (b.title || '').toLowerCase()
        break
      case 'dueDate':
        aVal = dueDateMs(a.dueDate)
        bVal = dueDateMs(b.dueDate)
        break
      case 'priority':
        aVal = PRIORITY_ORDER[a.priority || ''] ?? 0
        bVal = PRIORITY_ORDER[b.priority || ''] ?? 0
        break
      case 'status':
        aVal = STATUS_ORDER[a.status || ''] ?? 0
        bVal = STATUS_ORDER[b.status || ''] ?? 0
        break
      case 'family':
        aVal = (a.familyName || '').toLowerCase()
        bVal = (b.familyName || '').toLowerCase()
        break
      case 'email':
      case 'assignee':
        aVal = (a.assigneeName || a.email || '').toLowerCase()
        bVal = (b.assigneeName || b.email || '').toLowerCase()
        break
      default:
        return 0
    }

    return comparePrimitive(aVal, bVal, sort.dir)
  })

  return sorted
}
