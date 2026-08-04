import { PRIMARY_NAV_SECTIONS } from './config'

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

export function getNavShortcutHelpItems(): NavShortcutHelpItem[] {
  return PRIMARY_NAV_SECTIONS.flatMap((section) => section.items)
    .filter((item) => item.shortcut)
    .map((item) => ({
      keys: item.shortcut!,
      labelKey: SHORTCUT_LABELS[item.id] ?? item.labelKey,
      href: item.href,
    }))
}
