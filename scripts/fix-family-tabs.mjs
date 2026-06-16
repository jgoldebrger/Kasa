/** Fix tab components: destructure props + add imports */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const idDir = path.join(__dirname, '..', 'app/families/[id]')

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

const tabsDir = path.join(idDir, '_components')
for (const file of fs.readdirSync(tabsDir)) {
  if (!file.endsWith('Tab.tsx')) continue
  const filePath = path.join(tabsDir, file)
  let content = fs.readFileSync(filePath, 'utf8')
  const bodyMatch = content.match(/function \w+Content\(props: FamilyDetailContextValue\) \{\s*return \(\s*([\s\S]*)\s*\)\s*\}/)
  if (!bodyMatch) continue
  const body = bodyMatch[1]

  const usedIcons = ICONS.filter((i) => body.includes(i))
  const usedComponents = COMPONENTS.filter((c) => body.includes(c))
  const needsHebrew = body.includes('convertToHebrewDate') || body.includes('calculateHebrewAge')
  const needsFormatLocale = body.includes('formatLocaleDate')
  const needsIsFiniteDate = body.includes('isFiniteDate')
  const needsBuildMember = body.includes('buildMemberColumns') || body.includes('computeMemberDisplay')
  const needsPaymentHelpers = body.includes('paymentColumnsFor') || body.includes('paymentMobileCard')
  const needsPlanColor = body.includes('planColorForNumber')

  const imports = [`import type { FamilyDetailContextValue } from '../FamilyDetailContext'`]
  if (usedIcons.length) {
    imports.push(`import { ${usedIcons.join(', ')} } from '@heroicons/react/24/outline'`)
  }
  if (usedComponents.length) {
    imports.push(`import { ${usedComponents.join(', ')} } from '@/app/components/ui'`)
  }
  if (needsHebrew) {
    imports.push(`import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'`)
  }
  if (needsFormatLocale || needsIsFiniteDate) {
    imports.push(`import { formatLocaleDate${needsIsFiniteDate ? ', isFiniteDate' : ''} } from '@/lib/date-utils'`)
  }
  if (needsBuildMember || needsPaymentHelpers || needsPlanColor) {
    const helperImports = []
    if (needsBuildMember) helperImports.push('buildMemberColumns', 'computeMemberDisplay', 'getPlanName')
    if (needsPaymentHelpers) helperImports.push('paymentColumnsFor', 'paymentMobileCard')
    if (needsPlanColor) helperImports.push('planColorForNumber')
    imports.push(`import { ${[...new Set(helperImports)].join(', ')} } from '../_lib/helpers'`)
  }

  const name = file.replace('.tsx', '')
  const destructure = `  const { ${CONTEXT_KEYS.join(', ')} } = props`

  content = `'use client'

${imports.join('\n')}
import { useFamilyDetail } from '../FamilyDetailContext'

function ${name}Content(props: FamilyDetailContextValue) {
${destructure}
  return (
${body}
  )
}

export default function ${name}() {
  const ctx = useFamilyDetail()
  return <${name}Content {...ctx} />
}
`
  fs.writeFileSync(filePath, content)
}

console.log('Fixed tab components')
