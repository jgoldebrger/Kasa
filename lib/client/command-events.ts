export const OPEN_RECORD_PAYMENT = 'kasa:open-record-payment'
export const OPEN_RECORD_EVENT = 'kasa:open-record-event'
export const OPEN_CREATE_TASK = 'kasa:open-create-task'

export function openRecordPayment(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_RECORD_PAYMENT))
}

export function openRecordEvent(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_RECORD_EVENT))
}

export function openCreateTask(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_CREATE_TASK))
}
