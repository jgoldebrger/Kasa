/**
 * Re-extract tabs + modals from recovered page source (Cursor local history).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const sourcePath =
  process.env.FAMILY_PAGE_SOURCE ||
  path.join(
    process.env.USERPROFILE || '',
    'AppData/Roaming/Cursor/User/History/-47827e71/KRWY.tsx',
  )
const idDir = path.join(root, 'app/families/[id]')

if (!fs.existsSync(sourcePath)) {
  console.error('Source page not found:', sourcePath)
  process.exit(1)
}

const lines = fs.readFileSync(sourcePath, 'utf8').split('\n')

const CONTEXT_KEYS = [
  'params', 'router', 'pathname', 'familyId', 'activeTab', 'toast', 'confirm', 'isAdmin', 'roleLoading',
  'formatMoney', 'data', 'setData', 'paymentPlans', 'lifecycleEventTypes', 'statements', 'loading',
  'sendingEmail', 'emailConfig', 'showEmailModal', 'setShowEmailModal', 'emailFormData', 'setEmailFormData',
  'familyTasks', 'loadingFamilyTasks', 'showTaskModal', 'setShowTaskModal', 'subFamilies', 'loadingSubFamilies',
  'showInfoModal', 'setShowInfoModal', 'editingField', 'editValue', 'infoForm', 'setInfoForm', 'showMemberModal',
  'setShowMemberModal', 'editingMember', 'setEditingMember', 'viewingMemberId', 'setViewingMemberId',
  'memberActiveTab', 'setMemberActiveTab', 'memberBalance', 'memberPayments', 'memberStatements',
  'loadingMemberFinancials', 'showPaymentModal', 'setShowPaymentModal', 'useStripe', 'setUseStripe',
  'showEventModal', 'setShowEventModal', 'showWithdrawalModal', 'setShowWithdrawalModal', 'editingWithdrawal',
  'setEditingWithdrawal', 'withdrawalForm', 'setWithdrawalForm', 'memberForm', 'setMemberForm', 'paymentForm',
  'setPaymentForm', 'savedPaymentMethods', 'eventForm', 'setEventForm', 'fetchFamilyTasks', 'fetchFamilyDetails',
  'fetchSubFamilies', 'fetchSavedPaymentMethods', 'fetchMemberFinancials', 'completeFamilyTask', 'deleteFamilyTask',
  'getPlanNameById', 'getPlanName', 'handlePrintStatement', 'handleSavePDFStatement', 'handleSendStatementEmail',
  'handleSaveEmailConfig', 'handlePrintAllStatements', 'openAddMemberModal', 'handleFieldEdit', 'handleFieldSave',
  'handleFieldCancel', 'renderEditableField', 'renderEditableMemberField', 'handleMemberFieldEdit',
  'handleMemberFieldSave', 'handleMemberFieldCancel', 'handleAddMember', 'handleEditMember', 'handleUpdateMember',
  'handleDeleteMember', 'handleAddPayment', 'openAddWithdrawal', 'openEditWithdrawal', 'handleSaveWithdrawal',
  'handleDeleteWithdrawal', 'handleAddEvent', 'updateEventAmount', 'getFamilyLastName', 'setSendingEmail',
  'setEditingField', 'setEditValue', 'setEditingMemberField', 'setEditMemberValue', 'editingMemberField',
  'editMemberValue',
]

const ICONS = [
  'PlusIcon', 'PencilIcon', 'TrashIcon', 'PrinterIcon', 'DocumentArrowDownIcon', 'EnvelopeIcon',
  'ClipboardDocumentListIcon', 'ClockIcon', 'ExclamationTriangleIcon', 'CheckCircleIcon',
]
const COMPONENTS = ['DataView', 'EmptyState', 'Tooltip']

function extractTab(id) {
  const marker = `{activeTab === '${id}' && (`
  const startIdx = lines.findIndex((l) => l.includes(marker))
  if (startIdx === -1) throw new Error('Tab not found: ' + id)
  let depth = 0
  let started = false
  let contentStart = -1
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    for (const ch of line) {
      if (ch === '(') {
        depth++
        if (!started && line.includes(marker)) {
          started = true
          contentStart = i + 1
        }
      } else if (ch === ')') {
        depth--
        if (started && depth === 0) {
          return lines.slice(contentStart, i).join('\n').trim()
        }
      }
    }
  }
  throw new Error('Tab end not found: ' + id)
}

function extractModals() {
  const start = lines.findIndex((l) => l.trim() === '{showMemberModal && isAdmin && (')
  const end = lines.findIndex((l, i) => i > start && l.includes('<TaskFormModal'))
  if (start === -1) throw new Error('Modals start not found')
  let taskEnd = lines.findIndex((l, i) => i > end && l.trim() === '/>')
  if (taskEnd === -1) taskEnd = lines.findIndex((l, i) => i > end && l.includes('/>'))
  // include through TaskFormModal closing
  let closeIdx = taskEnd
  for (let i = taskEnd; i < lines.length; i++) {
    if (lines[i].includes('onCreated')) {
      closeIdx = i + 2 // />
      break
    }
  }
  return lines.slice(start, closeIdx + 1).join('\n')
}

const tabFiles = {
  info: 'InfoTab',
  members: 'MembersTab',
  payments: 'PaymentsTab',
  withdrawals: 'WithdrawalsTab',
  events: 'EventsTab',
  'cycle-charges': 'CycleChargesTab',
  statements: 'StatementsTab',
  'sub-families': 'SubFamiliesTab',
  tasks: 'TasksTab',
}

for (const [id, file] of Object.entries(tabFiles)) {
  const body = extractTab(id)
  const usedIcons = ICONS.filter((i) => body.includes(i))
  const usedComponents = COMPONENTS.filter((c) => body.includes(c))
  const imports = [`import type { FamilyDetailContextValue } from '../FamilyDetailContext'`]
  if (usedIcons.length) imports.push(`import { ${usedIcons.join(', ')} } from '@heroicons/react/24/outline'`)
  if (usedComponents.length) imports.push(`import { ${usedComponents.join(', ')} } from '@/app/components/ui'`)
  if (body.includes('convertToHebrewDate') || body.includes('calculateHebrewAge')) {
    imports.push(`import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'`)
  }
  if (body.includes('formatLocaleDate')) {
    imports.push(`import { formatLocaleDate${body.includes('isFiniteDate') ? ', isFiniteDate' : ''} } from '@/lib/date-utils'`)
  }
  if (body.includes('buildMemberColumns') || body.includes('computeMemberDisplay')) {
    imports.push(`import { buildMemberColumns, computeMemberDisplay, planColorForNumber } from '../_lib/helpers'`)
  }
  if (body.includes('paymentColumnsFor') || body.includes('paymentMobileCard')) {
    imports.push(`import { paymentColumnsFor, paymentMobileCard } from '../_lib/helpers'`)
  }

  const content = `'use client'

${imports.join('\n')}
import { useFamilyDetail } from '../FamilyDetailContext'

function ${file}Content(props: FamilyDetailContextValue) {
  const { ${CONTEXT_KEYS.join(', ')} } = props
  return (
${body.split('\n').map((l) => '    ' + l).join('\n')}
  )
}

export default function ${file}() {
  const ctx = useFamilyDetail()
  return <${file}Content {...ctx} />
}
`
  fs.writeFileSync(path.join(idDir, `_components/${file}.tsx`), content)
}

// Modal component
const modalStart = lines.findIndex((l) => l.startsWith('function Modal'))
const modalContent = lines.slice(modalStart, modalStart + 20).join('\n').replace('function Modal', 'export function Modal')
fs.writeFileSync(path.join(idDir, '_components/Modal.tsx'), `'use client'\n\nimport type React from 'react'\n\n${modalContent}\n`)

// FamilyModals
const modalsBody = extractModals()
const modalsContent = `'use client'

import dynamic from 'next/dynamic'
import TaskFormModal from '@/app/components/tasks/TaskFormModal'
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
  const { ${CONTEXT_KEYS.join(', ')} } = useFamilyDetail()

  return (
    <>
${modalsBody.split('\n').map((l) => '      ' + l).join('\n')}
    </>
  )
}
`
fs.writeFileSync(path.join(idDir, '_components/FamilyModals.tsx'), modalsContent)

console.log('Re-extracted tabs and modals from', sourcePath)
