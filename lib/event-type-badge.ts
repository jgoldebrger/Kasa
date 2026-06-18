// Deterministic badge palette keyed off the raw eventType string. Each
// slot must be a literal class string so Tailwind's purge keeps it. The
// hash is stable across reloads so users see consistent colors per type
// without us hardcoding which event gets which color.
const EVENT_BADGE_PALETTE = [
  'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
  'bg-accent/10 text-accent',
  'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
] as const

export function eventTypeBadgeClass(eventType: string): string {
  if (!eventType) return EVENT_BADGE_PALETTE[0]
  let hash = 0
  for (let i = 0; i < eventType.length; i++) {
    hash = (hash * 31 + eventType.charCodeAt(i)) | 0
  }
  return EVENT_BADGE_PALETTE[Math.abs(hash) % EVENT_BADGE_PALETTE.length]
}
