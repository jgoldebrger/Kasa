import type { NavItem, NavSection } from './types'

function allowed(item: NavItem, isAdmin: boolean): boolean {
  if (isAdmin) return item.roles.includes('admin') || item.roles.includes('member')
  return item.roles.includes('member')
}

export function filterNavSections(
  sections: NavSection[],
  ctx: { isAdmin: boolean; isPlatformAdmin: boolean },
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => allowed(item, ctx.isAdmin))
        .map((item) =>
          item.children
            ? {
                ...item,
                children: item.children.filter((c) => allowed(c, ctx.isAdmin)),
              }
            : item,
        ),
    }))
    .filter((section) => section.items.length > 0)
}
