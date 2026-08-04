export type NavRole = 'member' | 'admin' | 'platformAdmin'

export interface NavItem {
  id: string
  href: string
  labelKey: string
  icon?: string
  roles: NavRole[]
  shortcut?: string
  children?: NavItem[]
  settingsTab?: string
}

export interface NavSection {
  id: string
  labelKey: string | null
  items: NavItem[]
}
