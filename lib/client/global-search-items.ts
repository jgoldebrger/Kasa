import type { MessageKey } from '@/lib/i18n/load-locale'
import { openCreateTask, openRecordEvent, openRecordPayment } from '@/lib/client/command-events'

export type SearchResultGroupId = 'actions' | 'pages' | 'records'

export interface StaticSearchAction {
  id: string
  labelKey: MessageKey
  keywords?: string[]
  adminOnly?: boolean
  run: () => void
}

export interface StaticSearchPage {
  id: string
  href: string
  labelKey: MessageKey
  keywords?: string[]
  adminOnly?: boolean
}

export interface ApiSearchRecord {
  type: 'family' | 'member' | 'payment' | 'task' | 'event'
  id: string
  label: string
  sublabel: string
  href: string
}

export interface GroupedSearchItem {
  id: string
  group: SearchResultGroupId
  label: string
  sublabel?: string
  recordType?: ApiSearchRecord['type']
  href?: string
  run?: () => void
}

export interface GroupedSearchResults {
  groups: { id: SearchResultGroupId; label: string; items: GroupedSearchItem[] }[]
  flatItems: GroupedSearchItem[]
}

export const STATIC_SEARCH_ACTIONS: StaticSearchAction[] = [
  {
    id: 'record-payment',
    labelKey: 'search.action.recordPayment',
    keywords: ['payment', 'pay', 'cash', 'check'],
    adminOnly: true,
    run: openRecordPayment,
  },
  {
    id: 'add-event',
    labelKey: 'search.action.addEvent',
    keywords: ['event', 'lifecycle', 'bar mitzvah'],
    adminOnly: true,
    run: openRecordEvent,
  },
  {
    id: 'create-task',
    labelKey: 'search.action.createTask',
    keywords: ['task', 'todo', 'reminder'],
    adminOnly: true,
    run: openCreateTask,
  },
  {
    id: 'go-statements',
    labelKey: 'search.action.goStatements',
    keywords: ['statement', 'mailing'],
    adminOnly: true,
    run: () => {
      if (typeof window !== 'undefined') window.location.assign('/statements')
    },
  },
  {
    id: 'payment-plans-settings',
    labelKey: 'search.action.paymentPlansSettings',
    keywords: ['plan', 'dues', 'settings'],
    adminOnly: true,
    run: () => {
      if (typeof window !== 'undefined') window.location.assign('/settings?tab=paymentPlans')
    },
  },
]

export const STATIC_SEARCH_PAGES: StaticSearchPage[] = [
  { id: 'page-dashboard', href: '/', labelKey: 'nav.dashboard', keywords: ['home'] },
  {
    id: 'page-families',
    href: '/families',
    labelKey: 'nav.families',
    keywords: ['family', 'members'],
  },
  {
    id: 'page-payments',
    href: '/payments',
    labelKey: 'nav.payments',
    keywords: ['payment'],
    adminOnly: true,
  },
  {
    id: 'page-payments-recurring',
    href: '/payments/recurring',
    labelKey: 'payments.nav.recurring',
    keywords: ['recurring', 'subscription', 'auto-pay', 'monthly'],
    adminOnly: true,
  },
  { id: 'page-tasks', href: '/tasks', labelKey: 'nav.tasks', keywords: ['task'], adminOnly: true },
  {
    id: 'page-calculations',
    href: '/calculations',
    labelKey: 'nav.calculations',
    keywords: ['calc', 'balance'],
    adminOnly: true,
  },
  {
    id: 'page-events',
    href: '/events',
    labelKey: 'nav.events',
    keywords: ['event'],
    adminOnly: true,
  },
  {
    id: 'page-projections',
    href: '/projections',
    labelKey: 'nav.projections',
    keywords: ['dues', 'projection'],
    adminOnly: true,
  },
  {
    id: 'page-reports',
    href: '/reports',
    labelKey: 'nav.reports',
    keywords: ['report'],
    adminOnly: true,
  },
  {
    id: 'page-statements',
    href: '/statements',
    labelKey: 'nav.statements',
    keywords: ['statement'],
    adminOnly: true,
  },
  { id: 'page-help', href: '/help', labelKey: 'nav.help', keywords: ['help', 'docs'] },
  {
    id: 'page-settings',
    href: '/settings',
    labelKey: 'nav.settings',
    keywords: ['settings'],
    adminOnly: true,
  },
]

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase()
}

function matchesQuery(query: string, label: string, keywords: string[] = []): boolean {
  if (!query) return true
  const haystack = [label, ...keywords].join(' ').toLowerCase()
  return haystack.includes(query)
}

export function buildGroupedSearchResults(opts: {
  query: string
  isAdmin: boolean
  t: (key: MessageKey) => string
  groupLabels: Record<SearchResultGroupId, string>
  records?: ApiSearchRecord[]
}): GroupedSearchResults {
  const query = normalizeQuery(opts.query)

  const actionItems: GroupedSearchItem[] = STATIC_SEARCH_ACTIONS.filter(
    (a) => !a.adminOnly || opts.isAdmin,
  )
    .filter((a) => matchesQuery(query, opts.t(a.labelKey), a.keywords))
    .map((a) => ({
      id: `action-${a.id}`,
      group: 'actions' as const,
      label: opts.t(a.labelKey),
      run: a.run,
    }))

  const pageItems: GroupedSearchItem[] = STATIC_SEARCH_PAGES.filter(
    (p) => !p.adminOnly || opts.isAdmin,
  )
    .filter((p) => matchesQuery(query, opts.t(p.labelKey), p.keywords))
    .map((p) => ({
      id: p.id,
      group: 'pages' as const,
      label: opts.t(p.labelKey),
      href: p.href,
    }))

  const recordItems: GroupedSearchItem[] = (opts.records ?? []).map((r) => ({
    id: `record-${r.type}-${r.id}`,
    group: 'records' as const,
    label: r.label,
    sublabel: r.sublabel,
    recordType: r.type,
    href: r.href,
  }))

  const groups = [
    { id: 'actions' as const, label: opts.groupLabels.actions, items: actionItems },
    { id: 'pages' as const, label: opts.groupLabels.pages, items: pageItems },
    { id: 'records' as const, label: opts.groupLabels.records, items: recordItems },
  ].filter((g) => g.items.length > 0)

  const flatItems = groups.flatMap((g) => g.items)

  return { groups, flatItems }
}
