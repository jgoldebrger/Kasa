import { netPaymentAmount } from '@/lib/money'

export type PaymentSortDir = 'asc' | 'desc'

export interface PaymentSort {
  id: string
  dir: PaymentSortDir
}

export interface PaymentSortRow {
  paymentDate?: string | Date | null
  familyId?: { name?: string | null; email?: string | null; phone?: string | null } | null
  amount?: number
  refundedAmount?: number | null
  type?: string | null
  paymentMethod?: string | null
  year?: number | null
  notes?: string | null
}

function paymentDateMs(value: string | Date | null | undefined): number {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function comparePrimitive(
  aVal: string | number,
  bVal: string | number,
  dir: PaymentSortDir,
): number {
  if (aVal < bVal) return dir === 'asc' ? -1 : 1
  if (aVal > bVal) return dir === 'asc' ? 1 : -1
  return 0
}

/** Client-side sort for payment list tables (DataView column headers). */
export function sortPaymentRows<T extends PaymentSortRow>(
  rows: T[],
  sort: PaymentSort | null,
): T[] {
  if (!sort) return rows

  const sorted = [...rows]
  sorted.sort((a, b) => {
    let aVal: string | number
    let bVal: string | number

    switch (sort.id) {
      case 'date':
        aVal = paymentDateMs(a.paymentDate)
        bVal = paymentDateMs(b.paymentDate)
        break
      case 'family':
        aVal = (a.familyId?.name || '').toLowerCase()
        bVal = (b.familyId?.name || '').toLowerCase()
        break
      case 'familyEmail':
        aVal = (a.familyId?.email || '').toLowerCase()
        bVal = (b.familyId?.email || '').toLowerCase()
        break
      case 'familyPhone':
        aVal = (a.familyId?.phone || '').toLowerCase()
        bVal = (b.familyId?.phone || '').toLowerCase()
        break
      case 'amount':
        aVal = netPaymentAmount(a)
        bVal = netPaymentAmount(b)
        break
      case 'type':
        aVal = (a.type || '').toLowerCase()
        bVal = (b.type || '').toLowerCase()
        break
      case 'method':
        aVal = (a.paymentMethod || 'cash').toLowerCase()
        bVal = (b.paymentMethod || 'cash').toLowerCase()
        break
      case 'year':
        aVal = a.year ?? 0
        bVal = b.year ?? 0
        break
      default:
        if (sort.id === 'notes' || sort.id.endsWith('-notes')) {
          aVal = (a.notes || '').toLowerCase()
          bVal = (b.notes || '').toLowerCase()
          break
        }
        return 0
    }

    return comparePrimitive(aVal, bVal, sort.dir)
  })

  return sorted
}
