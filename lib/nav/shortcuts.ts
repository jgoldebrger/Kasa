import { PRIMARY_NAV_SECTIONS } from './config'
import type { NavSection } from './types'

export interface NavShortcutHelpItem {
  keys: string
  labelKey: string
  href?: string
}

const SHORTCUT_LABELS: Record<string, string> = {
  families: 'shortcuts.goFamilies',
  events: 'shortcuts.goEvents',
  tasks: 'shortcuts.goTasks',
  payments: 'shortcuts.goPayments',
  communications: 'shortcuts.goCommunications',
  'settings-email': 'shortcuts.goSettings',
}

/**
 * Builds the keyboard-shortcut help list from a nav section tree. Pass a
 * role-filtered tree (see `filterNavSections`) so members don't get
 * shortcuts for destinations they can't see; defaults to the full tree.
 */
export function getNavShortcutHelpItems(
  sections: NavSection[] = PRIMARY_NAV_SECTIONS,
): NavShortcutHelpItem[] {
  return sections
    .flatMap((section) => section.items)
    .filter((item) => item.shortcut)
    .map((item) => ({
      keys: item.shortcut!,
      labelKey: SHORTCUT_LABELS[item.id] ?? item.labelKey,
      href: item.href,
    }))
}
