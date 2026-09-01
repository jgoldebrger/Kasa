import type { MessageKey } from '@/lib/i18n/load-locale'

export type FamilyTabGroup = 'profile' | 'money' | 'activity'

export type FamilyTabId =
  | 'info'
  | 'members'
  | 'payments'
  | 'withdrawals'
  | 'events'
  | 'cycle-charges'
  | 'statements'
  | 'emails'
  | 'sub-families'
  | 'tasks'

export interface FamilyTabDef {
  id: FamilyTabId
  segment: string
  labelKey: MessageKey
  fallbackLabel: string
  group: FamilyTabGroup
  adminOnly?: boolean
  memberReadable?: boolean
}
