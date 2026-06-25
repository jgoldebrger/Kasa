export const OPEN_GLOBAL_SEARCH = 'kasa:open-search'

/** Open the sidebar / header global search panel (same as / or Ctrl+K). */
export function openGlobalSearch(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SEARCH))
}
