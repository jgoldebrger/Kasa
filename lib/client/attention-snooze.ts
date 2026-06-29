/** Per-org localStorage snooze for dashboard attention cards. */

export type AttentionItemKey = 'delinquentFamilies'

const PREFIX = 'kasa.attention.snooze.'

function storageKey(orgId: string, key: AttentionItemKey): string {
  return `${PREFIX}${orgId}.${key}`
}

export function getAttentionSnoozedUntil(orgId: string, key: AttentionItemKey): Date | null {
  if (typeof window === 'undefined' || !orgId) return null
  try {
    const raw = window.localStorage.getItem(storageKey(orgId, key))
    if (!raw) return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function snoozeAttentionItem(orgId: string, key: AttentionItemKey, until: Date): void {
  if (typeof window === 'undefined' || !orgId) return
  try {
    window.localStorage.setItem(storageKey(orgId, key), until.toISOString())
  } catch {
    /* localStorage may be blocked */
  }
}

export function clearAttentionSnooze(orgId: string, key: AttentionItemKey): void {
  if (typeof window === 'undefined' || !orgId) return
  try {
    window.localStorage.removeItem(storageKey(orgId, key))
  } catch {
    /* localStorage may be blocked */
  }
}

export function isAttentionItemHidden(
  orgId: string,
  key: AttentionItemKey,
  now = new Date(),
): boolean {
  const until = getAttentionSnoozedUntil(orgId, key)
  if (!until) return false
  return until.getTime() > now.getTime()
}

export function snoozeAttentionForDays(
  orgId: string,
  key: AttentionItemKey,
  days: number,
  now = new Date(),
): void {
  const until = new Date(now.getTime() + days * 86_400_000)
  snoozeAttentionItem(orgId, key, until)
}
