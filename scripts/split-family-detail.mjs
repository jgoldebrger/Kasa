/**
 * One-time script: split app/families/[id]/page.tsx into route-based tab structure.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const pagePath = path.join(root, 'app/families/[id]/page.tsx')
const idDir = path.join(root, 'app/families/[id]')

const src = fs.readFileSync(pagePath, 'utf8')
const lines = src.split('\n')

// --- helpers block (lines 51-446, 0-indexed 50-445) ---
const helpersBlock = lines.slice(50, 446).join('\n')
const helpersContent = `import type React from 'react'
import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'
import { netPaymentAmount } from '@/lib/money'
import { formatLocaleDate } from '@/lib/date-utils'
import { sanitizePaymentNotes } from '@/lib/payments/sanitize'
import type { DataColumn } from '@/app/components/ui'

${helpersBlock.replace(/^function /gm, 'export function ').replace(/^const qwertyToHebrew/gm, 'export const qwertyToHebrew').replace(/^const PLAN_COLOR_PALETTE/gm, 'export const PLAN_COLOR_PALETTE').replace(/^const handleHebrewInput/gm, 'export const handleHebrewInput').replace(/^const capitalizeName/gm, 'export const capitalizeName').replace(/^const formatPhone/gm, 'export const formatPhone').replace(/^const validateEmail/gm, 'export const validateEmail').replace(/^interface FamilyDetails/gm, 'export interface FamilyDetails').replace(/^interface PaymentPlan/gm, 'export interface PaymentPlan').replace(/^interface LifecycleEventType/gm, 'export interface LifecycleEventType')}
`
fs.mkdirSync(path.join(idDir, '_lib'), { recursive: true })
fs.writeFileSync(path.join(idDir, '_lib/helpers.ts'), helpersContent)

// --- constants ---
const constantsContent = `export const ADMIN_ONLY_FAMILY_TABS = new Set([
  'payments',
  'withdrawals',
  'events',
  'cycle-charges',
  'statements',
  'tasks',
])

export type FamilyTabId =
  | 'info'
  | 'members'
  | 'payments'
  | 'withdrawals'
  | 'events'
  | 'cycle-charges'
  | 'statements'
  | 'sub-families'
  | 'tasks'

export const FAMILY_TAB_SEGMENTS: Record<FamilyTabId, string> = {
  info: '',
  members: 'members',
  payments: 'payments',
  withdrawals: 'withdrawals',
  events: 'events',
  'cycle-charges': 'cycle-charges',
  statements: 'statements',
  'sub-families': 'sub-families',
  tasks: 'tasks',
}

export function familyTabFromPathname(pathname: string, familyId: string): FamilyTabId {
  const prefix = \`/families/\${familyId}\`
  if (!pathname.startsWith(prefix)) return 'info'
  const rest = pathname.slice(prefix.length).replace(/^\\//, '')
  if (!rest) return 'info'
  const segment = rest.split('/')[0]
  const match = Object.entries(FAMILY_TAB_SEGMENTS).find(([, seg]) => seg === segment)
  return (match?.[0] as FamilyTabId) ?? 'info'
}

export function familyTabHref(familyId: string, tab: FamilyTabId): string {
  const seg = FAMILY_TAB_SEGMENTS[tab]
  return seg ? \`/families/\${familyId}/\${seg}\` : \`/families/\${familyId}\`
}

export const FAMILY_TABS: { id: FamilyTabId; label: string; adminOnly?: boolean }[] = [
  { id: 'info', label: 'Info' },
  { id: 'members', label: 'Members' },
  { id: 'payments', label: 'Payments', adminOnly: true },
  { id: 'withdrawals', label: 'Withdrawals', adminOnly: true },
  { id: 'events', label: 'Lifecycle Events', adminOnly: true },
  { id: 'cycle-charges', label: 'Cycle Charges', adminOnly: true },
  { id: 'statements', label: 'Statements', adminOnly: true },
  { id: 'tasks', label: 'Tasks', adminOnly: true },
  { id: 'sub-families', label: 'Sub-Families' },
]
`
fs.writeFileSync(path.join(idDir, '_lib/constants.ts'), constantsContent)

// Tab line ranges (1-indexed inclusive start/end of inner content)
const tabs = [
  { id: 'info', file: 'InfoTab', start: 2691, end: 2903 },
  { id: 'members', file: 'MembersTab', start: 2907, end: 3539 },
  { id: 'payments', file: 'PaymentsTab', start: 3542, end: 3587 },
  { id: 'withdrawals', file: 'WithdrawalsTab', start: 3589, end: 3710 },
  { id: 'events', file: 'EventsTab', start: 3712, end: 3801 },
  { id: 'cycle-charges', file: 'CycleChargesTab', start: 3803, end: 3895 },
  { id: 'statements', file: 'StatementsTab', start: 3897, end: 3989 },
  { id: 'sub-families', file: 'SubFamiliesTab', start: 3991, end: 4202 },
  { id: 'tasks', file: 'TasksTab', start: 4205, end: 4322 },
]

fs.mkdirSync(path.join(idDir, '_components'), { recursive: true })

for (const tab of tabs) {
  const inner = lines.slice(tab.start - 1, tab.end).join('\n')
  // Strip outer wrapper div if present - content starts with `<div>` 
  const content = `'use client'

import { useFamilyDetail } from '../FamilyDetailContext'

export default function ${tab.file}() {
  const ctx = useFamilyDetail()
  const {
${extractDestructuring(inner)}
  } = ctx

  return (
${indentBlock(stripLeadingDiv(inner), 4)}
  )
}
`
  fs.writeFileSync(path.join(idDir, `_components/${tab.file}.tsx`), content)
}

// Modals block
const modalsInner = lines.slice(4326, 5429).join('\n')
const modalsContent = `'use client'

import dynamic from 'next/dynamic'
import TaskFormModal from '@/app/components/tasks/TaskFormModal'
import { PencilIcon } from '@heroicons/react/24/outline'
import { useFamilyDetail } from '../FamilyDetailContext'
import { capitalizeName, formatPhone, handleHebrewInput, validateEmail } from '../_lib/helpers'
import { Modal } from './Modal'

const StripePaymentForm = dynamic(() => import('@/app/components/StripePaymentForm'), {
  ssr: false,
  loading: () => (
    <div className="p-4 bg-app-subtle rounded-lg border border-border text-sm text-fg-muted">
      Loading payment form…
    </div>
  ),
})

export default function FamilyModals() {
  const ctx = useFamilyDetail()
  const {
    isAdmin,
    params,
    data,
    showMemberModal,
    setShowMemberModal,
    editingMember,
    memberForm,
    setMemberForm,
    handleAddMember,
    handleUpdateMember,
    showInfoModal,
    setShowInfoModal,
    infoForm,
    setInfoForm,
    handleUpdateFamilyInfo,
    paymentPlans,
    showPaymentModal,
    setShowPaymentModal,
    useStripe,
    setUseStripe,
    paymentForm,
    setPaymentForm,
    handleAddPayment,
    savedPaymentMethods,
    showEventModal,
    setShowEventModal,
    eventForm,
    setEventForm,
    lifecycleEventTypes,
    handleAddEvent,
    updateEventAmount,
    showWithdrawalModal,
    setShowWithdrawalModal,
    editingWithdrawal,
    setEditingWithdrawal,
    withdrawalForm,
    setWithdrawalForm,
    handleSaveWithdrawal,
    showEmailModal,
    setShowEmailModal,
    emailFormData,
    setEmailFormData,
    handleSaveEmailConfig,
    showTaskModal,
    setShowTaskModal,
    activeTab,
    fetchFamilyTasks,
  } = ctx

  return (
    <>
${indentBlock(modalsInner, 6)}
    </>
  )
}
`
fs.writeFileSync(path.join(idDir, '_components/FamilyModals.tsx'), modalsContent)

// Modal component
const modalFn = lines.slice(5435, 5452).join('\n')
fs.writeFileSync(
  path.join(idDir, '_components/Modal.tsx'),
  modalFn.replace('function Modal', 'export function Modal'),
)

// FamilyHeader
const headerInner = lines.slice(2587, 2654).join('\n')
const headerContent = `'use client'

import { PlusIcon } from '@heroicons/react/24/outline'
import { useFamilyDetail } from './FamilyDetailContext'

export default function FamilyHeader() {
  const { data, isAdmin, formatMoney, getPlanNameById, setShowTaskModal } = useFamilyDetail()

  if (!data?.family) return null

  return (
${indentBlock(headerInner, 4)}
  )
}
`
fs.writeFileSync(path.join(idDir, 'FamilyHeader.tsx'), headerContent)

console.log('Split script: helpers, constants, tabs, modals, header written.')
console.log('Manual step: create FamilyDetailContext.tsx, layout.tsx, route pages, update page.tsx')

function stripLeadingDiv(s) {
  const trimmed = s.trim()
  if (trimmed.startsWith('<div>')) {
    return trimmed.replace(/^<div>\n?/, '').replace(/\n\s*<\/div>\s*$/, '')
  }
  return trimmed
}

function indentBlock(s, spaces) {
  const pad = ' '.repeat(spaces)
  return s
    .split('\n')
    .map((l) => pad + l)
    .join('\n')
}

function extractDestructuring(inner) {
  // Common destructuring for all tabs - use full ctx spread pattern instead
  return `    ...ctx`
}
