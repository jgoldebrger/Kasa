'use client'

import SettingsActivityPanel from '@/app/components/settings/ActivityPanel'

export interface ActivityPanelProps {
  items: Parameters<typeof SettingsActivityPanel>[0]['items']
  nextCursor: string | null
  loading: boolean
  usersMap: Record<string, { name?: string; email?: string }>
  actionFilter: string
  setActionFilter: (s: string) => void
  userFilter: string
  setUserFilter: (s: string) => void
  resourceTypeFilter: string
  setResourceTypeFilter: (s: string) => void
  fromDate: string
  setFromDate: (s: string) => void
  toDate: string
  setToDate: (s: string) => void
  onLoadMore: () => void
  onExportCsv: () => void
}

export default function ActivityPanel(props: ActivityPanelProps) {
  return <SettingsActivityPanel {...props} />
}
