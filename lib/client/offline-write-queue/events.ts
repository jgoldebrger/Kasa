export const OFFLINE_QUEUE_CHANGED = 'kasa:offline-queue-changed'

export function dispatchQueueChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_CHANGED))
}

export function onQueueChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(OFFLINE_QUEUE_CHANGED, handler)
  return () => window.removeEventListener(OFFLINE_QUEUE_CHANGED, handler)
}
