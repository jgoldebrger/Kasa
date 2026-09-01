export const SETTINGS_TAB_IDS = [
  'email',
  'eventTypes',
  'paymentPlans',
  'automation',
  'kevittel',
  'cycle',
  'branding',
  'letterhead',
  'labels',
  'localization',
  'activity',
  'members',
  'billing',
  'trash',
  'dataExport',
] as const

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number]
