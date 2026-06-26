export const SUPPORT_MODE_CHANGED = 'kasa:support-mode-changed'

export type SupportModeDetail = {
  active: boolean
  organizationName?: string | null
}

/** Tell client UI (banner, admin hub) that support mode started or ended. */
export function notifySupportModeChanged(detail: SupportModeDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SUPPORT_MODE_CHANGED, { detail }))
}
