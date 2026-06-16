/**
 * Build FamilyDetailContext + tab components from page.tsx
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

// Find component start/end
const compStart = lines.findIndex((l) => l.startsWith('export default function FamilyDetailPage'))
const compEnd = lines.findIndex((l, i) => i > compStart && l === '}' && lines[i + 1]?.startsWith('function Modal'))
const logicLines = lines.slice(compStart + 1, compEnd)

// Remove activeTab state line and URL tab effect block from logic
const filteredLogic = []
let skipUntil = -1
for (let i = 0; i < logicLines.length; i++) {
  if (skipUntil > i) continue
  const line = logicLines[i]
  if (line.includes("useState<'info' | 'members'")) continue
  if (line.includes('// Check URL params for tab navigation')) {
    // skip until closing }, []),  of effect
    let depth = 0
    for (let j = i; j < logicLines.length; j++) {
      if (logicLines[j].includes('useEffect(')) depth++
      if (logicLines[j].trim() === '}, [])') {
        skipUntil = j + 1
        break
      }
    }
    continue
  }
  if (line.includes("setActiveTab('info')")) {
    // replace admin gating effect body - keep effect but use router
    continue
  }
  filteredLogic.push(line)
}

// Fix admin gating effect - find and replace block
const logicStr = filteredLogic.join('\n')
  .replace(
    /useEffect\(\(\) => \{\s*if \(roleLoading\) return\s*if \(!isAdmin && ADMIN_ONLY_FAMILY_TABS\.has\(activeTab\)\) \{\s*setActiveTab\('info'\)\s*\}/s,
    `useEffect(() => {
    if (roleLoading || !familyId) return
    if (!isAdmin && ADMIN_ONLY_FAMILY_TABS.has(activeTab)) {
      router.replace(familyTabHref(familyId, 'info'))
    }`,
  )
  .replace(
    /window\.history\.replaceState\(\{\}, '', window\.location\.pathname \+ '\?tab=tasks'\)/g,
    "window.history.replaceState({}, '', window.location.pathname)",
  )
  .replace(
    /window\.history\.replaceState\(\{\}, '', window\.location\.pathname \+ '\?tab=members'\)/g,
    "window.history.replaceState({}, '', window.location.pathname)",
  )
  .replace(
    /urlParams\.get\('tab'\) !== 'tasks'/g,
    "activeTab !== 'tasks'",
  )

const contextHeader = `'use client'

import React, { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  PrinterIcon,
  DocumentArrowDownIcon,
  EnvelopeIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'
import { useToast, useConfirm } from '@/app/components/Toast'
import { useOrgRole } from '@/lib/client/useOrgRole'
import { useCurrency } from '@/lib/client/useCurrency'
import { escapeHtml } from '@/lib/html-escape'
import { DataView, EmptyState, type DataColumn } from '@/app/components/ui'
import {
  ADMIN_ONLY_FAMILY_TABS,
  familyTabFromPathname,
  familyTabHref,
  FAMILY_TAB_SEGMENTS,
  type FamilyTabId,
} from './_lib/constants'
import {
  formatPaymentMethod,
  formatPaymentAmount,
  paymentColumnsFor,
  paymentMobileCard,
  computeMemberDisplay,
  planColorForNumber,
  buildMemberColumns,
  handleHebrewInput,
  capitalizeName,
  formatPhone,
  validateEmail,
  type FamilyDetails,
  type PaymentPlan,
  type LifecycleEventType,
} from './_lib/helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FamilyDetailContextValue = Record<string, any>

const FamilyDetailContext = createContext<FamilyDetailContextValue | null>(null)

export function useFamilyDetail(): FamilyDetailContextValue {
  const ctx = useContext(FamilyDetailContext)
  if (!ctx) throw new Error('useFamilyDetail must be used within FamilyDetailProvider')
  return ctx
}

export function FamilyDetailProvider({ children }: { children: React.ReactNode }) {
`

const pathnameBlock = `
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const familyId = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : ''
  const activeTab: FamilyTabId = familyTabFromPathname(pathname, familyId)

  // Legacy ?tab= deep links → nested routes
  useEffect(() => {
    const tab = searchParams.get('tab') as FamilyTabId | null
    if (!tab || !(tab in FAMILY_TAB_SEGMENTS)) return
    const add = searchParams.get('add')
    const href = familyTabHref(familyId, tab) + (add ? \`?add=\${add}\` : '')
    router.replace(href)
  }, [searchParams, familyId, router])

  // tasks ?add=true deep link
  useEffect(() => {
    if (activeTab === 'tasks' && searchParams.get('add') === 'true') {
      setShowTaskModal(true)
      router.replace(familyTabHref(familyId, 'tasks'))
    }
  }, [activeTab, searchParams, familyId, router])

`

// Insert pathname block after params/router declarations
const logicWithPath = logicStr.replace(
  /const params = useParams\(\)\s*\n\s*const router = useRouter\(\)/,
  `const params = useParams()\n  const router = useRouter()${pathnameBlock}`,
)

// Remove loading/not-found returns and main return - replace with provider
const loadingStart = logicWithPath.indexOf('if (roleLoading || loading)')
const beforeLoading = logicWithPath.slice(0, loadingStart)

const contextFooter = `
  const contextValue = useMemo(
    () => ({
      params,
      router,
      pathname,
      familyId,
      activeTab,
      toast,
      confirm,
      isAdmin,
      roleLoading,
      formatMoney,
      data,
      setData,
      paymentPlans,
      lifecycleEventTypes,
      statements,
      loading,
      sendingEmail,
      emailConfig,
      showEmailModal,
      setShowEmailModal,
      emailFormData,
      setEmailFormData,
      familyTasks,
      loadingFamilyTasks,
      showTaskModal,
      setShowTaskModal,
      subFamilies,
      loadingSubFamilies,
      showInfoModal,
      setShowInfoModal,
      editingField,
      editValue,
      infoForm,
      setInfoForm,
      showMemberModal,
      setShowMemberModal,
      editingMember,
      setEditingMember,
      viewingMemberId,
      setViewingMemberId,
      memberActiveTab,
      setMemberActiveTab,
      memberBalance,
      memberPayments,
      memberStatements,
      loadingMemberFinancials,
      showPaymentModal,
      setShowPaymentModal,
      useStripe,
      setUseStripe,
      showEventModal,
      setShowEventModal,
      showWithdrawalModal,
      setShowWithdrawalModal,
      editingWithdrawal,
      setEditingWithdrawal,
      withdrawalForm,
      setWithdrawalForm,
      memberForm,
      setMemberForm,
      paymentForm,
      setPaymentForm,
      savedPaymentMethods,
      eventForm,
      setEventForm,
      fetchFamilyTasks,
      fetchFamilyDetails,
      fetchSubFamilies,
      fetchSavedPaymentMethods,
      fetchMemberFinancials,
      completeFamilyTask,
      deleteFamilyTask,
      getPlanNameById,
      getPlanName,
      handlePrintStatement,
      handleSavePDFStatement,
      handleSendStatementEmail,
      handleSaveEmailConfig,
      handlePrintAllStatements,
      openAddMemberModal,
      handleFieldEdit,
      handleFieldSave,
      handleFieldCancel,
      renderEditableField,
      renderEditableMemberField,
      handleMemberFieldEdit,
      handleMemberFieldSave,
      handleMemberFieldCancel,
      handleAddMember,
      handleEditMember,
      handleUpdateMember,
      handleDeleteMember,
      handleAddPayment,
      openAddWithdrawal,
      openEditWithdrawal,
      handleSaveWithdrawal,
      handleDeleteWithdrawal,
      handleAddEvent,
      updateEventAmount,
      getFamilyLastName,
      setSendingEmail,
      setEditingField,
      setEditValue,
      setEditingMemberField,
      setEditMemberValue,
      editingMemberField,
      editMemberValue,
    }),
    // Intentionally broad deps — mirrors original monolithic component
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      params, router, pathname, familyId, activeTab, data, loading, roleLoading, isAdmin,
      paymentPlans, lifecycleEventTypes, statements, familyTasks, subFamilies,
      viewingMemberId, memberActiveTab, memberBalance, memberPayments, memberStatements,
      showMemberModal, showPaymentModal, showEventModal, showWithdrawalModal, showInfoModal,
      showTaskModal, showEmailModal, editingField, editingMemberField, paymentForm, memberForm,
      withdrawalForm, eventForm, infoForm, emailFormData, savedPaymentMethods, sendingEmail,
    ],
  )

  return (
    <FamilyDetailContext.Provider value={contextValue}>
      {children}
    </FamilyDetailContext.Provider>
  )
}
`

// Check if handleUpdateFamilyInfo exists in page
const hasUpdateFamilyInfo = src.includes('handleUpdateFamilyInfo')
const hasOpenAddPayment = src.includes('openAddPayment')
const hasDeletePayment = src.includes('handleDeletePayment')

let footer = contextFooter
if (!hasUpdateFamilyInfo) {
  footer = footer.replace(/\s*handleUpdateFamilyInfo,\n/, '\n')
}
if (!hasOpenAddPayment) {
  footer = footer.replace(/\s*openAddPayment,\n/, '\n')
}
if (!hasDeletePayment) {
  footer = footer.replace(/\s*handleDeletePayment,\n/, '\n      handleDeleteEvent,\n      handleRefundPayment,\n'.replace('handleDeletePayment,\n      ', ''))
}

fs.writeFileSync(path.join(idDir, 'FamilyDetailContext.tsx'), contextHeader + beforeLoading + footer)

// Extract tabs by finding markers
function extractTab(id) {
  const open = `{activeTab === '${id}' && (`
  const startIdx = lines.findIndex((l) => l.trim() === open)
  if (startIdx === -1) throw new Error('Tab not found: ' + id)
  let contentStart = startIdx + 1
  for (let i = startIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.includes("activeTab ===") && i > startIdx) break
    if (t === ')}') {
      return lines.slice(contentStart, i).join('\n')
    }
  }
  throw new Error('Tab end not found: ' + id)
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
  const inner = extractTab(id).trim()
  const tabContent = `'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'

function ${file}Content(props: FamilyDetailContextValue) {
  return (
${inner.split('\n').map((l) => '    ' + l).join('\n')}
  )
}

import { useFamilyDetail } from '../FamilyDetailContext'

export default function ${file}() {
  const ctx = useFamilyDetail()
  return <${file}Content {...ctx} />
}
`
  fs.writeFileSync(path.join(idDir, `_components/${file}.tsx`), tabContent)
}

console.log('Built FamilyDetailContext and tab components')
