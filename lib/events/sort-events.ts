export type EventSortDir = 'asc' | 'desc'

export interface EventSort {
  id: string
  dir: EventSortDir
}

export interface EventSortRow {
  familyName?: string | null
  eventType?: string | null
  eventTypeLabel?: string | null
  eventDate?: string | Date | null
  year?: number | null
  amount?: number | null
  notes?: string | null
}

function eventDateMs(value: string | Date | null | undefined): number {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function comparePrimitive(aVal: string | number, bVal: string | number, dir: EventSortDir): number {
  if (aVal < bVal) return dir === 'asc' ? -1 : 1
  if (aVal > bVal) return dir === 'asc' ? 1 : -1
  return 0
}

/** Client-side sort for lifecycle event list tables (DataView column headers). */
export function sortEventRows<T extends EventSortRow>(rows: T[], sort: EventSort | null): T[] {
  if (!sort) return rows

  const sorted = [...rows]
  sorted.sort((a, b) => {
    let aVal: string | number
    let bVal: string | number

    switch (sort.id) {
      case 'family':
        aVal = (a.familyName || '').toLowerCase()
        bVal = (b.familyName || '').toLowerCase()
        break
      case 'eventType':
        aVal = (a.eventTypeLabel || a.eventType || '').toLowerCase()
        bVal = (b.eventTypeLabel || b.eventType || '').toLowerCase()
        break
      case 'eventDate':
        aVal = eventDateMs(a.eventDate)
        bVal = eventDateMs(b.eventDate)
        break
      case 'year':
        aVal = a.year ?? 0
        bVal = b.year ?? 0
        break
      case 'amount':
        aVal = a.amount ?? 0
        bVal = b.amount ?? 0
        break
      case 'notes':
        aVal = (a.notes || '').toLowerCase()
        bVal = (b.notes || '').toLowerCase()
        break
      default:
        return 0
    }

    return comparePrimitive(aVal, bVal, sort.dir)
  })

  return sorted
}
