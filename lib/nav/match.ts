import type { NavItem, NavSection } from './types'

function pathOnly(href: string): string {
  return href.split('?')[0] || href
}

export function isNavItemActive(
  pathname: string,
  search: string,
  item: Pick<NavItem, 'href' | 'settingsTab'>,
): boolean {
  const base = pathOnly(item.href)
  if (item.settingsTab) {
    if (pathname !== '/settings' && !pathname.startsWith('/settings/')) return false
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    const tab = params.get('tab')
    if (item.settingsTab === 'email') return !tab || tab === 'email'
    return tab === item.settingsTab
  }
  if (base === '/') return pathname === '/'
  if (pathname === base) return true
  return pathname.startsWith(`${base}/`)
}

export function findActiveNavItem(
  pathname: string,
  search: string,
  sections: NavSection[],
): NavItem | null {
  const flat: NavItem[] = []
  for (const s of sections) {
    for (const item of s.items) {
      flat.push(item)
      if (item.children) flat.push(...item.children)
    }
  }
  const matches = flat.filter((i) => isNavItemActive(pathname, search, i))
  if (matches.length === 0) return null
  matches.sort((a, b) => {
    const pl = pathOnly(b.href).length - pathOnly(a.href).length
    if (pl !== 0) return pl
    return (b.settingsTab?.length ?? 0) - (a.settingsTab?.length ?? 0)
  })
  return matches[0]
}
