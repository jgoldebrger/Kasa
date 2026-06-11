'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useParams, useRouter } from 'next/navigation'
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
import TaskFormModal from '@/app/components/tasks/TaskFormModal'
import dynamic from 'next/dynamic'
import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'
import { useToast, useConfirm } from '@/app/components/Toast'
import { useOrgRole } from '@/lib/client/useOrgRole'
import { useCurrency } from '@/lib/client/useCurrency'
import { netPaymentAmount } from '@/lib/money'
import { formatLocaleDate, isFiniteDate } from '@/lib/date-utils'
import { sanitizePaymentNotes } from '@/lib/payments/sanitize'

const ADMIN_ONLY_FAMILY_TABS = new Set([
  'payments',
  'withdrawals',
  'events',
  'cycle-charges',
  'statements',
  'tasks',
])

// Stripe Elements + stripe-js together are ~80 KB gzipped; only the
// "Add credit-card payment" flow needs them, so defer them until then.
const StripePaymentForm = dynamic(() => import('@/app/components/StripePaymentForm'), {
  ssr: false,
  loading: () => (
    <div className="p-4 bg-app-subtle rounded-lg border border-border text-sm text-fg-muted">
      Loading payment form…
    </div>
  ),
})
import { escapeHtml } from '@/lib/html-escape'
import { DataView, EmptyState, type DataColumn } from '@/app/components/ui'

function formatPaymentMethod(payment: any): string {
  if (!payment?.paymentMethod) return 'Cash'
  const labels: Record<string, string> = {
    cash: 'Cash',
    credit_card: payment.ccInfo?.last4 ? `Credit Card •••• ${payment.ccInfo.last4}` : 'Credit Card',
    check: payment.checkInfo?.checkNumber ? `Check #${payment.checkInfo.checkNumber}` : 'Check',
    quick_pay: 'Quick Pay',
  }
  return labels[payment.paymentMethod] || payment.paymentMethod
}

function formatPaymentAmount(
  p: { amount?: number; refundedAmount?: number | null },
  fmt: (n: number) => string,
) {
  const net = netPaymentAmount(p)
  const refunded = Number(p.refundedAmount || 0)
  if (refunded > 0) {
    return `${fmt(net)} (refunded ${fmt(refunded)})`
  }
  return fmt(net)
}

function paymentColumnsFor(tableHint: string, fmt: (n: number) => string): DataColumn<any>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      headerText: 'Date',
      cell: (p) => <span className="tabular">{formatLocaleDate(p.paymentDate)}</span>,
      exportValue: (p) => (p.paymentDate ? new Date(p.paymentDate) : ''),
      filter: { type: 'dateRange', getValue: (p) => p.paymentDate || null },
    },
    {
      id: 'amount',
      header: 'Amount',
      headerText: 'Amount',
      align: 'right',
      cell: (p) => (
        <span className="font-semibold tabular text-green-700 dark:text-green-400">
          {formatPaymentAmount(p, fmt)}
        </span>
      ),
      exportValue: (p) => netPaymentAmount(p),
      filter: { type: 'numberRange', getValue: (p) => netPaymentAmount(p) },
    },
    {
      id: 'type',
      header: 'Type',
      headerText: 'Type',
      hideBelow: 'md',
      cell: (p) => <span className="capitalize text-fg">{p.type}</span>,
      exportValue: (p) => p.type || '',
      filter: {
        type: 'multiselect',
        options: [
          { value: 'membership', label: 'Membership' },
          { value: 'donation', label: 'Donation' },
          { value: 'other', label: 'Other' },
        ],
      },
    },
    {
      id: 'method',
      header: 'Payment Method',
      headerText: 'Payment Method',
      hideBelow: 'md',
      cell: (p) => (
        <div>
          <div className="text-sm text-fg">{formatPaymentMethod(p)}</div>
          {p.paymentMethod === 'credit_card' && p.ccInfo?.cardType && (
            <div className="text-xs text-fg-muted">{p.ccInfo.cardType}</div>
          )}
          {p.paymentMethod === 'check' && p.checkInfo?.bankName && (
            <div className="text-xs text-fg-muted">{p.checkInfo.bankName}</div>
          )}
        </div>
      ),
      exportValue: (p) => formatPaymentMethod(p),
      filter: {
        type: 'multiselect',
        getValue: (p) => p.paymentMethod || 'cash',
        options: [
          { value: 'cash', label: 'Cash' },
          { value: 'credit_card', label: 'Credit Card' },
          { value: 'check', label: 'Check' },
          { value: 'quick_pay', label: 'Quick Pay' },
        ],
      },
    },
    {
      id: 'year',
      header: 'Year',
      headerText: 'Year',
      hideBelow: 'lg',
      cell: (p) => <span className="text-fg-muted tabular">{p.year}</span>,
      exportValue: (p) => p.year || '',
      filter: { type: 'select', getValue: (p) => (p.year ? String(p.year) : '') },
    },
    {
      id: `${tableHint}-notes`,
      header: 'Notes',
      headerText: 'Notes',
      hideBelow: 'lg',
      defaultHidden: true,
      cell: (p) => (
        <span className="text-fg-muted text-sm">{sanitizePaymentNotes(p.notes) || '—'}</span>
      ),
      exportValue: (p) => sanitizePaymentNotes(p.notes),
    },
  ]
}

function paymentMobileCard(p: any, fmt: (n: number) => string) {
  return (
    <div className="surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-fg tabular">{formatPaymentAmount(p, fmt)}</div>
          <div className="text-xs text-fg-muted capitalize">{p.type}</div>
        </div>
        <div className="text-right text-xs">
          <div className="text-fg-muted tabular">{new Date(p.paymentDate).toLocaleDateString()}</div>
          <div className="text-fg">{formatPaymentMethod(p)}</div>
        </div>
      </div>
      {p.notes && (
        <div className="mt-2 text-xs text-fg-muted">{sanitizePaymentNotes(p.notes)}</div>
      )}
    </div>
  )
}

/**
 * Compute the derived display info (age, hebrew date, plan text/color) for a
 * family member. Centralized so the desktop table, mobile card, and CSV/XLSX
 * export all produce identical values.
 */
function computeMemberDisplay(
  member: any,
  paymentPlans: any[],
  getPlanName: (n: number) => string,
  fmt: (n: number) => string,
): { age: number; displayHebrewDate: string | null; planText: string; planColor: string } {
  let displayHebrewDate = member.hebrewBirthDate
  if (!displayHebrewDate && member.birthDate) {
    displayHebrewDate = convertToHebrewDate(new Date(member.birthDate))
  }

  let age: number
  const gregAge = () => {
    const today = new Date()
    const birthDate = new Date(member.birthDate)
    let a = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) a--
    return a
  }
  if (displayHebrewDate) {
    const hebrewAge = calculateHebrewAge(displayHebrewDate)
    age = hebrewAge !== null ? hebrewAge : gregAge()
  } else {
    age = gregAge()
  }

  let planText = ''
  let planColor = 'text-fg-muted'
  if (member.paymentPlan && member.paymentPlanAssigned) {
    const assignedPlan = member.paymentPlan as number
    const planName = getPlanName(assignedPlan)
    // Lookup price by planNumber on the actual PaymentPlan records — no
    // hardcoded fallback. If the org has no plan with that number (e.g. it
    // was deleted) the price simply shows as $0 and the user can fix the
    // assignment in Settings.
    const planRecord = paymentPlans.find((p: any) => p.planNumber === assignedPlan)
    const planPrice = planRecord?.yearlyPrice ?? 0
    planText = `${planName} - ${fmt(planPrice)}`
    planColor = planColorForNumber(assignedPlan)
  }
  if (age === 13 && displayHebrewDate && member.gender === 'male') {
    planText += ' (Bar Mitzvah Age)'
  } else if (age === 13 && displayHebrewDate && member.gender === 'female') {
    planText += ' (Bat Mitzvah Age)'
  }
  return { age, displayHebrewDate: displayHebrewDate || null, planText, planColor }
}

// Deterministic Tailwind color classes for a given planNumber. We can't
// build class names dynamically (Tailwind purges anything it can't see
// statically), so each palette slot is a literal class string.
const PLAN_COLOR_PALETTE = [
  'text-accent',
  'text-green-600 dark:text-green-400',
  'text-purple-600 dark:text-purple-400',
  'text-orange-600 dark:text-orange-400',
  'text-pink-600 dark:text-pink-400',
  'text-amber-600 dark:text-amber-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-rose-600 dark:text-rose-400',
] as const
function planColorForNumber(planNumber: number | null | undefined): string {
  if (!planNumber || planNumber < 1) return 'text-fg-muted'
  const idx = (planNumber - 1) % PLAN_COLOR_PALETTE.length
  return PLAN_COLOR_PALETTE[idx]
}

function buildMemberColumns({
  paymentPlans,
  getPlanName,
  viewingMemberId,
  setViewingMemberId,
  onEdit,
  onDelete,
  canMutate = true,
  formatMoney,
}: {
  paymentPlans: any[]
  getPlanName: (n: number) => string
  viewingMemberId: string | null
  setViewingMemberId: (id: string | null) => void
  onEdit: (m: any) => void
  onDelete: (m: any) => void
  canMutate?: boolean
  formatMoney: (n: number) => string
}): DataColumn<any>[] {
  const columns: DataColumn<any>[] = [
    {
      id: 'name',
      header: 'Name',
      headerText: 'Name',
      cell: (m) => (
        <button
          onClick={() =>
            setViewingMemberId(viewingMemberId === m._id ? null : m._id)
          }
          className="focus-ring font-medium text-accent hover:text-accent-hover hover:underline text-left rounded"
        >
          {m.firstName} {m.lastName}
        </button>
      ),
      exportValue: (m) => `${m.firstName || ''} ${m.lastName || ''}`.trim(),
    },
    {
      id: 'birthDate',
      header: 'Birth Date',
      headerText: 'Birth Date',
      cell: (m) => <span className="tabular text-fg-muted">{new Date(m.birthDate).toLocaleDateString()}</span>,
      exportValue: (m) => (m.birthDate ? new Date(m.birthDate) : ''),
    },
    {
      id: 'hebrewDate',
      header: 'Hebrew Date',
      headerText: 'Hebrew Date',
      hideBelow: 'md',
      cell: (m) => {
        const { displayHebrewDate } = computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney)
        return displayHebrewDate ? (
          <div className="text-fg-muted">
            <div className="font-medium">{displayHebrewDate}</div>
            {m.barMitzvahDate && (
              <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                Bar/Bat Mitzvah: {new Date(m.barMitzvahDate).toLocaleDateString()}
              </div>
            )}
          </div>
        ) : (
          <span className="text-fg-subtle">Calculating...</span>
        )
      },
      exportValue: (m) => computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney).displayHebrewDate || '',
    },
    {
      id: 'age',
      header: 'Current Age',
      headerText: 'Current Age',
      align: 'right',
      cell: (m) => {
        const { age } = computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney)
        return (
          <span>
            <span className="font-semibold text-fg tabular">{age}</span>
            <span className="text-fg-muted text-sm ml-1">years</span>
          </span>
        )
      },
      exportValue: (m) => computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney).age,
    },
    {
      id: 'plan',
      header: 'Payment Plan',
      headerText: 'Payment Plan',
      hideBelow: 'lg',
      cell: (m) => {
        const { planText, planColor } = computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney)
        return <span className={`font-medium ${planColor}`}>{planText}</span>
      },
      exportValue: (m) => computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney).planText,
    },
    {
      id: 'gender',
      header: 'Gender',
      headerText: 'Gender',
      hideBelow: 'lg',
      cell: (m) => <span className="capitalize text-fg-muted">{m.gender || '—'}</span>,
      exportValue: (m) => m.gender || '',
    },
    {
      id: 'actions',
      header: 'Actions',
      headerText: 'Actions',
      align: 'right',
      cell: (m) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(m)}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
            title="Edit member"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(m)}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            title="Delete member"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ),
      exportValue: () => '',
    },
  ]

  if (!canMutate) {
    return columns.filter((c) => c.id !== 'actions' && c.id !== 'plan')
  }
  return columns
}

// QWERTY to Hebrew keyboard mapping
const qwertyToHebrew: { [key: string]: string } = {
  // Lowercase letters
  'q': '/', 'w': "'", 'e': 'ק', 'r': 'ר', 't': 'א', 'y': 'ט', 'u': 'ו', 'i': 'ן', 'o': 'ם', 'p': 'פ',
  'a': 'ש', 's': 'ד', 'd': 'ג', 'f': 'כ', 'g': 'ע', 'h': 'י', 'j': 'ח', 'k': 'ל', 'l': 'ך',
  'z': 'ז', 'x': 'ס', 'c': 'ב', 'v': 'ה', 'b': 'נ', 'n': 'מ', 'm': 'צ',
  // Uppercase letters (with Shift)
  'Q': '/', 'W': "'", 'E': 'ק', 'R': 'ר', 'T': 'א', 'Y': 'ט', 'U': 'ו', 'I': 'ן', 'O': 'ם', 'P': 'פ',
  'A': 'ש', 'S': 'ד', 'D': 'ג', 'F': 'כ', 'G': 'ע', 'H': 'י', 'J': 'ח', 'K': 'ל', 'L': 'ך',
  'Z': 'ז', 'X': 'ס', 'C': 'ב', 'V': 'ה', 'B': 'נ', 'N': 'מ', 'M': 'צ',
  // Numbers and special characters
  '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '0': '0',
  '-': '-', '=': '=', '[': ']', ']': '[', '\\': '\\', ';': 'ף', "'": ',', ',': 'ת', '.': 'ץ', '/': '.',
  ' ': ' ' // Space
}

// Handler for Hebrew input fields
const handleHebrewInput = (e: React.KeyboardEvent<HTMLInputElement>, currentValue: string, setValue: (value: string) => void) => {
  const input = e.currentTarget
  const cursorPosition = input.selectionStart || 0
  
  // Only convert if typing a regular character (not special keys like Backspace, Delete, Arrow keys, etc.)
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    const hebrewChar = qwertyToHebrew[e.key] || e.key
    const newValue = currentValue.slice(0, cursorPosition) + hebrewChar + currentValue.slice(cursorPosition)
    setValue(newValue)
    
    // Set cursor position after the inserted character
    setTimeout(() => {
      input.setSelectionRange(cursorPosition + 1, cursorPosition + 1)
    }, 0)
  }
}

// Helper function to capitalize first letter of each word
const capitalizeName = (text: string): string => {
  if (!text) return text
  return text
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Helper function to format phone number (numbers only)
const formatPhone = (value: string): string => {
  // Remove all non-numeric characters
  return value.replace(/\D/g, '')
}

// Helper function to validate email format
const validateEmail = (email: string): boolean => {
  if (!email) return true // Empty is valid (optional field)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

interface FamilyDetails {
  family: any
  members: any[]
  payments: any[]
  withdrawals: any[]
  lifecycleEvents: any[]
  cycleCharges: any[]
  balance: any
}

interface PaymentPlan {
  _id: string
  name: string
  yearlyPrice: number
  planNumber?: number
}

interface LifecycleEventType {
  _id: string
  type: string
  name: string
  amount: number
}

export default function FamilyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const { isAdmin, loading: roleLoading } = useOrgRole()
  const { format: formatMoney } = useCurrency()
  const [data, setData] = useState<FamilyDetails | null>(null)
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([])
  const [lifecycleEventTypes, setLifecycleEventTypes] = useState<LifecycleEventType[]>([])
  const [statements, setStatements] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)
  const [emailConfig, setEmailConfig] = useState<any>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailFormData, setEmailFormData] = useState({
    email: '',
    password: '',
    fromName: 'Kasa Family Management'
  })
  const [activeTab, setActiveTab] = useState<'info' | 'members' | 'payments' | 'withdrawals' | 'events' | 'cycle-charges' | 'statements' | 'sub-families' | 'tasks'>('info')
  const [familyTasks, setFamilyTasks] = useState<any[]>([])
  const [loadingFamilyTasks, setLoadingFamilyTasks] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [subFamilies, setSubFamilies] = useState<any[]>([])
  const [loadingSubFamilies, setLoadingSubFamilies] = useState(false)
  const [showInfoModal, setShowInfoModal] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [infoForm, setInfoForm] = useState({
    name: '',
    hebrewName: '',
    weddingDate: '',
    husbandFirstName: '',
    husbandHebrewName: '',
    husbandFatherHebrewName: '',
    wifeFirstName: '',
    wifeHebrewName: '',
    wifeFatherHebrewName: '',
    husbandCellPhone: '',
    wifeCellPhone: '',
    address: '',
    street: '',
    phone: '',
    email: '',
    city: '',
    state: '',
    zip: '',
    paymentPlanId: ''
  })
  
  // Check URL params for tab navigation
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const tab = urlParams.get('tab')
    if (tab === 'info' || tab === 'members' || tab === 'payments' || tab === 'withdrawals' || tab === 'events' || tab === 'cycle-charges' || tab === 'statements' || tab === 'sub-families' || tab === 'tasks') {
      setActiveTab(tab as any)
      // Auto-open modal if coming from quick add
      if (tab === 'members' && urlParams.get('add') === 'true') {
        // Will be handled after data loads
      }
      if (tab === 'tasks' && urlParams.get('add') === 'true') {
        setShowTaskModal(true)
        window.history.replaceState({}, '', window.location.pathname + '?tab=tasks')
      }
    }
  }, [])
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [editingMember, setEditingMember] = useState<any>(null)
  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null)
  const [memberActiveTab, setMemberActiveTab] = useState<'info' | 'balance' | 'payments' | 'statements'>('info')
  const [memberBalance, setMemberBalance] = useState<any>(null)
  const [memberPayments, setMemberPayments] = useState<any[]>([])
  const [memberStatements, setMemberStatements] = useState<any[]>([])
  const [loadingMemberFinancials, setLoadingMemberFinancials] = useState(false)
  const [editingMemberField, setEditingMemberField] = useState<string | null>(null)
  const [editMemberValue, setEditMemberValue] = useState<string>('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [useStripe, setUseStripe] = useState(false)
  const [showEventModal, setShowEventModal] = useState(false)
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)
  const [editingWithdrawal, setEditingWithdrawal] = useState<any | null>(null)
  const [withdrawalForm, setWithdrawalForm] = useState({
    amount: 0,
    withdrawalDate: new Date().toISOString().split('T')[0],
    reason: '',
    notes: '',
  })
  const [memberForm, setMemberForm] = useState({
    firstName: '',
    hebrewFirstName: '',
    lastName: '',
    hebrewLastName: '',
    birthDate: '',
    hebrewBirthDate: '',
    gender: '' as '' | 'male' | 'female',
    weddingDate: '',
    spouseName: '',
    spouseFirstName: '',
    spouseHebrewName: '',
    spouseFatherHebrewName: '',
    spouseCellPhone: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: ''
  })
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    paymentDate: new Date().toISOString().split('T')[0],
    year: new Date().getFullYear(),
    type: 'membership' as 'membership' | 'donation' | 'other',
    paymentMethod: 'cash' as 'cash' | 'credit_card' | 'check' | 'quick_pay',
    paymentFrequency: 'one-time' as 'one-time' | 'monthly',
    paymentFor: 'family' as 'family' | 'member', // New field: payment for family or member
    memberId: '', // New field: selected member ID if paymentFor is 'member'
    saveCard: false,
    useSavedCard: false,
    selectedSavedCardId: '',
    // Credit Card Info
    ccLast4: '',
    ccCardType: '',
    ccExpiryMonth: '',
    ccExpiryYear: '',
    ccNameOnCard: '',
    // Check Info
    checkNumber: '',
    checkBankName: '',
    checkRoutingNumber: '',
    notes: ''
  })
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([])
  const {
    begin: beginFamilyFetch,
    invalidate: invalidateFamilyFetch,
    isStale: isFamilyFetchStale,
    current: currentFamilyFetchGen,
  } = useRequestGeneration()
  const {
    begin: beginTasksFetch,
    invalidate: invalidateTasksFetch,
    isStale: isTasksFetchStale,
  } = useRequestGeneration()
  const {
    begin: beginSavedCardsFetch,
    invalidate: invalidateSavedCardsFetch,
    isStale: isSavedCardsFetchStale,
  } = useRequestGeneration()
  const memberFetchGenRef = useRef(0)
  // Per-handler re-entrancy locks. Double-click on Add Payment, Save
  // Withdrawal, etc. previously fired two POSTs back-to-back and
  // created duplicate ledger rows. Each handler now early-returns
  // while the previous call is still in flight.
  const paymentSubmittingRef = useRef(false)
  const withdrawalSubmittingRef = useRef(false)
  const eventSubmittingRef = useRef(false)
  
  // Pagination is now owned by <DataView> via the `pageSize` prop.

  // Disable Stripe if amount is 0 or less
  useEffect(() => {
    if (paymentForm.amount <= 0) {
      setUseStripe(false)
    }
  }, [paymentForm.amount])

  // Form starts empty — populated from `lifecycleEventTypes` once they
  // arrive (see effect below). No hardcoded defaults.
  const [eventForm, setEventForm] = useState({
    eventType: '' as string,
    amount: 0,
    eventDate: new Date().toISOString().split('T')[0],
    year: new Date().getFullYear(),
    notes: ''
  })

  useEffect(() => {
    if (roleLoading) return
    const gen = beginFamilyFetch()
    if (params.id) {
      setLoading(true)
      fetchFamilyDetails(gen)
      fetchSubFamilies(gen)
    }
    return () => {
      invalidateFamilyFetch()
    }
    // fetchFamilyDetails / fetchSubFamilies use the generation counter above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, roleLoading, beginFamilyFetch, invalidateFamilyFetch])

  useEffect(() => {
    if (roleLoading || !isAdmin || !params.id) return
    const gen = currentFamilyFetchGen()
    fetchStatements(gen)
    fetchPaymentPlans(gen)
    fetchLifecycleEventTypes(gen)
    fetchEmailConfig(gen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, isAdmin, roleLoading, currentFamilyFetchGen])

  useEffect(() => {
    if (roleLoading) return
    if (!isAdmin && ADMIN_ONLY_FAMILY_TABS.has(activeTab)) {
      setActiveTab('info')
    }
    if (!isAdmin && memberActiveTab !== 'info') {
      setMemberActiveTab('info')
    }
  }, [isAdmin, roleLoading, activeTab, memberActiveTab])

  const fetchSubFamilies = async (sharedGen?: number) => {
    const familyId = params.id
    if (!familyId) return
    const gen = sharedGen ?? beginFamilyFetch()
    setLoadingSubFamilies(true)
    try {
      const res = await fetch(`/api/families/${familyId}/sub-families`)
      if (isFamilyFetchStale(gen)) return
      if (res.ok) {
        const data = await res.json().catch(() => [])
        if (isFamilyFetchStale(gen)) return
        setSubFamilies(data || [])
      }
    } catch (error) {
      if (isFamilyFetchStale(gen)) return
      console.error('Error fetching sub-families:', error)
    } finally {
      if (!isFamilyFetchStale(gen)) setLoadingSubFamilies(false)
    }
  }

  const fetchFamilyTasks = useCallback(async () => {
    const familyId = params.id
    if (!familyId) return
    const gen = beginTasksFetch()
    setLoadingFamilyTasks(true)
    try {
      const res = await fetch(`/api/tasks?relatedFamilyId=${familyId}`)
      if (isTasksFetchStale(gen)) return
      if (res.ok) {
        const data = await res.json().catch(() => [])
        if (isTasksFetchStale(gen)) return
        setFamilyTasks(Array.isArray(data) ? data : [])
      } else {
        if (isTasksFetchStale(gen)) return
        setFamilyTasks([])
      }
    } catch (error) {
      if (isTasksFetchStale(gen)) return
      console.error('Error fetching family tasks:', error)
      setFamilyTasks([])
    } finally {
      if (!isTasksFetchStale(gen)) setLoadingFamilyTasks(false)
    }
  }, [params.id, beginTasksFetch, isTasksFetchStale])

  useEffect(() => {
    if (activeTab === 'tasks' && params.id) {
      void fetchFamilyTasks()
    }
  }, [activeTab, params.id, fetchFamilyTasks])

  const completeFamilyTask = async (taskId: string) => {
    const prev = familyTasks
    setFamilyTasks((cur) =>
      cur.map((t) => (t._id === taskId ? { ...t, status: 'completed' } : t)),
    )
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) throw new Error()
      toast.success('Task completed.')
    } catch {
      setFamilyTasks(prev)
      toast.error('Could not complete task.')
    }
  }

  const deleteFamilyTask = async (task: any) => {
    if (
      !(await confirm({
        title: 'Delete task?',
        message: `“${task.title}” will be permanently removed.`,
        destructive: true,
        confirmLabel: 'Delete',
      }))
    )
      return
    try {
      const res = await fetch(`/api/tasks/${task._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      fetchFamilyTasks()
      toast.success('Task deleted.')
    } catch {
      toast.error('Could not delete task.')
    }
  }

  const fetchSavedPaymentMethods = useCallback(async () => {
    const familyId = params.id
    if (!familyId) return
    const gen = beginSavedCardsFetch()
    try {
      const res = await fetch(`/api/families/${familyId}/saved-payment-methods`)
      if (isSavedCardsFetchStale(gen)) return
      if (res.ok) {
        const data = await res.json().catch(() => [])
        if (isSavedCardsFetchStale(gen)) return
        setSavedPaymentMethods(data || [])
      }
    } catch (error) {
      if (isSavedCardsFetchStale(gen)) return
      console.error('Error fetching saved payment methods:', error)
      setSavedPaymentMethods([])
    }
  }, [params.id, beginSavedCardsFetch, isSavedCardsFetchStale])

  // Fetch saved payment methods when payment modal opens or credit card is selected
  useEffect(() => {
    if (showPaymentModal && paymentForm.paymentMethod === 'credit_card' && params.id) {
      void fetchSavedPaymentMethods()
    }
  }, [showPaymentModal, paymentForm.paymentMethod, params.id, fetchSavedPaymentMethods])

  // Fetch member financial data when viewing a member
  useEffect(() => {
    if (!viewingMemberId) {
      setMemberBalance(null)
      setMemberPayments([])
      setMemberStatements([])
      return
    }
    const gen = ++memberFetchGenRef.current
    void (async () => {
      if (!viewingMemberId || !isAdmin) return
      setLoadingMemberFinancials(true)
      try {
        if (memberActiveTab === 'balance') {
          const res = await fetch(`/api/members/${viewingMemberId}/balance`)
          if (memberFetchGenRef.current !== gen) return
          if (res.ok) {
            const balance = await res.json().catch(() => null)
            if (memberFetchGenRef.current !== gen) return
            setMemberBalance(balance)
          } else {
            if (memberFetchGenRef.current !== gen) return
            toast.error('Could not load member balance.')
          }
        } else if (memberActiveTab === 'payments') {
          const res = await fetch(`/api/members/${viewingMemberId}/payments`)
          if (memberFetchGenRef.current !== gen) return
          if (res.ok) {
            const payments = await res.json().catch(() => [])
            if (memberFetchGenRef.current !== gen) return
            setMemberPayments(payments)
          } else {
            if (memberFetchGenRef.current !== gen) return
            toast.error('Could not load member payments.')
          }
        } else if (memberActiveTab === 'statements') {
          const res = await fetch(`/api/members/${viewingMemberId}/statements`)
          if (memberFetchGenRef.current !== gen) return
          if (res.ok) {
            const statements = await res.json().catch(() => [])
            if (memberFetchGenRef.current !== gen) return
            setMemberStatements(statements)
          } else {
            if (memberFetchGenRef.current !== gen) return
            toast.error('Could not load member statements.')
          }
        }
      } catch (error) {
        if (memberFetchGenRef.current !== gen) return
        console.error('Error fetching member financials:', error)
      } finally {
        if (memberFetchGenRef.current === gen) setLoadingMemberFinancials(false)
      }
    })()
    return () => {
      memberFetchGenRef.current += 1
    }
  }, [viewingMemberId, memberActiveTab, isAdmin, toast])

  const fetchMemberFinancials = async () => {
    if (!viewingMemberId || !isAdmin) return
    const gen = ++memberFetchGenRef.current
    setLoadingMemberFinancials(true)
    try {
      if (memberActiveTab === 'balance') {
        const res = await fetch(`/api/members/${viewingMemberId}/balance`)
        if (memberFetchGenRef.current !== gen) return
        if (res.ok) {
          const balance = await res.json().catch(() => null)
          if (memberFetchGenRef.current !== gen) return
          setMemberBalance(balance)
        } else {
          if (memberFetchGenRef.current !== gen) return
          toast.error('Could not load member balance.')
        }
      } else if (memberActiveTab === 'payments') {
        const res = await fetch(`/api/members/${viewingMemberId}/payments`)
        if (memberFetchGenRef.current !== gen) return
        if (res.ok) {
          const payments = await res.json().catch(() => [])
          if (memberFetchGenRef.current !== gen) return
          setMemberPayments(payments)
        } else {
          if (memberFetchGenRef.current !== gen) return
          toast.error('Could not load member payments.')
        }
      } else if (memberActiveTab === 'statements') {
        const res = await fetch(`/api/members/${viewingMemberId}/statements`)
        if (memberFetchGenRef.current !== gen) return
        if (res.ok) {
          const statements = await res.json().catch(() => [])
          if (memberFetchGenRef.current !== gen) return
          setMemberStatements(statements)
        } else {
          if (memberFetchGenRef.current !== gen) return
          toast.error('Could not load member statements.')
        }
      }
    } catch (error) {
      if (memberFetchGenRef.current !== gen) return
      console.error('Error fetching member financials:', error)
    } finally {
      if (memberFetchGenRef.current === gen) setLoadingMemberFinancials(false)
    }
  }

  const fetchEmailConfig = async (sharedGen?: number) => {
    const gen = sharedGen ?? beginFamilyFetch()
    try {
      const res = await fetch('/api/email-config')
      if (isFamilyFetchStale(gen)) return
      if (res.ok) {
        const config = await res.json().catch(() => ({}))
        if (isFamilyFetchStale(gen)) return
        // 200 + `{ configured: false }` means no email config exists yet.
        if (config?.configured === false || !config?.email) {
          setEmailConfig(null)
        } else {
          setEmailConfig(config)
          setEmailFormData(prev => ({
            ...prev,
            email: config.email,
            fromName: config.fromName || 'Kasa Family Management'
            // Note: Password is not returned for security reasons
          }))
        }
      }
    } catch (error) {
      if (isFamilyFetchStale(gen)) return
      console.error('Error fetching email config:', error)
    }
  }

  const fetchPaymentPlans = async (sharedGen?: number) => {
    const gen = sharedGen ?? beginFamilyFetch()
    try {
      const res = await fetch('/api/payment-plans')
      if (isFamilyFetchStale(gen)) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      if (isFamilyFetchStale(gen)) return
      if (Array.isArray(data)) {
        setPaymentPlans(data)
      }
    } catch (error) {
      if (isFamilyFetchStale(gen)) return
      console.error('Error fetching payment plans:', error)
    }
  }

  const fetchLifecycleEventTypes = async (sharedGen?: number) => {
    const gen = sharedGen ?? beginFamilyFetch()
    try {
      const res = await fetch('/api/lifecycle-event-types')
      if (isFamilyFetchStale(gen)) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      if (isFamilyFetchStale(gen)) return
      if (Array.isArray(data)) {
        setLifecycleEventTypes(data)
        // Pre-fill the event form with the first configured type so the
        // modal isn't empty on first open. No fallback type/amount.
        if (data.length > 0) {
          setEventForm({
            eventType: data[0].type,
            amount: data[0].amount,
            eventDate: new Date().toISOString().split('T')[0],
            year: new Date().getFullYear(),
            notes: '',
          })
        }
      }
    } catch (error) {
      if (isFamilyFetchStale(gen)) return
      console.error('Error fetching lifecycle event types:', error)
    }
  }

  const fetchStatements = async (sharedGen?: number) => {
    const familyId = params.id
    if (!familyId) return
    const gen = sharedGen ?? beginFamilyFetch()
    try {
      const res = await fetch(`/api/statements?familyId=${familyId}`)
      if (isFamilyFetchStale(gen)) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      if (isFamilyFetchStale(gen)) return
      if (Array.isArray(data)) {
        // Sort by date (newest first)
        const sorted = data.sort((a: any, b: any) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )
        setStatements(sorted)
      }
    } catch (error) {
      if (isFamilyFetchStale(gen)) return
      console.error('Error fetching statements:', error)
    }
  }

  const getPlanNameById = (planId: string): string => {
    if (!planId) return 'No Plan'
    const plan = paymentPlans.find(p => p._id === planId)
    return plan ? plan.name : 'Unknown Plan'
  }

  const handlePrintStatement = async (statement: any) => {
    try {
      // Fetch transaction details
      const res = await fetch(`/api/statements/${statement._id}`)
      if (!res.ok) {
        toast.error('Failed to load statement for printing')
        return
      }
      const data = await res.json().catch(() => ({}))
      const transactions = data.transactions || []

      const printWindow = window.open('', '_blank')
      if (printWindow) {
        const transactionsHTML = transactions.length > 0 ? `
          <h2 style="margin-top: 30px; margin-bottom: 15px;">Transaction Details</h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Type</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Description</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Amount</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${transactions.map((t: any) => `
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(new Date(t.date).toLocaleDateString())}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${t.type === 'payment' ? 'Payment' : t.type === 'withdrawal' ? 'Withdrawal' : t.type === 'cycle-charge' ? 'Annual Dues' : 'Event'}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(t.description)}</td>
                  <td style="padding: 8px; border: 1px solid #ddd; text-align: right; ${t.amount >= 0 ? 'color: green;' : 'color: red;'}">${t.amount > 0 ? '+' : ''}${formatMoney(t.amount)}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(t.notes || '-')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''

        printWindow.document.write(`
          <html>
            <head>
              <title>Statement ${escapeHtml(statement.statementNumber)}</title>
              <style>
                @media print {
                  @page { margin: 1cm; }
                  body { margin: 0; }
                }
              </style>
            </head>
            <body style="font-family: Arial, sans-serif; padding: 40px; line-height: 1.6;">
              <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px;">
                <h1 style="margin: 0; color: #333;">Kasa Family Management</h1>
                <h2 style="margin: 10px 0 0 0; color: #666; font-weight: normal;">Statement</h2>
              </div>
              
              <div style="margin-bottom: 30px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 5px 0;"><strong>Statement Number:</strong> ${escapeHtml(statement.statementNumber)}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Date:</strong> ${escapeHtml(new Date(statement.date).toLocaleDateString())}</td>
                  </tr>
                  <tr>
                    <td style="padding: 5px 0;"><strong>Family:</strong> ${escapeHtml(data?.family?.name || 'N/A')}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Period:</strong> ${escapeHtml(new Date(statement.fromDate).toLocaleDateString())} - ${escapeHtml(new Date(statement.toDate).toLocaleDateString())}</td>
                  </tr>
                </table>
              </div>

              <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Opening Balance:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;">${formatMoney(statement.openingBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Income:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: green;">${formatMoney(statement.income)}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Withdrawals:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.withdrawals)}</td>
                </tr>
                ${(statement.cycleCharges || 0) > 0 ? `
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Annual Dues Charged:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.cycleCharges || 0)}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Expenses:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: red;">${formatMoney(statement.expenses)}</td>
                </tr>
                <tr style="background-color: #f0f0f0;">
                  <td style="padding: 10px; font-weight: bold; font-size: 1.1em;">Closing Balance:</td>
                  <td style="padding: 10px; text-align: right; font-weight: bold; font-size: 1.1em;">${formatMoney(statement.closingBalance)}</td>
                </tr>
              </table>
              
              ${transactionsHTML}
              
              <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 0.9em;">
                <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
                <p>Kasa Family Management System</p>
              </div>
            </body>
          </html>
        `)
        printWindow.document.close()
        printWindow.print()
      }
    } catch (error) {
      console.error('Error printing statement:', error)
      toast.error('Error printing statement')
    }
  }

  const handleSavePDFStatement = async (statement: any) => {
    await handlePrintStatement(statement)
    // Browser's print dialog allows saving as PDF
  }

  const handleSendStatementEmail = async (statement: any) => {
    if (!data?.family?.email) {
      toast.error('This family does not have an email address. Please add an email address in the Contacts tab.')
      return
    }

    // Check if email config exists in database
    if (!emailConfig?.email) {
      // Show modal to configure email
      setShowEmailModal(true)
      return
    }

    setSendingEmail(statement._id)
    
    try {
      const emailRes = await fetch('/api/statements/send-single-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement: { _id: statement._id } }),
      })

      const emailResult = await emailRes.json().catch(() => ({}))
      
      if (emailRes.ok) {
        toast.success(`Statement sent successfully to ${data.family.email}`)
      } else {
        throw new Error(emailResult.error || 'Failed to send email')
      }
    } catch (error: any) {
      console.error('Error sending statement email:', error)
      toast.error(`Error sending email: ${error.message}`)
    } finally {
      setSendingEmail(null)
    }
  }

  const handleSaveEmailConfig = async () => {
    if (!emailFormData.email || !emailFormData.password) {
      toast.error('Please enter both email address and password')
      return
    }

    try {
      const res = await fetch('/api/email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailFormData)
      })
      
      if (res.ok) {
        const config = await res.json().catch(() => ({}))
        setEmailConfig(config)
        setShowEmailModal(false)
        toast.success('Email configuration saved successfully. You can now send statements.')
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(`Error: ${error.error || 'Failed to save email configuration'}`)
      }
    } catch (error) {
      console.error('Error saving email config:', error)
      toast.error('Error saving email configuration')
    }
  }

  const handlePrintAllStatements = async () => {
    if (!data?.family) return

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      let allStatementsHTML = ''
      
      for (const statement of statements) {
        try {
          const res = await fetch(`/api/statements/${statement._id}`)
          if (!res.ok) continue
          const statementData = await res.json().catch(() => ({}))
          const transactions = statementData.transactions || []

          const transactionsHTML = transactions.length > 0 ? `
            <h3 style="margin-top: 20px; margin-bottom: 10px; font-size: 1em;">Transaction Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.9em;">
              <thead>
                <tr style="background-color: #f5f5f5;">
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Type</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Description</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${transactions.map((t: any) => `
                  <tr>
                    <td style="padding: 6px; border: 1px solid #ddd;">${escapeHtml(new Date(t.date).toLocaleDateString())}</td>
                    <td style="padding: 6px; border: 1px solid #ddd;">${t.type === 'payment' ? 'Payment' : t.type === 'withdrawal' ? 'Withdrawal' : t.type === 'cycle-charge' ? 'Annual Dues' : 'Event'}</td>
                    <td style="padding: 6px; border: 1px solid #ddd;">${escapeHtml(t.description)}</td>
                    <td style="padding: 6px; border: 1px solid #ddd; text-align: right; ${t.amount >= 0 ? 'color: green;' : 'color: red;'}">${t.amount > 0 ? '+' : ''}${formatMoney(t.amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : ''

          allStatementsHTML += `
            <div style="page-break-after: always; margin-bottom: 40px;">
              <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px;">
                <h1 style="margin: 0; color: #333; font-size: 1.5em;">Kasa Family Management</h1>
                <h2 style="margin: 5px 0 0 0; color: #666; font-weight: normal; font-size: 1.2em;">Statement</h2>
              </div>
              
              <div style="margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 5px 0;"><strong>Statement Number:</strong> ${escapeHtml(statement.statementNumber)}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Date:</strong> ${escapeHtml(new Date(statement.date).toLocaleDateString())}</td>
                  </tr>
                  <tr>
                    <td style="padding: 5px 0;"><strong>Family:</strong> ${escapeHtml(data.family.name)}</td>
                    <td style="padding: 5px 0; text-align: right;"><strong>Period:</strong> ${escapeHtml(new Date(statement.fromDate).toLocaleDateString())} - ${escapeHtml(new Date(statement.toDate).toLocaleDateString())}</td>
                  </tr>
                </table>
              </div>

              <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Opening Balance:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatMoney(statement.openingBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Income:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: green;">${formatMoney(statement.income)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Withdrawals:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.withdrawals)}</td>
                </tr>
                ${(statement.cycleCharges || 0) > 0 ? `
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Annual Dues Charged:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${formatMoney(statement.cycleCharges || 0)}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Expenses:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; color: red;">${formatMoney(statement.expenses)}</td>
                </tr>
                <tr style="background-color: #f0f0f0;">
                  <td style="padding: 8px; font-weight: bold;">Closing Balance:</td>
                  <td style="padding: 8px; text-align: right; font-weight: bold;">${formatMoney(statement.closingBalance)}</td>
                </tr>
              </table>
              
              ${transactionsHTML}
            </div>
          `
        } catch (error) {
          console.error(`Error fetching statement ${statement._id}:`, error)
        }
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>All Statements - ${escapeHtml(data.family.name)}</title>
            <style>
              @media print {
                @page { margin: 1cm; }
                body { margin: 0; }
              }
            </style>
          </head>
          <body style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
            ${allStatementsHTML}
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 0.9em;">
              <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
              <p>Kasa Family Management System</p>
            </div>
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.print()
    }
  }

  const getPlanName = (planNumber: number): string => {
    if (!planNumber) return 'No Plan'
    const plan = paymentPlans.find(p => p.planNumber === planNumber)
    return plan ? plan.name : `Plan ${planNumber}`
  }

  // Extract last name from family name or existing members
  const getFamilyLastName = useCallback((): string => {
    if (!data?.family) return ''
    
    // First, try to get from existing members
    if (data.members && data.members.length > 0) {
      const lastName = data.members[0].lastName
      if (lastName) return lastName
    }
    
    // Otherwise, extract from family name
    const familyName = data.family.name || ''
    
    // Handle formats like "Smith Family", "John & Jane Smith", "Smith", etc.
    let lastName = ''
    
    // Remove "Family" suffix if present
    const nameWithoutSuffix = familyName.replace(/\s+Family$/i, '').trim()
    
    // If contains "&", take the last word after the &
    if (nameWithoutSuffix.includes('&')) {
      const parts = nameWithoutSuffix.split('&')
      if (parts.length > 1) {
        const afterAmpersand = parts[parts.length - 1].trim()
        const words = afterAmpersand.split(/\s+/)
        lastName = words[words.length - 1]
      }
    } else {
      // Otherwise, take the last word
      const words = nameWithoutSuffix.split(/\s+/)
      lastName = words[words.length - 1]
    }
    
    return lastName || ''
  }, [data])

  // Reset the member form and open the "Add Child" modal. Centralized so
  // every "Add" entrypoint (toolbar, empty state, deep link, etc.) stays in
  // sync without copy/pasting the field list.
  const openAddMemberModal = useCallback(() => {
    const familyLastName = getFamilyLastName()
    setMemberForm({
      firstName: '',
      hebrewFirstName: '',
      lastName: familyLastName,
      hebrewLastName: '',
      birthDate: '',
      hebrewBirthDate: '',
      gender: '',
      weddingDate: '',
      spouseName: '',
      spouseFirstName: '',
      spouseHebrewName: '',
      spouseFatherHebrewName: '',
      spouseCellPhone: '',
      phone: '',
      email: '',
      address: '',
      city: '',
      state: '',
      zip: '',
    })
    setEditingMember(null)
    setShowMemberModal(true)
  }, [getFamilyLastName])

  useEffect(() => {
    if (data?.family) {
      // Info form is set when Edit button is clicked

      // Auto-open modal if coming from quick add (members tab only —
      // the tasks tab handles its own add=true in the URL effect above).
      const urlParams = new URLSearchParams(window.location.search)
      if (isAdmin && urlParams.get('add') === 'true' && urlParams.get('tab') !== 'tasks') {
        openAddMemberModal()
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname + '?tab=members')
      }
    }
  }, [data, isAdmin, openAddMemberModal])

  const handleFieldEdit = (fieldName: string, currentValue: any) => {
    // Convert date to string format if it's a date field
    if (fieldName === 'weddingDate' && currentValue) {
      const date = new Date(currentValue)
      setEditValue(date.toISOString().split('T')[0])
    } else {
      setEditValue(currentValue || '')
    }
    setEditingField(fieldName)
  }

  const handleFieldSave = async (fieldName: string) => {
    try {
      const updateData: any = {}
      let finalValue = editValue || ''
      
      // Apply formatting based on field type
      const phoneFields = ['phone', 'husbandCellPhone', 'wifeCellPhone']
      const emailFields = ['email']
      const nameFields = ['name', 'firstName', 'lastName', 'husbandFirstName', 'wifeFirstName']
      
      if (phoneFields.includes(fieldName)) {
        finalValue = formatPhone(finalValue)
      } else if (emailFields.includes(fieldName)) {
        if (finalValue && !validateEmail(finalValue)) {
          toast.error('Please enter a valid email address')
          return
        }
      } else if (nameFields.includes(fieldName)) {
        finalValue = capitalizeName(finalValue)
      }
      
      // Convert date string to Date object if it's a date field
      if (fieldName === 'weddingDate' && finalValue) {
        updateData[fieldName] = new Date(finalValue)
      } else if (fieldName === 'paymentPlanId') {
        // Handle payment plan ID
        updateData[fieldName] = finalValue || null
      } else if (fieldName === 'street') {
        // Update both street and address fields
        updateData.street = finalValue || ''
        updateData.address = finalValue || ''
      } else {
        updateData[fieldName] = finalValue || ''
      }

      const res = await fetch(`/api/families/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (res.ok) {
        setEditingField(null)
        setEditValue('')
        fetchFamilyDetails()
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(`Error updating field: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error updating field:', error)
      toast.error('Error updating field. Please try again.')
    }
  }

  const handleFieldCancel = () => {
    setEditingField(null)
    setEditValue('')
  }

  // Helper function to render editable field
  const renderEditableField = (
    fieldName: string,
    displayValue: string | React.ReactNode,
    fieldType: 'text' | 'date' | 'select' | 'hebrew' | 'phone' | 'email' | 'name' = 'text',
    options?: { value: string; label: string }[]
  ) => {
    if (!isAdmin) {
      return <div className="flex-1 min-w-0">{displayValue}</div>
    }

    const isEditing = editingField === fieldName
    const currentValue = data?.family?.[fieldName] || ''

    // Determine input type and handlers based on field type
    const getInputProps = () => {
      if (fieldType === 'phone') {
        return {
          type: 'tel' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            const formatted = formatPhone(e.target.value)
            setEditValue(formatted)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
            // Allow numbers, backspace, delete, arrow keys, tab
            if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
            }
          },
          placeholder: '1234567890',
          pattern: '[0-9]*'
        }
      } else if (fieldType === 'email') {
        return {
          type: 'email' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              if (validateEmail(editValue)) {
                handleFieldSave(fieldName)
              } else {
                toast.error('Please enter a valid email address')
              }
            }
            if (e.key === 'Escape') handleFieldCancel()
          },
          onBlur: () => {
            if (editValue && !validateEmail(editValue)) {
              toast.error('Please enter a valid email address')
            }
          }
        }
      } else if (fieldType === 'name') {
        return {
          type: 'text' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
          },
          onBlur: () => {
            if (editValue) {
              const capitalized = capitalizeName(editValue)
              setEditValue(capitalized)
            }
          }
        }
      } else if (fieldType === 'date') {
        return {
          type: 'date' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
          }
        }
      } else if (fieldType === 'hebrew') {
        return {
          type: 'text' as const,
          dir: 'rtl' as const,
          lang: 'he' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
            handleHebrewInput(e, editValue, setEditValue)
          },
          style: { fontFamily: 'Arial Hebrew, David, sans-serif' }
        }
      } else {
        return {
          type: 'text' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
          }
        }
      }
    }

    if (isEditing) {
      return (
        <div className="flex items-center gap-2">
          {fieldType === 'select' && options ? (
            <select
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleFieldCancel()
              }}
              className="flex-1 border border-accent/30 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent bg-surface text-fg"
              autoFocus
            >
              <option value="">Select...</option>
              {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              {...getInputProps()}
              className="flex-1 border border-accent/30 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent bg-surface text-fg"
              autoFocus
            />
          )}
          <button
            onClick={() => handleFieldSave(fieldName)}
            className="text-green-600 hover:text-green-800 font-bold"
            title="Save"
          >
            ✓
          </button>
          <button
            onClick={handleFieldCancel}
            className="text-red-600 hover:text-red-800 font-bold"
            title="Cancel"
          >
            ✕
          </button>
        </div>
      )
    }

    return (
      <div
        onClick={() => handleFieldEdit(fieldName, currentValue)}
        className="flex items-center justify-between px-2 py-1 -mx-2 rounded relative group cursor-pointer hover:bg-app-subtle transition-colors"
        title="Click to edit"
      >
        <div className="flex-1 min-w-0">{displayValue}</div>
        <PencilIcon className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-fg-subtle ml-2 shrink-0" />
      </div>
    )
  }

  // Helper function to render editable member field
  const renderEditableMemberField = (
    fieldName: string,
    displayValue: string | React.ReactNode,
    fieldType: 'text' | 'date' | 'select' | 'hebrew' | 'phone' | 'email' | 'name' = 'text',
    memberId: string,
    options?: { value: string; label: string }[]
  ) => {
    if (!isAdmin) {
      return <div className="flex-1 min-w-0">{displayValue}</div>
    }

    const isEditing = editingMemberField === `${memberId}-${fieldName}`
    const member = data?.members?.find((m: any) => m._id === memberId)
    const currentValue = member?.[fieldName] || ''

    // Determine input type and handlers based on field type
    const getInputProps = () => {
      if (fieldType === 'phone') {
        return {
          type: 'tel' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            const formatted = formatPhone(e.target.value)
            setEditMemberValue(formatted)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
            // Allow numbers, backspace, delete, arrow keys, tab
            if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
            }
          },
          placeholder: '1234567890',
          pattern: '[0-9]*'
        }
      } else if (fieldType === 'email') {
        return {
          type: 'email' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditMemberValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              if (validateEmail(editMemberValue)) {
                handleMemberFieldSave(fieldName, memberId)
              } else {
                toast.error('Please enter a valid email address')
              }
            }
            if (e.key === 'Escape') handleMemberFieldCancel()
          },
          onBlur: () => {
            if (editMemberValue && !validateEmail(editMemberValue)) {
              toast.error('Please enter a valid email address')
            }
          }
        }
      } else if (fieldType === 'name') {
        return {
          type: 'text' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditMemberValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
          },
          onBlur: () => {
            if (editMemberValue) {
              const capitalized = capitalizeName(editMemberValue)
              setEditMemberValue(capitalized)
            }
          }
        }
      } else if (fieldType === 'date') {
        return {
          type: 'date' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditMemberValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
          }
        }
      } else if (fieldType === 'hebrew') {
        return {
          type: 'text' as const,
          dir: 'rtl' as const,
          lang: 'he' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditMemberValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
            handleHebrewInput(e, editMemberValue, setEditMemberValue)
          },
          style: { fontFamily: 'Arial Hebrew, David, sans-serif' }
        }
      } else {
        return {
          type: 'text' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditMemberValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
          }
        }
      }
    }

    if (isEditing) {
      return (
        <div className="flex items-center gap-2">
          {fieldType === 'select' && options ? (
            <select
              value={editMemberValue}
              onChange={(e) => setEditMemberValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleMemberFieldCancel()
              }}
              className="flex-1 border border-accent/30 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent bg-surface text-fg"
              autoFocus
            >
              <option value="">Select...</option>
              {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              {...getInputProps()}
              className="flex-1 border border-accent/30 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent bg-surface text-fg"
              autoFocus
            />
          )}
          <button
            onClick={() => handleMemberFieldSave(fieldName, memberId)}
            className="text-green-600 hover:text-green-800 font-bold"
            title="Save"
          >
            ✓
          </button>
          <button
            onClick={handleMemberFieldCancel}
            className="text-red-600 hover:text-red-800 font-bold"
            title="Cancel"
          >
            ✕
          </button>
        </div>
      )
    }

    return (
      <div
        onClick={() => handleMemberFieldEdit(fieldName, currentValue, memberId)}
        className="flex items-center justify-between px-2 py-1 -mx-2 rounded relative group cursor-pointer hover:bg-app-subtle transition-colors"
        title="Click to edit"
      >
        <div className="flex-1 min-w-0">{displayValue}</div>
        <PencilIcon className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-fg-subtle ml-2 shrink-0" />
      </div>
    )
  }

  const handleMemberFieldEdit = (fieldName: string, currentValue: any, memberId: string) => {
    // Convert date to string format if it's a date field
    if ((fieldName === 'birthDate' || fieldName === 'weddingDate') && currentValue) {
      const date = new Date(currentValue)
      setEditMemberValue(date.toISOString().split('T')[0])
    } else {
      setEditMemberValue(currentValue || '')
    }
    setEditingMemberField(`${memberId}-${fieldName}`)
  }

  const handleMemberFieldSave = async (fieldName: string, memberId: string) => {
    try {
      const member = data?.members?.find((m: any) => m._id === memberId)
      if (!member) {
        toast.error('Member not found')
        return
      }

      let finalValue = editMemberValue || ''
      
      // Apply formatting based on field type
      const phoneFields = ['phone', 'spouseCellPhone']
      const emailFields = ['email']
      const nameFields = ['firstName', 'lastName', 'spouseFirstName', 'spouseName']
      const addressFields = ['city', 'state', 'address'] // Fields that should be capitalized
      
      if (phoneFields.includes(fieldName)) {
        finalValue = formatPhone(finalValue)
      } else if (emailFields.includes(fieldName)) {
        if (finalValue && !validateEmail(finalValue)) {
          toast.error('Please enter a valid email address')
          return
        }
      } else if (nameFields.includes(fieldName) || addressFields.includes(fieldName)) {
        finalValue = capitalizeName(finalValue.trim())
      } else {
        // For other text fields, trim whitespace
        finalValue = finalValue.trim()
      }

      const updateData: any = {
        // Always include required fields from current member data
        firstName: member.firstName || '',
        lastName: member.lastName || '',
        birthDate: member.birthDate ? new Date(member.birthDate) : new Date(),
        // Include optional fields that might exist
        hebrewFirstName: member.hebrewFirstName || '',
        hebrewLastName: member.hebrewLastName || '',
        gender: member.gender || '',
        weddingDate: member.weddingDate ? new Date(member.weddingDate) : undefined,
        spouseName: member.spouseName || '',
        spouseFirstName: member.spouseFirstName || '',
        spouseHebrewName: member.spouseHebrewName || '',
        spouseFatherHebrewName: member.spouseFatherHebrewName || '',
        spouseCellPhone: member.spouseCellPhone || '',
        phone: member.phone || '',
        email: member.email || '',
        address: member.address || '',
        city: member.city || '',
        state: member.state || '',
        zip: member.zip || ''
      }
      
      // Update the specific field being edited
      if (fieldName === 'birthDate' || fieldName === 'weddingDate') {
        if (finalValue) {
          updateData[fieldName] = new Date(finalValue)
          // Auto-calculate Hebrew date for birthDate
          if (fieldName === 'birthDate') {
            const hebrewDate = convertToHebrewDate(new Date(finalValue))
            updateData.hebrewBirthDate = hebrewDate
          }
        } else {
          updateData[fieldName] = null
        }
      } else {
        // For text fields, explicitly set the value
        // Use the trimmed finalValue, or empty string if it's empty
        updateData[fieldName] = finalValue
      }

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key]
        }
      })

      // Ensure the field is explicitly set in updateData (important for
      // fields that might be null/undefined). Skip date fields — they
      // were already coerced to `Date` above and assigning the raw
      // string here would clobber that with a string, then the server
      // would re-parse it in UTC and shift the day depending on the
      // user's tz.
      if (fieldName !== 'birthDate' && fieldName !== 'weddingDate') {
        updateData[fieldName] = finalValue
      }

      const res = await fetch(`/api/families/${params.id}/members/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (res.ok) {
        await res.json()
        setEditingMemberField(null)
        setEditMemberValue('')
        // Refresh the data to show the updated value
        await fetchFamilyDetails()
      } else {
        const errorData = await res.json().catch(() => ({}))
        console.error('Error updating field:', errorData)
        toast.error(`Error updating field: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error updating member field:', error)
      toast.error('Error updating field. Please try again.')
    }
  }

  const handleMemberFieldCancel = () => {
    setEditingMemberField(null)
    setEditMemberValue('')
  }

  const fetchFamilyDetails = async (sharedGen?: number) => {
    const familyId = params.id
    const gen = sharedGen ?? beginFamilyFetch()
    if (!familyId) {
      if (!isFamilyFetchStale(gen)) setLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/families/${familyId}`)
      if (isFamilyFetchStale(gen)) return
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Error fetching family:', err.error || res.status)
        toast.error(err.error || 'Failed to load family details.')
        setData(null)
        setLoading(false)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (isFamilyFetchStale(gen)) return
      
      // Check if API returned an error
      if (data.error || !data.family) {
        console.error('Error fetching family:', data.error || 'Family not found')
        toast.error(data.error || 'Family not found.')
        setData(null)
        setLoading(false)
        return
      }
      
      // Backfill Hebrew dates for display without blocking the page shell.
      // Persisting to the DB is fire-and-forget so org-switch / Strict Mode
      // generation bumps cannot strand the UI in a loading skeleton.
      if (data.members) {
        data.members = data.members.map((member: any) => {
          if (!member.hebrewBirthDate && member.birthDate) {
            try {
              const hebrewDate = convertToHebrewDate(new Date(member.birthDate))
              if (hebrewDate) {
                // Only PUT if this fetch is still current. Without the
                // gen check a stale org-switched fetch would otherwise
                // backfill Hebrew dates for the prior org's members.
                if (!isFamilyFetchStale(gen)) {
                  void fetch(`/api/families/${familyId}/members/${member._id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      firstName: member.firstName,
                      lastName: member.lastName,
                      birthDate: new Date(member.birthDate).toISOString().split('T')[0],
                      hebrewBirthDate: hebrewDate,
                      gender: member.gender || '',
                    }),
                  }).catch((updateError) => {
                    console.error('Error updating member Hebrew date:', updateError)
                  })
                }
                return { ...member, hebrewBirthDate: hebrewDate }
              }
            } catch (e) {
              console.error('Error calculating Hebrew date:', e)
            }
          }
          return member
        })
      }

      if (isFamilyFetchStale(gen)) return
      setData(data)
    } catch (error) {
      console.error('Error fetching family details:', error)
    } finally {
      // Only clear the skeleton if this fetch is still current.
      // Otherwise a slow, stale fetch (from a previous org) would
      // briefly hide the skeleton while the in-flight one is still
      // loading.
      if (!isFamilyFetchStale(gen)) setLoading(false)
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Apply formatting before submission
    const formattedForm = {
      ...memberForm,
      firstName: capitalizeName(memberForm.firstName),
      lastName: capitalizeName(memberForm.lastName),
      spouseFirstName: memberForm.spouseFirstName ? capitalizeName(memberForm.spouseFirstName) : '',
      spouseName: memberForm.spouseName ? capitalizeName(memberForm.spouseName) : '',
      phone: memberForm.phone ? formatPhone(memberForm.phone) : '',
      spouseCellPhone: memberForm.spouseCellPhone ? formatPhone(memberForm.spouseCellPhone) : '',
      email: memberForm.email || '',
      weddingDate: memberForm.weddingDate || undefined,
      address: memberForm.address || undefined,
      city: memberForm.city || undefined,
      state: memberForm.state || undefined,
      zip: memberForm.zip || undefined
    }
    
    // Validate email if provided
    if (formattedForm.email && !validateEmail(formattedForm.email)) {
      toast.error('Please enter a valid email address')
      return
    }
    
    try {
      const res = await fetch('/api/families/' + params.id + '/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formattedForm, familyId: params.id })
      })
      if (res.ok) {
        setShowMemberModal(false)
        setEditingMember(null)
        setMemberForm({ 
          firstName: '', hebrewFirstName: '', lastName: '', hebrewLastName: '', 
          birthDate: '', hebrewBirthDate: '', gender: '', weddingDate: '', 
          spouseName: '', spouseFirstName: '', spouseHebrewName: '', 
          spouseFatherHebrewName: '', spouseCellPhone: '', phone: '', 
          email: '', address: '', city: '', state: '', zip: '' 
        })
        fetchFamilyDetails()
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error adding member:', error)
      toast.error('Error adding member')
    }
  }

  const handleEditMember = (member: any) => {
    setEditingMember(member)
    setMemberForm({
      firstName: member.firstName,
      hebrewFirstName: member.hebrewFirstName || '',
      lastName: member.lastName,
      hebrewLastName: member.hebrewLastName || '',
      birthDate: new Date(member.birthDate).toISOString().split('T')[0],
      hebrewBirthDate: member.hebrewBirthDate || convertToHebrewDate(new Date(member.birthDate)),
      gender: member.gender || '',
      weddingDate: member.weddingDate ? new Date(member.weddingDate).toISOString().split('T')[0] : '',
      spouseName: member.spouseName || '',
      spouseFirstName: member.spouseFirstName || '',
      spouseHebrewName: member.spouseHebrewName || '',
      spouseFatherHebrewName: member.spouseFatherHebrewName || '',
      spouseCellPhone: member.spouseCellPhone || '',
      phone: member.phone || '',
      email: member.email || '',
      address: member.address || '',
      city: member.city || '',
      state: member.state || '',
      zip: member.zip || ''
    })
    setShowMemberModal(true)
  }

  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingMember) return
    
    // Apply formatting before submission
    const formattedData = {
      firstName: capitalizeName(memberForm.firstName),
      hebrewFirstName: memberForm.hebrewFirstName,
      lastName: capitalizeName(memberForm.lastName),
      hebrewLastName: memberForm.hebrewLastName,
      birthDate: memberForm.birthDate,
      hebrewBirthDate: memberForm.hebrewBirthDate,
      gender: memberForm.gender,
      weddingDate: memberForm.weddingDate || undefined,
      spouseName: memberForm.spouseName ? capitalizeName(memberForm.spouseName) : undefined,
      spouseFirstName: memberForm.spouseFirstName ? capitalizeName(memberForm.spouseFirstName) : undefined,
      spouseHebrewName: memberForm.spouseHebrewName || undefined,
      spouseFatherHebrewName: memberForm.spouseFatherHebrewName || undefined,
      spouseCellPhone: memberForm.spouseCellPhone ? formatPhone(memberForm.spouseCellPhone) : undefined,
      phone: memberForm.phone ? formatPhone(memberForm.phone) : undefined,
      email: memberForm.email || undefined,
      address: memberForm.address || undefined,
      city: memberForm.city || undefined,
      state: memberForm.state || undefined,
      zip: memberForm.zip || undefined
    }
    
    // Validate email if provided
    if (formattedData.email && !validateEmail(formattedData.email)) {
      toast.error('Please enter a valid email address')
      return
    }
    
    try {
      const res = await fetch(`/api/families/${params.id}/members/${editingMember._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedData)
      })
      if (res.ok) {
        setShowMemberModal(false)
        setEditingMember(null)
        setMemberForm({ 
          firstName: '', hebrewFirstName: '', lastName: '', hebrewLastName: '', 
          birthDate: '', hebrewBirthDate: '', gender: '', weddingDate: '', 
          spouseName: '', spouseFirstName: '', spouseHebrewName: '', 
          spouseFatherHebrewName: '', spouseCellPhone: '', phone: '', 
          email: '', address: '', city: '', state: '', zip: '' 
        })
        if (memberForm.weddingDate) {
          toast.success(`Wedding date set. ${memberForm.firstName} ${memberForm.lastName} will be automatically converted to a new family on ${new Date(memberForm.weddingDate).toLocaleDateString()}.`)
        }
        fetchFamilyDetails()
      } else {
        const error = await res.json().catch(() => ({}))
        console.error('Update error response:', error)
        toast.error(`Error: ${error.error || error.details || 'Failed to update member'}`)
      }
    } catch (error: any) {
      console.error('Error updating member:', error)
      toast.error(`Error updating member: ${error.message || 'Unknown error'}`)
    }
  }

  const handleDeleteMember = async (member: any) => {
    if (
      !(await confirm({
        message: `Are you sure you want to delete ${member.firstName} ${member.lastName}?`,
        destructive: true,
        confirmLabel: 'Delete',
      }))
    ) {
      return
    }
    
    try {
      const res = await fetch(`/api/families/${params.id}/members/${member._id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        fetchFamilyDetails()
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error deleting member:', error)
      toast.error('Error deleting member')
    }
  }

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault()

    if (paymentSubmittingRef.current) return
    
    // Skip if using Stripe (Stripe handles its own submission)
    if (paymentForm.paymentMethod === 'credit_card' && useStripe) {
      return
    }
    
    // Validate amount
    if (!paymentForm.amount || paymentForm.amount <= 0) {
      toast.error('Please enter a valid amount greater than 0')
      return
    }

    // Validate member selection if payment is for a member
    if (paymentForm.paymentFor === 'member' && !paymentForm.memberId) {
      toast.error('Please select a member for this payment')
      return
    }

    paymentSubmittingRef.current = true

    // Handle charging saved card
    if (paymentForm.paymentMethod === 'credit_card' && paymentForm.useSavedCard && paymentForm.selectedSavedCardId) {
      try {
        const res = await fetch(`/api/families/${params.id}/charge-saved-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              savedPaymentMethodId: paymentForm.selectedSavedCardId,
              amount: paymentForm.amount,
              paymentDate: paymentForm.paymentDate,
              year: paymentForm.year,
              type: paymentForm.type,
              notes: paymentForm.notes,
              paymentFrequency: paymentForm.paymentFrequency,
              memberId: paymentForm.paymentFor === 'member' && paymentForm.memberId ? paymentForm.memberId : undefined
            })
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || 'Failed to charge saved card.')
          return
        }
        const data = await res.json().catch(() => ({}))
        if (data.success) {
          setShowPaymentModal(false)
          setUseStripe(false)
          setPaymentForm({
            amount: 0,
            paymentDate: new Date().toISOString().split('T')[0],
            year: new Date().getFullYear(),
            type: 'membership',
            paymentMethod: 'cash',
            paymentFrequency: 'one-time',
            paymentFor: 'family',
            memberId: '',
            saveCard: false,
            useSavedCard: false,
            selectedSavedCardId: '',
            ccLast4: '',
            ccCardType: '',
            ccExpiryMonth: '',
            ccExpiryYear: '',
            ccNameOnCard: '',
            checkNumber: '',
            checkBankName: '',
            checkRoutingNumber: '',
            notes: ''
          })
          fetchFamilyDetails()
          fetchSavedPaymentMethods()
        } else {
          toast.error(`Error charging card: ${data.error || 'Unknown error'}`)
        }
      } catch (error: any) {
        console.error('Error charging saved card:', error)
        toast.error('Error charging saved card. Please check the console for details.')
      } finally {
        paymentSubmittingRef.current = false
      }
      return
    }

    try {
      // Build payment data based on payment method
      // Ensure paymentMethod is explicitly set and never falls back to cash unless truly missing
      const selectedPaymentMethod = paymentForm.paymentMethod || 'cash'
      
      const paymentData: any = {
        amount: paymentForm.amount,
        paymentDate: paymentForm.paymentDate,
        year: paymentForm.year,
        type: paymentForm.type,
        paymentMethod: selectedPaymentMethod,
        paymentFrequency: paymentForm.paymentFrequency,
        notes: paymentForm.notes || undefined
      }

      // Add memberId if payment is for a member
      if (paymentForm.paymentFor === 'member' && paymentForm.memberId) {
        paymentData.memberId = paymentForm.memberId
      }

      // Add credit card info if payment method is credit_card
      if (selectedPaymentMethod === 'credit_card') {
        // Only add ccInfo if at least last4 is provided
        if (paymentForm.ccLast4) {
          paymentData.ccInfo = {
            last4: paymentForm.ccLast4,
            cardType: paymentForm.ccCardType || undefined,
            expiryMonth: paymentForm.ccExpiryMonth || undefined,
            expiryYear: paymentForm.ccExpiryYear || undefined,
            nameOnCard: paymentForm.ccNameOnCard || undefined
          }
        }
      }

      // Add check info if payment method is check
      if (selectedPaymentMethod === 'check') {
        // Only add checkInfo if at least checkNumber is provided
        if (paymentForm.checkNumber) {
          paymentData.checkInfo = {
            checkNumber: paymentForm.checkNumber,
            bankName: paymentForm.checkBankName || undefined,
            routingNumber: paymentForm.checkRoutingNumber || undefined
          }
        }
      }

      const res = await fetch('/api/families/' + params.id + '/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...paymentData, familyId: params.id })
      })
      
      if (res.ok) {
        setShowPaymentModal(false)
        setPaymentForm({
          amount: 0,
          paymentDate: new Date().toISOString().split('T')[0],
          year: new Date().getFullYear(),
          type: 'membership',
          paymentMethod: 'cash',
          paymentFrequency: 'one-time',
          paymentFor: 'family',
          memberId: '',
          saveCard: false,
          useSavedCard: false,
          selectedSavedCardId: '',
          ccLast4: '',
          ccCardType: '',
          ccExpiryMonth: '',
          ccExpiryYear: '',
          ccNameOnCard: '',
          checkNumber: '',
          checkBankName: '',
          checkRoutingNumber: '',
          notes: ''
        })
        fetchFamilyDetails()
        fetchSavedPaymentMethods()
        // Refresh member financials if viewing a member
        if (viewingMemberId && memberActiveTab === 'payments') {
          fetchMemberFinancials()
        }
      } else {
        const errorData = await res.json().catch(() => ({}))
        // Surface zod field-level issues so the user knows what to fix.
        const detail = Array.isArray(errorData.issues) && errorData.issues.length
          ? ' — ' + errorData.issues.map((i: any) => `${i.path || 'body'}: ${i.message}`).join('; ')
          : ''
        console.error('Add payment failed', {
          status: res.status,
          error: errorData?.error,
          issues: errorData?.issues,
          paymentMethod: paymentData?.paymentMethod,
          amount: paymentData?.amount,
        })
        toast.error(`Error adding payment: ${errorData.error || 'Unknown error'}${detail}`)
      }
    } catch (error) {
      console.error('Error adding payment:', error)
      toast.error('Error adding payment. Please check the console for details.')
    } finally {
      paymentSubmittingRef.current = false
    }
  }


  const openAddWithdrawal = () => {
    setEditingWithdrawal(null)
    setWithdrawalForm({
      amount: 0,
      withdrawalDate: new Date().toISOString().split('T')[0],
      reason: '',
      notes: '',
    })
    setShowWithdrawalModal(true)
  }

  const openEditWithdrawal = (w: any) => {
    setEditingWithdrawal(w)
    setWithdrawalForm({
      amount: Number(w.amount) || 0,
      withdrawalDate: w.withdrawalDate
        ? new Date(w.withdrawalDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      reason: w.reason || '',
      notes: w.notes || '',
    })
    setShowWithdrawalModal(true)
  }

  const handleSaveWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (withdrawalSubmittingRef.current) return
    withdrawalSubmittingRef.current = true
    try {
      const url = editingWithdrawal
        ? `/api/families/${params.id}/withdrawals/${editingWithdrawal._id}`
        : `/api/families/${params.id}/withdrawals`
      const method = editingWithdrawal ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withdrawalForm),
      })
      if (res.ok) {
        setShowWithdrawalModal(false)
        setEditingWithdrawal(null)
        fetchFamilyDetails()
        toast.success(editingWithdrawal ? 'Withdrawal updated.' : 'Withdrawal recorded.')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to save withdrawal.')
      }
    } catch (error) {
      console.error('Error saving withdrawal:', error)
      toast.error('Error saving withdrawal.')
    } finally {
      withdrawalSubmittingRef.current = false
    }
  }

  const handleDeleteWithdrawal = async (w: any) => {
    const ok = await confirm({
      title: 'Delete withdrawal?',
      message: `This will permanently remove the ${w.reason ? `"${w.reason}" ` : ''}withdrawal of ${formatMoney(Number(w.amount))}.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/families/${params.id}/withdrawals/${w._id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        fetchFamilyDetails()
        toast.success('Withdrawal deleted.')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to delete withdrawal.')
      }
    } catch (error) {
      console.error('Error deleting withdrawal:', error)
      toast.error('Error deleting withdrawal.')
    }
  }

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (eventSubmittingRef.current) return
    eventSubmittingRef.current = true
    try {
      const res = await fetch('/api/families/' + params.id + '/lifecycle-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...eventForm, familyId: params.id })
      })
      if (res.ok) {
        setShowEventModal(false)
        // Reset to first available event type (no hardcoded fallback).
        const first = lifecycleEventTypes[0]
        setEventForm({
          eventType: first?.type ?? '',
          amount: first?.amount ?? 0,
          eventDate: new Date().toISOString().split('T')[0],
          year: new Date().getFullYear(),
          notes: '',
        })
        fetchFamilyDetails()
        toast.success('Event recorded.')
      } else {
        // Previously silent on non-2xx — the modal would just sit
        // there with no feedback. Surface the error so the user knows
        // the event was NOT saved.
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to save event.')
      }
    } catch (error) {
      console.error('Error adding event:', error)
      toast.error('Error saving event.')
    } finally {
      eventSubmittingRef.current = false
    }
  }

  // Pulls the configured amount from the org's lifecycle event types
  // (no hardcoded defaults). The user can still edit the amount manually
  // in the form after the dropdown change.
  const updateEventAmount = (type: string) => {
    const matched = lifecycleEventTypes.find((ev) => ev.type === type)
    setEventForm({ ...eventForm, eventType: type, amount: matched?.amount ?? 0 })
  }

  useOrgChanged(useCallback(() => {
    invalidateFamilyFetch()
    invalidateTasksFetch()
    invalidateSavedCardsFetch()
    const gen = beginFamilyFetch()
    memberFetchGenRef.current += 1
    // Family detail aggregates many slices of state. On org switch we
    // were only nulling `data` + refetching family — leaving stale
    // statements, sub-families, tasks, payment plans, lifecycle event
    // types, email config, member financials, and saved card data
    // visible in the new org's session.
    setData(null)
    setLoading(true)
    setStatements([])
    setSubFamilies([])
    setFamilyTasks([])
    setPaymentPlans([])
    setLifecycleEventTypes([])
    setSavedPaymentMethods([])
    setEmailConfig(null)
    setMemberBalance(null)
    setMemberPayments([])
    setMemberStatements([])
    setViewingMemberId(null)
    setEditingMemberField(null)
    void fetchFamilyDetails(gen)
    void fetchSubFamilies(gen)
    void fetchEmailConfig(gen)
    if (isAdmin) {
      void fetchStatements(gen)
      void fetchPaymentPlans(gen)
      void fetchLifecycleEventTypes(gen)
      void fetchSavedPaymentMethods()
      void fetchFamilyTasks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAdmin,
    beginFamilyFetch,
    invalidateFamilyFetch,
    invalidateTasksFetch,
    invalidateSavedCardsFetch,
  ]))

  if (roleLoading || loading) {
    return (
      <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app-subtle">
        <div className="max-w-7xl mx-auto">
          <div className="ui-skeleton h-8 w-40 mb-4" />
          <div className="ui-skeleton h-10 w-2/3 mb-2" />
          <div className="ui-skeleton h-5 w-1/2 mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="ui-skeleton h-28" />
            <div className="ui-skeleton h-28" />
            <div className="ui-skeleton h-28" />
          </div>
          <div className="ui-skeleton h-96" />
        </div>
      </main>
    )
  }

  if (!data || !data.family) {
    return (
      <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app-subtle">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4 text-fg">Family not found</h1>
          <p className="text-fg">
            The family you&apos;re looking for doesn&apos;t exist or couldn&apos;t be loaded.
          </p>
          <button
            onClick={() => router.push('/families')}
            className="focus-ring mt-4 inline-flex items-center gap-1 text-accent hover:text-accent-hover rounded"
          >
            ← Back to Families
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app-subtle">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => router.back()}
          className="mb-4 text-accent hover:text-accent-hover"
        >
          ← Back to Families
        </button>

        <div className="surface-card rounded-2xl shadow-xl p-6 mb-6 border border-border">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-3xl font-bold mb-2 text-fg">{data.family.name}</h1>
            {isAdmin && (
            <button
              onClick={() => setShowTaskModal(true)}
              className="bg-accent text-accent-fg px-4 py-2 rounded-lg flex items-center gap-2 hover:shadow-lg transition-all text-sm"
            >
              <PlusIcon className="h-4 w-4" />
              Add Task
            </button>
            )}
          </div>
          <div className={`grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border${isAdmin ? ' md:grid-cols-7' : ''}`}>
            <div>
              <p className="text-sm text-fg-muted">Wedding Date</p>
              <p className="font-medium">{new Date(data.family.weddingDate).toLocaleDateString()}</p>
            </div>
            {isAdmin && (
              <>
            <div>
              <p className="text-sm text-fg-muted">Current Plan</p>
              <p className="font-medium">{getPlanNameById(data.family.paymentPlanId)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Balance</p>
              <p className="font-medium text-green-600">{formatMoney(data.balance.balance)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Members</p>
              <p className="font-medium">{data.members.length}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Total Payments</p>
              <p className="font-medium text-green-600">{formatMoney(data.balance.totalPayments)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Lifecycle Events</p>
              <p className="font-medium text-accent">{formatMoney(data.balance.totalLifecyclePayments)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Plan Cost (Annual)</p>
              <p className="font-medium text-orange-600">{formatMoney(-(data.balance.planCost || 0))}</p>
            </div>
            {(data.balance.totalCycleCharges || 0) > 0 && (
              <div>
                <p className="text-sm text-fg-muted">Past Cycle Charges</p>
                <p className="font-medium text-orange-600">{formatMoney(-(data.balance.totalCycleCharges || 0))}</p>
              </div>
            )}
              </>
            )}
            {!isAdmin && (
            <div>
              <p className="text-sm text-fg-muted">Members</p>
              <p className="font-medium">{data.members.length}</p>
            </div>
            )}
          </div>
        </div>

        <div className="bg-surface rounded-lg shadow mt-3">
          <div className="border-b">
            <nav className="flex">
              {[
                { id: 'info', label: 'Info' },
                { id: 'members', label: 'Members' },
                ...(isAdmin
                  ? [
                      { id: 'payments', label: 'Payments' },
                      { id: 'withdrawals', label: 'Withdrawals' },
                      { id: 'events', label: 'Lifecycle Events' },
                      { id: 'cycle-charges', label: 'Cycle Charges' },
                      { id: 'statements', label: 'Statements' },
                      { id: 'tasks', label: 'Tasks' },
                    ]
                  : []),
                { id: 'sub-families', label: 'Sub-Families' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-6 py-3 font-medium ${
                    activeTab === tab.id
                      ? 'border-b-2 border-blue-600 text-accent'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'info' && (
              <div>
                <div className="flex justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-fg">Family Information</h3>
                  </div>
                  {isAdmin && (
                  <button
                    onClick={() => {
                      if (data?.family) {
                        setInfoForm({
                          name: data.family.name || '',
                          hebrewName: data.family.hebrewName || '',
                          weddingDate: data.family.weddingDate ? new Date(data.family.weddingDate).toISOString().split('T')[0] : '',
                          husbandFirstName: data.family.husbandFirstName || '',
                          husbandHebrewName: data.family.husbandHebrewName || '',
                          husbandFatherHebrewName: data.family.husbandFatherHebrewName || '',
                          wifeFirstName: data.family.wifeFirstName || '',
                          wifeHebrewName: data.family.wifeHebrewName || '',
                          wifeFatherHebrewName: data.family.wifeFatherHebrewName || '',
                          husbandCellPhone: data.family.husbandCellPhone || '',
                          wifeCellPhone: data.family.wifeCellPhone || '',
                          address: data.family.address || '',
                          street: data.family.street || '',
                          phone: data.family.phone || '',
                          email: data.family.email || '',
                          city: data.family.city || '',
                          state: data.family.state || '',
                          zip: data.family.zip || '',
                          paymentPlanId: data.family.paymentPlanId?.toString() || ''
                        })
                        setShowInfoModal(true)
                      }
                    }}
                    className="bg-accent text-accent-fg px-4 py-2 rounded-lg flex items-center gap-2 hover:shadow-lg transition-all text-sm"
                  >
                    <PencilIcon className="h-4 w-4" />
                    Edit Info
                  </button>
                  )}
                </div>
                <div className="space-y-3">
                  {/* Basic Information */}
                  <div className="surface-card rounded-lg p-4 border border-border">
                    <h4 className="text-base font-semibold mb-2 text-fg">Basic Information</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Family Name</label>
                        {renderEditableField(
                          'name',
                          <p className="text-base font-semibold text-fg">{data.family.name || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'name'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Family Name (Hebrew)</label>
                        {renderEditableField(
                          'hebrewName',
                          <p className="text-base font-semibold text-fg" dir="rtl">{data.family.hebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'hebrew'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Wedding Date</label>
                        {renderEditableField(
                          'weddingDate',
                          <p className="text-base font-semibold text-fg">{data.family.weddingDate ? new Date(data.family.weddingDate).toLocaleDateString() : <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'date'
                        )}
                      </div>
                      {isAdmin && (
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Payment Plan</label>
                        {renderEditableField(
                          'paymentPlanId',
                          <p className="text-base font-semibold text-fg">{getPlanNameById(data.family.paymentPlanId)}</p>,
                          'select',
                          paymentPlans.map(plan => ({ value: plan._id, label: plan.name }))
                        )}
                      </div>
                      )}
                    </div>
                  </div>

                  {/* Husband Information */}
                  <div className="surface-card rounded-lg p-4 border border-border">
                    <h4 className="text-base font-semibold mb-2 text-fg">Husband Information</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name</label>
                        {renderEditableField(
                          'husbandFirstName',
                          <p className="text-base font-semibold text-fg">{data.family.husbandFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'name'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Hebrew Name</label>
                        {renderEditableField(
                          'husbandHebrewName',
                          <p className="text-base font-semibold text-fg" dir="rtl">{data.family.husbandHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'hebrew'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Father's Hebrew Name</label>
                        {renderEditableField(
                          'husbandFatherHebrewName',
                          <p className="text-base font-semibold text-fg" dir="rtl">{data.family.husbandFatherHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'hebrew'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Cell Phone</label>
                        {renderEditableField(
                          'husbandCellPhone',
                          <p className="text-base font-semibold text-fg">{data.family.husbandCellPhone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'phone'
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Wife Information */}
                  <div className="surface-card rounded-lg p-4 border border-border">
                    <h4 className="text-base font-semibold mb-2 text-fg">Wife Information</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name</label>
                        {renderEditableField(
                          'wifeFirstName',
                          <p className="text-base font-semibold text-fg">{data.family.wifeFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'name'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Hebrew Name</label>
                        {renderEditableField(
                          'wifeHebrewName',
                          <p className="text-base font-semibold text-fg" dir="rtl">{data.family.wifeHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'hebrew'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Father's Hebrew Name</label>
                        {renderEditableField(
                          'wifeFatherHebrewName',
                          <p className="text-base font-semibold text-fg" dir="rtl">{data.family.wifeFatherHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'hebrew'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Cell Phone</label>
                        {renderEditableField(
                          'wifeCellPhone',
                          <p className="text-base font-semibold text-fg">{data.family.wifeCellPhone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'phone'
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div className="surface-card rounded-lg p-4 border border-border">
                    <h4 className="text-base font-semibold mb-2 text-fg">Contact Information</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Email</label>
                        {renderEditableField(
                          'email',
                          <p className="text-base font-semibold text-fg">{data.family.email || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'email'
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Phone</label>
                        {renderEditableField(
                          'phone',
                          <p className="text-base font-semibold text-fg">{data.family.phone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                          'phone'
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Street Address</label>
                        {renderEditableField(
                          'street',
                          <p className="text-base font-semibold text-fg">{data.family.street || data.family.address || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">City</label>
                        {renderEditableField(
                          'city',
                          <p className="text-base font-semibold text-fg">{data.family.city || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">State</label>
                        {renderEditableField(
                          'state',
                          <p className="text-base font-semibold text-fg">{data.family.state || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">ZIP Code</label>
                        {renderEditableField(
                          'zip',
                          <p className="text-base font-semibold text-fg">{data.family.zip || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'members' && (
              <div>
                {viewingMemberId && data.members.find((m: any) => m._id === viewingMemberId) ? (
                  // Member Detail View (Full Screen)
                  (() => {
                    const member = data.members.find((m: any) => m._id === viewingMemberId)
                    if (!member) return null
                    
                    // Calculate Hebrew date if missing
                    let displayHebrewDate = member.hebrewBirthDate
                    if (!displayHebrewDate && member.birthDate) {
                      displayHebrewDate = convertToHebrewDate(new Date(member.birthDate))
                    }
                    
                    // Calculate age
                    let age: number
                    if (displayHebrewDate) {
                      const hebrewAge = calculateHebrewAge(displayHebrewDate)
                      if (hebrewAge !== null) {
                        age = hebrewAge
                      } else {
                        const today = new Date()
                        const birthDate = new Date(member.birthDate)
                        age = today.getFullYear() - birthDate.getFullYear()
                        const monthDiff = today.getMonth() - birthDate.getMonth()
                        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                          age--
                        }
                      }
                    } else {
                      const today = new Date()
                      const birthDate = new Date(member.birthDate)
                      age = today.getFullYear() - birthDate.getFullYear()
                      const monthDiff = today.getMonth() - birthDate.getMonth()
                      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                        age--
                      }
                    }
                    
                    return (
                      <div>
                        <div className="flex justify-between items-center mb-6">
                          <div>
                            <button
                              onClick={() => {
                                setViewingMemberId(null)
                                setMemberActiveTab('info')
                              }}
                              className="text-accent hover:text-accent-hover mb-2 flex items-center gap-2"
                            >
                              ← Back to Members List
                            </button>
                            <h3 className="text-xl font-semibold text-fg">
                              {member.firstName} {member.lastName} - Details
                            </h3>
                          </div>
                        </div>
                        
                        {/* Member Tabs */}
                        <div className="flex gap-2 mb-6 border-b border-border">
                          <button
                            onClick={() => setMemberActiveTab('info')}
                            className={`px-4 py-2 font-medium transition-colors ${
                              memberActiveTab === 'info'
                                ? 'text-accent border-b-2 border-blue-600'
                                : 'text-fg-muted hover:text-fg'
                            }`}
                          >
                            Info
                          </button>
                          {isAdmin && (
                          <>
                          <button
                            onClick={() => setMemberActiveTab('balance')}
                            className={`px-4 py-2 font-medium transition-colors ${
                              memberActiveTab === 'balance'
                                ? 'text-accent border-b-2 border-blue-600'
                                : 'text-fg-muted hover:text-fg'
                            }`}
                          >
                            Balance
                          </button>
                          <button
                            onClick={() => setMemberActiveTab('payments')}
                            className={`px-4 py-2 font-medium transition-colors ${
                              memberActiveTab === 'payments'
                                ? 'text-accent border-b-2 border-blue-600'
                                : 'text-fg-muted hover:text-fg'
                            }`}
                          >
                            Payments
                          </button>
                          <button
                            onClick={() => setMemberActiveTab('statements')}
                            className={`px-4 py-2 font-medium transition-colors ${
                              memberActiveTab === 'statements'
                                ? 'text-accent border-b-2 border-blue-600'
                                : 'text-fg-muted hover:text-fg'
                            }`}
                          >
                            Statements
                          </button>
                          </>
                          )}
                        </div>

                        {memberActiveTab === 'info' && (
                        <div className="space-y-4">
                          {/* Basic Information */}
                          <div className="surface-card rounded-lg p-4 border border-border">
                            <h4 className="text-base font-semibold mb-3 text-fg">Basic Information</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name</label>
                                {renderEditableMemberField(
                                  'firstName',
                                  <p className="text-base font-semibold text-fg">{member.firstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'name',
                                  member._id,
                                  undefined
                                )}
                              </div>
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name (Hebrew)</label>
                                {renderEditableMemberField(
                                  'hebrewFirstName',
                                  <p className="text-base font-semibold text-fg" dir="rtl">{member.hebrewFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'hebrew',
                                  member._id,
                                  undefined
                                )}
                              </div>
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Last Name</label>
                                {renderEditableMemberField(
                                  'lastName',
                                  <p className="text-base font-semibold text-fg">{member.lastName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'name',
                                  member._id,
                                  undefined
                                )}
                              </div>
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Last Name (Hebrew)</label>
                                {renderEditableMemberField(
                                  'hebrewLastName',
                                  <p className="text-base font-semibold text-fg" dir="rtl">{member.hebrewLastName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'hebrew',
                                  member._id,
                                  undefined
                                )}
                              </div>
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Gender</label>
                                {renderEditableMemberField(
                                  'gender',
                                  <p className="text-base font-semibold text-fg capitalize">{member.gender || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'select',
                                  member._id,
                                  [
                                    { value: 'male', label: 'Male' },
                                    { value: 'female', label: 'Female' }
                                  ]
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Birth Information */}
                          <div className="surface-card rounded-lg p-4 border border-border">
                            <h4 className="text-base font-semibold mb-3 text-fg">Birth Information</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Birth Date</label>
                                {renderEditableMemberField(
                                  'birthDate',
                                  <p className="text-base font-semibold text-fg">{member.birthDate ? new Date(member.birthDate).toLocaleDateString() : <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'date',
                                  member._id,
                                  undefined
                                )}
                              </div>
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Hebrew Birth Date (Auto-calculated)</label>
                                <div className="border border-border rounded px-3 py-2">
                                  <p className="text-base font-semibold text-fg" dir="rtl">{displayHebrewDate || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Current Age</label>
                                <div className="border border-border rounded px-3 py-2">
                                  <p className="text-base font-semibold text-fg">{age} years</p>
                                </div>
                              </div>
                              {member.barMitzvahDate && (
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Bar/Bat Mitzvah Date</label>
                                  <div className="border border-border rounded px-3 py-2">
                                    <p className="text-base font-semibold text-fg">{new Date(member.barMitzvahDate).toLocaleDateString()}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Marriage Information - Show if age >= 18 or if fields have values */}
                          {(age >= 18 || member.weddingDate || member.spouseName || member.spouseFirstName || member.email || member.address || member.phone) && (
                            <div className="surface-card rounded-lg p-4 border border-border">
                              <h4 className="text-base font-semibold mb-3 text-fg">Marriage Information</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Wedding Date</label>
                                  {renderEditableMemberField(
                                    'weddingDate',
                                    <p className="text-base font-semibold text-fg">{member.weddingDate ? new Date(member.weddingDate).toLocaleDateString() : <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'date',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse First Name</label>
                                  {renderEditableMemberField(
                                    'spouseFirstName',
                                    <p className="text-base font-semibold text-fg">{member.spouseFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'name',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Hebrew Name</label>
                                  {renderEditableMemberField(
                                    'spouseHebrewName',
                                    <p className="text-base font-semibold text-fg" dir="rtl">{member.spouseHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'hebrew',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Father's Hebrew Name</label>
                                  {renderEditableMemberField(
                                    'spouseFatherHebrewName',
                                    <p className="text-base font-semibold text-fg" dir="rtl">{member.spouseFatherHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'hebrew',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Cell Phone</label>
                                  {renderEditableMemberField(
                                    'spouseCellPhone',
                                    <p className="text-base font-semibold text-fg">{member.spouseCellPhone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'phone',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Phone</label>
                                {renderEditableMemberField(
                                  'phone',
                                  <p className="text-base font-semibold text-fg">{member.phone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'phone',
                                  member._id,
                                  undefined
                                )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Email</label>
                                {renderEditableMemberField(
                                  'email',
                                  <p className="text-base font-semibold text-fg">{member.email || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                  'email',
                                  member._id,
                                  undefined
                                )}
                                </div>
                                <div className="md:col-span-2">
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Address</label>
                                  {renderEditableMemberField(
                                    'address',
                                    <p className="text-base font-semibold text-fg">{member.address || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'name',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">City</label>
                                  {renderEditableMemberField(
                                    'city',
                                    <p className="text-base font-semibold text-fg">{member.city || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'name',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">State</label>
                                  {renderEditableMemberField(
                                    'state',
                                    <p className="text-base font-semibold text-fg">{member.state || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'name',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">ZIP Code</label>
                                  {renderEditableMemberField(
                                    'zip',
                                    <p className="text-base font-semibold text-fg">{member.zip || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                    'text',
                                    member._id,
                                    undefined
                                  )}
                                </div>
                                {/* Keep spouseName for backward compatibility */}
                                {member.spouseName && !member.spouseFirstName && (
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Name (Legacy)</label>
                                  {renderEditableMemberField(
                                    'spouseName',
                                    <p className="text-base font-semibold text-fg">{member.spouseName}</p>,
                                    'name',
                                    member._id,
                                    undefined
                                  )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          {isAdmin && (
                          <div className="flex gap-2 pt-4 border-t border-border">
                            <button
                              onClick={() => {
                                setEditingMember(member)
                                setMemberForm({
                                  firstName: member.firstName,
                                  hebrewFirstName: member.hebrewFirstName || '',
                                  lastName: member.lastName,
                                  hebrewLastName: member.hebrewLastName || '',
                                  birthDate: member.birthDate ? new Date(member.birthDate).toISOString().split('T')[0] : '',
                                  hebrewBirthDate: member.hebrewBirthDate || '',
                                  gender: member.gender || '',
                                  weddingDate: member.weddingDate ? new Date(member.weddingDate).toISOString().split('T')[0] : '',
                                  spouseName: member.spouseName || '',
                                  spouseFirstName: member.spouseFirstName || '',
                                  spouseHebrewName: member.spouseHebrewName || '',
                                  spouseFatherHebrewName: member.spouseFatherHebrewName || '',
                                  spouseCellPhone: member.spouseCellPhone || '',
                                  phone: member.phone || '',
                                  email: member.email || '',
                                  address: member.address || '',
                                  city: member.city || '',
                                  state: member.state || '',
                                  zip: member.zip || ''
                                })
                                setShowMemberModal(true)
                              }}
                              className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
                            >
                              Open Full Edit Modal
                            </button>
                            <button
                              onClick={() => handleDeleteMember(member)}
                              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                            >
                              Delete Member
                            </button>
                          </div>
                          )}
                        </div>
                        )}

                        {memberActiveTab === 'balance' && (
                          <div>
                            {loadingMemberFinancials ? (
                              <div className="text-center py-12">
                                <p className="text-fg-muted">Loading balance...</p>
                              </div>
                            ) : memberBalance ? (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  <div className="surface-card rounded-lg p-6 border border-border">
                                    <p className="text-sm font-medium text-fg-muted mb-1">Plan Cost (Annual)</p>
                                    <p className="text-2xl font-bold text-fg">{formatMoney(memberBalance.planCost)}</p>
                                  </div>
                                  <div className="surface-card rounded-lg p-6 border border-border">
                                    <p className="text-sm font-medium text-fg-muted mb-1">Total Payments</p>
                                    <p className="text-2xl font-bold text-green-600">{formatMoney(memberBalance.totalPayments)}</p>
                                  </div>
                                  <div className={`surface-card rounded-lg p-6 border border-border ${memberBalance.balance >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                                    <p className="text-sm font-medium text-fg-muted mb-1">Current Balance</p>
                                    <p className={`text-2xl font-bold ${memberBalance.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {formatMoney(memberBalance.balance)}
                                    </p>
                                  </div>
                                </div>
                                {memberBalance.totalLifecyclePayments > 0 && (
                                  <div className="surface-card rounded-lg p-4 border border-border">
                                    <p className="text-sm font-medium text-fg-muted mb-1">Lifecycle Events (Informational)</p>
                                    <p className="text-lg font-semibold text-fg">{formatMoney(memberBalance.totalLifecyclePayments)}</p>
                                    <p className="text-xs text-fg-muted mt-1">Note: Lifecycle events are not included in balance calculation</p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-12 glass rounded-xl border border-border">
                                <p className="text-fg-muted">No balance data available</p>
                              </div>
                            )}
                          </div>
                        )}

                        {memberActiveTab === 'payments' && (
                          <div>
                            <div className="flex justify-between mb-4">
                              <h3 className="text-lg font-semibold">Payments</h3>
                              <button
                                onClick={() => {
                                  setPaymentForm({
                                    ...paymentForm,
                                    paymentFor: 'member',
                                    memberId: member._id
                                  })
                                  setShowPaymentModal(true)
                                }}
                                className="bg-accent text-white px-4 py-2 rounded flex items-center gap-2"
                              >
                                <PlusIcon className="h-4 w-4" />
                                Add Payment
                              </button>
                            </div>
                            {loadingMemberFinancials ? (
                              <div className="text-center py-12">
                                <p className="text-fg-muted">Loading payments...</p>
                              </div>
                            ) : (
                              <DataView
                                tableId="family-member-payments"
                                rows={memberPayments}
                                columns={paymentColumnsFor('member-payment', formatMoney)}
                                rowKey={(p: any) => p._id}
                                globalSearch={{ placeholder: 'Search payments…' }}
                                pageSize={10}
                                import={{
                                  type: 'payments',
                                  familyId: String(params.id),
                                  memberId: member._id,
                                  onImported: () => fetchFamilyDetails(),
                                }}
                                mobileCard={(p) => paymentMobileCard(p, formatMoney)}
                                empty={
                                  <EmptyState
                                    title="No payments"
                                    description="No payments found for this member."
                                  />
                                }
                              />
                            )}
                          </div>
                        )}

                        {memberActiveTab === 'statements' && (
                          <div>
                            {loadingMemberFinancials ? (
                              <div className="text-center py-12">
                                <p className="text-fg-muted">Loading statements...</p>
                              </div>
                            ) : memberStatements.length === 0 ? (
                              <div className="text-center py-12 glass rounded-xl border border-border">
                                <div className="text-4xl mb-4">📄</div>
                                <p className="text-fg-muted">No statements found for this member.</p>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                {memberStatements.map((statement) => (
                                  <div key={statement._id} className="glass rounded-xl p-6 border border-border">
                                    <div className="flex justify-between items-start mb-4">
                                      <div>
                                        <h4 className="font-semibold text-lg">{statement.statementNumber}</h4>
                                        <p className="text-sm text-fg-muted">
                                          {new Date(statement.fromDate).toLocaleDateString()} - {new Date(statement.toDate).toLocaleDateString()}
                                        </p>
                                        <p className="text-xs text-fg-subtle mt-1">
                                          Generated: {new Date(statement.date).toLocaleDateString()}
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-sm text-fg-muted">Closing Balance</div>
                                        <div className="text-xl font-bold">{formatMoney(statement.closingBalance)}</div>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
                                      <div>
                                        <p className="text-xs text-fg-muted">Opening Balance</p>
                                        <p className="text-sm font-semibold">{formatMoney(statement.openingBalance)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-fg-muted">Income</p>
                                        <p className="text-sm font-semibold text-green-600">{formatMoney(statement.income)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-fg-muted">Expenses</p>
                                        <p className="text-sm font-semibold text-red-600">{formatMoney(statement.expenses)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-fg-muted">Closing Balance</p>
                                        <p className="text-sm font-semibold">{formatMoney(statement.closingBalance)}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()
                ) : (
                  // Members List View
                  <>
                    <div className="flex justify-between mb-6">
                      <div>
                        <h3 className="text-xl font-semibold text-fg mb-1">Family Members (Children)</h3>
                        <p className="text-sm text-fg-muted">Add children to track their ages for payment plan calculations</p>
                      </div>
                      {isAdmin && (
                      <button
                        onClick={openAddMemberModal}
                        className="bg-accent text-accent-fg px-6 py-3 rounded-xl flex items-center gap-2 hover:shadow-lg transition-all duration-200 transform hover:scale-105"
                      >
                        <PlusIcon className="h-5 w-5" />
                        Add Child
                      </button>
                      )}
                    </div>
                    <DataView
                      tableId="family-children"
                      rows={data.members}
                      globalSearch={{ placeholder: 'Search children…' }}
                      pageSize={10}
                      {...(isAdmin
                        ? {
                            import: {
                              type: 'members' as const,
                              familyId: String(params.id),
                              onImported: () => fetchFamilyDetails(),
                            },
                          }
                        : {})}
                      columns={buildMemberColumns({
                        paymentPlans,
                        getPlanName,
                        viewingMemberId,
                        setViewingMemberId,
                        onEdit: handleEditMember,
                        onDelete: handleDeleteMember,
                        canMutate: isAdmin,
                        formatMoney,
                      })}
                      rowKey={(m: any) => m._id}
                      mobileCard={(m: any) => {
                        const info = computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney)
                        return (
                          <div className="surface-card p-4">
                            <div className="flex items-start justify-between gap-3">
                              <button
                                onClick={() => setViewingMemberId(viewingMemberId === m._id ? null : m._id)}
                                className="focus-ring font-medium text-accent hover:underline text-left"
                              >
                                {m.firstName} {m.lastName}
                              </button>
                              {isAdmin && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleEditMember(m)}
                                  aria-label="Edit"
                                  className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteMember(m)}
                                  aria-label="Delete"
                                  className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              </div>
                              )}
                            </div>
                            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
                              <div>
                                <dt className="text-fg-muted">Age</dt>
                                <dd className="tabular">{info.age} years</dd>
                              </div>
                              <div>
                                <dt className="text-fg-muted">Born</dt>
                                <dd className="tabular">{new Date(m.birthDate).toLocaleDateString()}</dd>
                              </div>
                              <div className="col-span-2">
                                <dt className="text-fg-muted">Plan</dt>
                                <dd>{info.planText || '—'}</dd>
                              </div>
                            </dl>
                          </div>
                        )
                      }}
                      empty={
                        <EmptyState
                          icon="👶"
                          title="No children added yet"
                          description="Add children to track their ages for payment plan calculations."
                          cta={
                            isAdmin
                              ? { label: 'Add First Child', onClick: openAddMemberModal }
                              : undefined
                          }
                        />
                      }
                    />
                  </>
                )}
              </div>
            )}

            {activeTab === 'payments' && (
              <div>
                <div className="flex justify-between mb-4">
                  <h3 className="text-lg font-semibold">Payments</h3>
                  <button
                    onClick={() => {
                      setPaymentForm({
                        ...paymentForm,
                        paymentFor: 'family',
                        memberId: ''
                      })
                      setShowPaymentModal(true)
                    }}
                    className="bg-accent text-white px-4 py-2 rounded flex items-center gap-2"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Payment
                  </button>
                </div>
                {(() => {
                  const familyPayments = data.payments.filter((payment: any) => !payment.memberId)
                  return (
                    <DataView
                      tableId="family-payments"
                      rows={familyPayments}
                      columns={paymentColumnsFor('family-payment', formatMoney)}
                      rowKey={(p: any) => p._id}
                      globalSearch={{ placeholder: 'Search payments…' }}
                      pageSize={10}
                      import={{
                        type: 'payments',
                        familyId: String(params.id),
                        onImported: () => fetchFamilyDetails(),
                      }}
                      mobileCard={(p) => paymentMobileCard(p, formatMoney)}
                      empty={
                        <EmptyState
                          title="No payments"
                          description="No family-level payments yet."
                        />
                      }
                    />
                  )
                })()}
              </div>
            )}

            {activeTab === 'withdrawals' && (
              <div>
                <div className="flex justify-between mb-4">
                  <h3 className="text-lg font-semibold">Withdrawals</h3>
                  <button
                    onClick={openAddWithdrawal}
                    className="bg-accent text-white px-4 py-2 rounded flex items-center gap-2"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Withdrawal
                  </button>
                </div>
                <DataView
                  tableId="family-withdrawals"
                  rows={data.withdrawals || []}
                  globalSearch={{ placeholder: 'Search withdrawals…' }}
                  pageSize={10}
                  columns={[
                    {
                      id: 'date',
                      header: 'Date',
                      headerText: 'Date',
                      cell: (w: any) => (
                        <span className="tabular">
                          {new Date(w.withdrawalDate).toLocaleDateString()}
                        </span>
                      ),
                      exportValue: (w: any) => (w.withdrawalDate ? new Date(w.withdrawalDate) : ''),
                      filter: { type: 'dateRange', getValue: (w: any) => w.withdrawalDate || null },
                    },
                    {
                      id: 'reason',
                      header: 'Reason',
                      headerText: 'Reason',
                      cell: (w: any) => <span className="text-fg">{w.reason || '—'}</span>,
                      exportValue: (w: any) => w.reason || '',
                    },
                    {
                      id: 'amount',
                      header: 'Amount',
                      headerText: 'Amount',
                      align: 'right',
                      cell: (w: any) => (
                        <span className="font-medium tabular text-orange-600">
                          {formatMoney(-Number(w.amount || 0))}
                        </span>
                      ),
                      exportValue: (w: any) => w.amount || 0,
                      filter: { type: 'numberRange', getValue: (w: any) => w.amount || 0 },
                    },
                    {
                      id: 'notes',
                      header: 'Notes',
                      headerText: 'Notes',
                      hideBelow: 'lg',
                      defaultHidden: true,
                      cell: (w: any) => (
                        <span className="text-fg-muted text-sm">{w.notes || '—'}</span>
                      ),
                      exportValue: (w: any) => w.notes || '',
                    },
                    {
                      id: 'actions',
                      header: '',
                      headerText: 'Actions',
                      align: 'right',
                      cell: (w: any) => (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEditWithdrawal(w)}
                            className="text-accent hover:underline text-sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteWithdrawal(w)}
                            className="text-red-600 hover:underline text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      ),
                    },
                  ]}
                  rowKey={(w: any) => w._id}
                  mobileCard={(w: any) => (
                    <div className="surface-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium text-fg">{w.reason || 'Withdrawal'}</div>
                        <div className="font-medium tabular text-orange-600">
                          {formatMoney(-Number(w.amount || 0))}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-fg-muted tabular">
                        {new Date(w.withdrawalDate).toLocaleDateString()}
                      </div>
                      {w.notes && <div className="mt-1 text-xs text-fg-muted">{w.notes}</div>}
                      <div className="mt-3 flex gap-3">
                        <button
                          onClick={() => openEditWithdrawal(w)}
                          className="text-accent text-sm hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteWithdrawal(w)}
                          className="text-red-600 text-sm hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                  empty={
                    <EmptyState
                      title="No withdrawals"
                      description="No withdrawals recorded for this family yet."
                    />
                  }
                />
              </div>
            )}

            {activeTab === 'events' && (
              <div>
                <div className="flex justify-between mb-4">
                  <h3 className="text-lg font-semibold">Lifecycle Events</h3>
                  <button
                    onClick={() => setShowEventModal(true)}
                    className="bg-accent text-white px-4 py-2 rounded flex items-center gap-2"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Event
                  </button>
                </div>
                <DataView
                  tableId="family-events"
                  rows={data.lifecycleEvents}
                  globalSearch={{ placeholder: 'Search events…' }}
                  pageSize={10}
                  import={{
                    type: 'lifecycle-events',
                    familyId: String(params.id),
                    onImported: () => fetchFamilyDetails(),
                  }}
                  columns={[
                    {
                      id: 'date',
                      header: 'Date',
                      headerText: 'Date',
                      cell: (e: any) => <span className="tabular">{new Date(e.eventDate).toLocaleDateString()}</span>,
                      exportValue: (e: any) => (e.eventDate ? new Date(e.eventDate) : ''),
                      filter: { type: 'dateRange', getValue: (e: any) => e.eventDate || null },
                    },
                    {
                      id: 'eventType',
                      header: 'Event Type',
                      headerText: 'Event Type',
                      cell: (e: any) => <span className="capitalize text-fg">{e.eventType.replace('_', ' ')}</span>,
                      exportValue: (e: any) => (e.eventType || '').replace('_', ' '),
                      filter: {
                        type: 'multiselect',
                        getValue: (e: any) => e.eventType || '',
                      },
                    },
                    {
                      id: 'amount',
                      header: 'Amount',
                      headerText: 'Amount',
                      align: 'right',
                      cell: (e: any) => <span className="font-medium tabular">{formatMoney(e.amount)}</span>,
                      exportValue: (e: any) => e.amount || 0,
                      filter: { type: 'numberRange', getValue: (e: any) => e.amount || 0 },
                    },
                    {
                      id: 'year',
                      header: 'Year',
                      headerText: 'Year',
                      hideBelow: 'md',
                      cell: (e: any) => <span className="text-fg-muted tabular">{e.year}</span>,
                      exportValue: (e: any) => e.year || '',
                      filter: { type: 'select', getValue: (e: any) => (e.year ? String(e.year) : '') },
                    },
                    {
                      id: 'notes',
                      header: 'Notes',
                      headerText: 'Notes',
                      hideBelow: 'lg',
                      defaultHidden: true,
                      cell: (e: any) => <span className="text-fg-muted text-sm">{e.notes || '—'}</span>,
                      exportValue: (e: any) => e.notes || '',
                    },
                  ]}
                  rowKey={(e: any) => e._id}
                  mobileCard={(e: any) => (
                    <div className="surface-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="capitalize font-medium text-fg">{e.eventType.replace('_', ' ')}</div>
                        <div className="font-medium tabular text-fg">{formatMoney(e.amount)}</div>
                      </div>
                      <div className="mt-2 text-xs text-fg-muted tabular">
                        {new Date(e.eventDate).toLocaleDateString()} · {e.year}
                      </div>
                      {e.notes && <div className="mt-1 text-xs text-fg-muted">{e.notes}</div>}
                    </div>
                  )}
                  empty={
                    <EmptyState title="No events" description="No lifecycle events yet for this family." />
                  }
                />

              </div>
            )}

            {activeTab === 'cycle-charges' && (
              <div>
                <div className="flex justify-between mb-4 gap-3 flex-wrap">
                  <div>
                    <h3 className="text-lg font-semibold">Cycle Charges</h3>
                    <p className="text-xs text-fg-muted mt-1 max-w-prose">
                      Annual membership-dues charges captured by the cycle-rollover job on
                      each cycle start. Each row reduces the family balance by one
                      year&rsquo;s plan price; the current in-progress cycle is shown as
                      &ldquo;Plan Cost (Annual)&rdquo; on the Info tab instead.
                    </p>
                  </div>
                </div>
                <DataView
                  tableId="family-cycle-charges"
                  rows={data.cycleCharges || []}
                  globalSearch={{ placeholder: 'Search charges…' }}
                  pageSize={10}
                  columns={[
                    {
                      id: 'date',
                      header: 'Charge Date',
                      headerText: 'Charge Date',
                      cell: (c: any) => <span className="tabular">{new Date(c.chargeDate).toLocaleDateString()}</span>,
                      exportValue: (c: any) => (c.chargeDate ? new Date(c.chargeDate) : ''),
                      filter: { type: 'dateRange', getValue: (c: any) => c.chargeDate || null },
                    },
                    {
                      id: 'cycleYear',
                      header: 'Cycle Year',
                      headerText: 'Cycle Year',
                      cell: (c: any) => (
                        <span className="tabular text-fg">
                          {c.cycleYear}{' '}
                          <span className="text-xs text-fg-muted">
                            ({c.calendar === 'hebrew' ? 'Hebrew' : 'Gregorian'})
                          </span>
                        </span>
                      ),
                      exportValue: (c: any) => c.cycleYear || '',
                      filter: { type: 'select', getValue: (c: any) => String(c.cycleYear || '') },
                    },
                    {
                      id: 'plan',
                      header: 'Plan',
                      headerText: 'Plan',
                      cell: (c: any) => <span className="text-fg">{c.planName || '—'}</span>,
                      exportValue: (c: any) => c.planName || '',
                      filter: { type: 'multiselect', getValue: (c: any) => c.planName || '' },
                    },
                    {
                      id: 'amount',
                      header: 'Amount',
                      headerText: 'Amount',
                      align: 'right',
                      cell: (c: any) => <span className="font-medium tabular text-orange-600">{formatMoney(-(c.amount || 0))}</span>,
                      exportValue: (c: any) => -(c.amount || 0),
                      filter: { type: 'numberRange', getValue: (c: any) => c.amount || 0 },
                    },
                    {
                      id: 'notes',
                      header: 'Notes',
                      headerText: 'Notes',
                      hideBelow: 'lg',
                      defaultHidden: true,
                      cell: (c: any) => <span className="text-fg-muted text-sm">{c.notes || '—'}</span>,
                      exportValue: (c: any) => c.notes || '',
                    },
                  ]}
                  rowKey={(c: any) => c._id}
                  mobileCard={(c: any) => (
                    <div className="surface-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium text-fg">Cycle {c.cycleYear}</div>
                        <div className="font-medium tabular text-orange-600">{formatMoney(-(c.amount || 0))}</div>
                      </div>
                      <div className="mt-2 text-xs text-fg-muted tabular">
                        {new Date(c.chargeDate).toLocaleDateString()}
                        {c.planName ? ` · ${c.planName}` : ''}
                        {' · '}{c.calendar === 'hebrew' ? 'Hebrew' : 'Gregorian'}
                      </div>
                      {c.notes && <div className="mt-1 text-xs text-fg-muted">{c.notes}</div>}
                    </div>
                  )}
                  empty={
                    <EmptyState
                      title="No cycle charges yet"
                      description="No annual membership-dues charges have been recorded. The cycle-rollover job writes a row here each time a new membership year starts (Settings → Cycle)."
                    />
                  }
                />
              </div>
            )}

            {activeTab === 'statements' && (
              <div>
                <div className="flex justify-between mb-4">
                  <h3 className="text-lg font-semibold">Statements</h3>
                  {statements.length > 0 && (
                    <button
                      onClick={() => handlePrintAllStatements()}
                      className="bg-accent text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-accent-hover"
                    >
                      <PrinterIcon className="h-5 w-5" />
                      Print All Statements
                    </button>
                  )}
                </div>
                {statements.length === 0 ? (
                  <div className="text-center py-12 glass rounded-xl border border-border">
                    <div className="text-4xl mb-4">📄</div>
                    <p className="text-fg-muted">No statements found for this family.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {statements.map((statement) => (
                      <div key={statement._id} className="glass rounded-xl p-6 border border-border">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-semibold text-lg">{statement.statementNumber}</h4>
                            <p className="text-sm text-fg-muted">
                              {new Date(statement.fromDate).toLocaleDateString()} - {new Date(statement.toDate).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-fg-subtle mt-1">
                              Generated: {new Date(statement.date).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-fg-muted">Closing Balance</div>
                            <div className="text-xl font-bold">{formatMoney(statement.closingBalance)}</div>
                          </div>
                        </div>
                        <div className={`grid ${(statement.cycleCharges || 0) > 0 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-4'} gap-4 mt-4 pt-4 border-t border-border`}>
                          <div>
                            <div className="text-xs text-fg-muted">Opening Balance</div>
                            <div className="font-medium">{formatMoney(statement.openingBalance)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-fg-muted">Income</div>
                            <div className="font-medium text-green-600">{formatMoney(statement.income)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-fg-muted">Withdrawals</div>
                            <div className="font-medium text-orange-600">{formatMoney(statement.withdrawals)}</div>
                          </div>
                          {(statement.cycleCharges || 0) > 0 && (
                            <div>
                              <div className="text-xs text-fg-muted">Annual Dues</div>
                              <div className="font-medium text-orange-600">{formatMoney(statement.cycleCharges || 0)}</div>
                            </div>
                          )}
                          <div>
                            <div className="text-xs text-fg-muted">Expenses</div>
                            <div className="font-medium text-red-600">{formatMoney(statement.expenses)}</div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                          <button
                            onClick={() => handlePrintStatement(statement)}
                            className="text-accent hover:text-accent-hover flex items-center gap-1 text-sm"
                          >
                            <PrinterIcon className="h-4 w-4" />
                            Print
                          </button>
                          <button
                            onClick={() => handleSavePDFStatement(statement)}
                            className="text-green-600 hover:text-green-800 flex items-center gap-1 text-sm"
                          >
                            <DocumentArrowDownIcon className="h-4 w-4" />
                            Save as PDF
                          </button>
                          {data?.family?.email && (
                            <button
                              onClick={() => handleSendStatementEmail(statement)}
                              disabled={sendingEmail === statement._id}
                              className="text-purple-600 hover:text-purple-800 flex items-center gap-1 text-sm disabled:opacity-50"
                            >
                              <EnvelopeIcon className="h-4 w-4" />
                              {sendingEmail === statement._id ? 'Sending...' : 'Send Email'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeTab === 'sub-families' && (
              <div>
                <div className="flex justify-between mb-4">
                  <h3 className="text-lg font-semibold">Sub-Families</h3>
                  <p className="text-sm text-fg-muted">
                    Families created from members of this family
                  </p>
                </div>
                {loadingSubFamilies ? (
                  <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
                    <p className="text-fg-muted mt-4">Loading sub-families...</p>
                  </div>
                ) : (
                  <DataView
                    tableId="family-sub-families"
                    rows={subFamilies}
                    rowKey={(s: any) => s._id}
                    globalSearch={{
                      placeholder: 'Search sub-families…',
                      getValue: (s: any) =>
                        [
                          s.name,
                          s.hebrewName,
                          s.husbandFirstName,
                          s.wifeFirstName,
                          s.email,
                          s.address,
                          s.city,
                          s.state,
                          s.zip,
                        ]
                          .filter(Boolean)
                          .join(' '),
                    }}
                    pageSize={10}
                    columns={[
                      {
                        id: 'name',
                        header: 'Family Name',
                        sortable: true,
                        filter: { type: 'text', getValue: (s: any) => s.name || '' },
                        cell: (s: any) => (
                          <div className="flex flex-col">
                            <a
                              href={`/families/${s._id}`}
                              className="font-medium text-accent hover:underline"
                            >
                              {s.name}
                            </a>
                            {s.hebrewName && (
                              <span
                                className="text-xs text-fg-muted"
                                dir="rtl"
                                style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                              >
                                {s.hebrewName}
                              </span>
                            )}
                          </div>
                        ),
                        exportValue: (s: any) => s.name || '',
                      },
                      {
                        id: 'weddingDate',
                        header: 'Wedding Date',
                        sortable: true,
                        align: 'right',
                        filter: {
                          type: 'dateRange',
                          getValue: (s: any) => (s.weddingDate ? new Date(s.weddingDate) : null),
                        },
                        cell: (s: any) => (
                          <span className="tabular">
                            {s.weddingDate ? new Date(s.weddingDate).toLocaleDateString() : '—'}
                          </span>
                        ),
                        exportValue: (s: any) =>
                          s.weddingDate ? new Date(s.weddingDate).toLocaleDateString() : '',
                      },
                      {
                        id: 'husband',
                        header: 'Husband',
                        sortable: true,
                        filter: { type: 'text', getValue: (s: any) => s.husbandFirstName || '' },
                        cell: (s: any) => s.husbandFirstName || '—',
                        exportValue: (s: any) => s.husbandFirstName || '',
                      },
                      {
                        id: 'wife',
                        header: 'Wife',
                        sortable: true,
                        filter: { type: 'text', getValue: (s: any) => s.wifeFirstName || '' },
                        cell: (s: any) => s.wifeFirstName || '—',
                        exportValue: (s: any) => s.wifeFirstName || '',
                      },
                      {
                        id: 'email',
                        header: 'Email',
                        sortable: true,
                        filter: { type: 'text', getValue: (s: any) => s.email || '' },
                        cell: (s: any) => s.email || '—',
                        exportValue: (s: any) => s.email || '',
                      },
                      {
                        id: 'address',
                        header: 'Address',
                        filter: {
                          type: 'text',
                          getValue: (s: any) =>
                            [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '),
                        },
                        cell: (s: any) => {
                          const parts = [s.address, s.city, s.state, s.zip].filter(Boolean)
                          return parts.length > 0 ? (
                            <span className="text-sm text-fg-muted">{parts.join(', ')}</span>
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )
                        },
                        exportValue: (s: any) =>
                          [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '),
                      },
                      {
                        id: 'actions',
                        header: '',
                        sortable: false,
                        align: 'right',
                        cell: (s: any) => (
                          <a
                            href={`/families/${s._id}`}
                            className="focus-ring inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-fg/5"
                          >
                            View Details
                          </a>
                        ),
                        exportValue: () => '',
                      },
                    ]}
                    mobileCard={(s: any) => {
                      const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ')
                      return (
                        <div className="surface-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <a
                                href={`/families/${s._id}`}
                                className="focus-ring font-medium text-accent hover:underline"
                              >
                                {s.name}
                              </a>
                              {s.hebrewName && (
                                <div
                                  className="text-xs text-fg-muted"
                                  dir="rtl"
                                  style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                                >
                                  {s.hebrewName}
                                </div>
                              )}
                            </div>
                            <a
                              href={`/families/${s._id}`}
                              className="focus-ring inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-fg hover:bg-fg/5"
                            >
                              View
                            </a>
                          </div>
                          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
                            <div>
                              <dt className="text-fg-muted">Wedding</dt>
                              <dd className="tabular">
                                {s.weddingDate ? new Date(s.weddingDate).toLocaleDateString() : '—'}
                              </dd>
                            </div>
                            {s.husbandFirstName && (
                              <div>
                                <dt className="text-fg-muted">Husband</dt>
                                <dd>{s.husbandFirstName}</dd>
                              </div>
                            )}
                            {s.wifeFirstName && (
                              <div>
                                <dt className="text-fg-muted">Wife</dt>
                                <dd>{s.wifeFirstName}</dd>
                              </div>
                            )}
                            {s.email && (
                              <div className="col-span-2">
                                <dt className="text-fg-muted">Email</dt>
                                <dd className="break-all">{s.email}</dd>
                              </div>
                            )}
                            {addr && (
                              <div className="col-span-2">
                                <dt className="text-fg-muted">Address</dt>
                                <dd>{addr}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      )
                    }}
                    empty={
                      <EmptyState
                        icon="👨‍👩‍👧‍👦"
                        title="No sub-families found"
                        description="When members of this family get married and are converted to their own families, they will appear here."
                      />
                    }
                  />
                )}
              </div>
            )}
            {activeTab === 'tasks' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Tasks</h3>
                  <button
                    onClick={() => setShowTaskModal(true)}
                    className="bg-accent text-accent-fg px-4 py-2 rounded-lg flex items-center gap-2 hover:shadow-lg transition-all text-sm"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Task
                  </button>
                </div>
                {loadingFamilyTasks ? (
                  <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
                    <p className="text-fg-muted mt-4">Loading tasks...</p>
                  </div>
                ) : familyTasks.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardDocumentListIcon />}
                    title="No tasks yet"
                    description="Create a task to track follow-ups or reminders for this family."
                    cta={{
                      label: 'Add Task',
                      onClick: () => setShowTaskModal(true),
                      icon: <PlusIcon className="h-4 w-4" />,
                    }}
                  />
                ) : (
                  <ul className="space-y-3">
                    {familyTasks.map((task) => {
                      const dueDate = new Date(task.dueDate)
                      const today = new Date()
                      today.setHours(0, 0, 0, 0)
                      const isOverdue = dueDate < today && task.status !== 'completed'
                      const isDueToday = dueDate.toDateString() === today.toDateString()

                      const priorityColors: Record<string, string> = {
                        low: 'bg-fg/5 text-fg',
                        medium: 'bg-accent/10 text-accent',
                        high: 'bg-orange-100 text-orange-800',
                        urgent: 'bg-red-100 text-red-800',
                      }
                      const statusColors: Record<string, string> = {
                        pending: 'bg-yellow-100 text-yellow-800',
                        in_progress: 'bg-accent/10 text-accent',
                        completed: 'bg-green-100 text-green-800',
                        cancelled: 'bg-fg/5 text-fg',
                      }

                      return (
                        <li
                          key={task._id}
                          className={`glass rounded-xl p-4 border border-border hover:border-white/40 transition-all ${
                            isOverdue ? 'border-red-300 bg-red-50/50' : ''
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <h4 className="font-semibold text-fg break-words">{task.title}</h4>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${priorityColors[task.priority] || ''}`}>
                                  {task.priority}
                                </span>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[task.status] || ''}`}>
                                  {String(task.status).replace('_', ' ')}
                                </span>
                                {isDueToday && task.status !== 'completed' && (
                                  <span className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800 flex items-center gap-1">
                                    <ClockIcon className="h-3 w-3" aria-hidden="true" />
                                    Due Today
                                  </span>
                                )}
                                {isOverdue && (
                                  <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 flex items-center gap-1">
                                    <ExclamationTriangleIcon className="h-3 w-3" aria-hidden="true" />
                                    Overdue
                                  </span>
                                )}
                              </div>
                              {task.description && <p className="text-sm text-fg mb-2">{task.description}</p>}
                              <div className="flex items-center gap-x-4 gap-y-1 text-xs text-fg-muted flex-wrap">
                                <span>Due: {dueDate.toLocaleDateString()}</span>
                                <span>Email: {task.email}</span>
                                {task.relatedMemberId && (
                                  <span>
                                    Member: {task.relatedMemberId.firstName} {task.relatedMemberId.lastName}
                                  </span>
                                )}
                                {task.emailSent && <span className="text-green-700">✓ Email Sent</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 self-end sm:self-start">
                              {task.status !== 'completed' && (
                                <button
                                  onClick={() => completeFamilyTask(task._id)}
                                  aria-label={`Mark ${task.title} as completed`}
                                  title="Mark as completed"
                                  className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-green-700 hover:bg-green-50 transition-colors"
                                >
                                  <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
                                </button>
                              )}
                              <button
                                onClick={() => deleteFamilyTask(task)}
                                aria-label={`Delete ${task.title}`}
                                title="Delete task"
                                className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-red-700 hover:bg-red-50 transition-colors"
                              >
                                <TrashIcon className="h-5 w-5" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {showMemberModal && isAdmin && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="surface-card rounded-2xl p-8 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-border">
              <h2 className="text-2xl font-bold mb-2 text-fg">
                {editingMember ? 'Edit Child' : 'Add Child'}
              </h2>
              <p className="text-sm text-fg-muted mb-6">Add a child to the family</p>
              <form onSubmit={editingMember ? handleUpdateMember : handleAddMember} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium mb-2 text-fg">First Name *</label>
                  <input
                    type="text"
                    required
                    value={memberForm.firstName}
                    onChange={(e) => setMemberForm({ ...memberForm, firstName: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value) {
                        setMemberForm({ ...memberForm, firstName: capitalizeName(e.target.value) })
                      }
                    }}
                    className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                    placeholder="Enter first name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-fg">First Name (Hebrew) *</label>
                  <input
                    type="text"
                    required
                    dir="rtl"
                    lang="he"
                    inputMode="text"
                    value={memberForm.hebrewFirstName}
                    onChange={(e) => setMemberForm({ ...memberForm, hebrewFirstName: e.target.value })}
                    onKeyDown={(e) => handleHebrewInput(e, memberForm.hebrewFirstName, (value) => setMemberForm({ ...memberForm, hebrewFirstName: value }))}
                    className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all text-right font-hebrew"
                    placeholder="שם פרטי בעברית"
                    style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                  />
                </div>
                {editingMember && (
                  <div>
                    <label className="block text-sm font-medium mb-2 text-fg">Last Name *</label>
                    <input
                      type="text"
                      required
                      value={memberForm.lastName}
                      onChange={(e) => setMemberForm({ ...memberForm, lastName: e.target.value })}
                      onBlur={(e) => {
                        if (e.target.value) {
                          setMemberForm({ ...memberForm, lastName: capitalizeName(e.target.value) })
                        }
                      }}
                      className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                      placeholder="Enter last name"
                    />
                  </div>
                )}
                {editingMember && (
                  <div>
                    <label className="block text-sm font-medium mb-2 text-fg">Last Name (Hebrew) *</label>
                    <input
                      type="text"
                      required
                      dir="rtl"
                      lang="he"
                      inputMode="text"
                      value={memberForm.hebrewLastName}
                      onChange={(e) => setMemberForm({ ...memberForm, hebrewLastName: e.target.value })}
                      onKeyDown={(e) => handleHebrewInput(e, memberForm.hebrewLastName, (value) => setMemberForm({ ...memberForm, hebrewLastName: value }))}
                      className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all text-right font-hebrew"
                      placeholder="שם משפחה בעברית"
                      style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-2 text-fg">Birth Date (Gregorian) *</label>
                  <input
                    type="date"
                    required
                    value={memberForm.birthDate}
                    onChange={(e) => {
                      const gregorianDate = e.target.value
                      // Auto-calculate Hebrew date from Gregorian date (but don't show it in form)
                      if (gregorianDate) {
                        const dateObj = new Date(gregorianDate)
                        const hebrewDate = convertToHebrewDate(dateObj)
                        setMemberForm({ 
                          ...memberForm, 
                          birthDate: gregorianDate,
                          hebrewBirthDate: hebrewDate
                        })
                      } else {
                        setMemberForm({ ...memberForm, birthDate: gregorianDate })
                      }
                    }}
                    className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                  />
                  <p className="text-xs text-fg-muted mt-1">Hebrew date will be auto-calculated in the background</p>
                </div>
                {editingMember && (
                  <div>
                    <label className="block text-sm font-medium mb-2 text-fg">Hebrew Birth Date</label>
                    <input
                      type="text"
                      value={memberForm.hebrewBirthDate}
                      onChange={(e) => setMemberForm({ ...memberForm, hebrewBirthDate: e.target.value })}
                      className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                      placeholder="Hebrew birth date"
                    />
                    <p className="text-xs text-fg-muted mt-1">Hebrew date - Used for Bar/Bat Mitzvah date (13th Hebrew birthday)</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-2 text-fg">Gender *</label>
                  <select
                    value={memberForm.gender}
                    onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value as any })}
                    className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                    required
                  >
                    <option value="">Select Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                {editingMember && (
                  <>
                    <div className="border-t pt-4 mt-4">
                      <p className="text-sm font-semibold text-fg mb-3">Marriage Information (Auto-converts to new family)</p>
                      <div>
                        <label className="block text-sm font-medium mb-2 text-fg">Wedding Date</label>
                        <input
                          type="date"
                          value={memberForm.weddingDate}
                          onChange={(e) => setMemberForm({ ...memberForm, weddingDate: e.target.value })}
                          className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                          placeholder="Select wedding date"
                        />
                        <p className="text-xs text-fg-muted mt-1">When set, this child will be automatically converted to a new family on the wedding date and removed from current family</p>
                      </div>
                      <div className="mt-4">
                        <label className="block text-sm font-medium mb-2 text-fg">Spouse Name (Optional)</label>
                        <input
                          type="text"
                          value={memberForm.spouseName}
                          onChange={(e) => setMemberForm({ ...memberForm, spouseName: e.target.value })}
                          onBlur={(e) => {
                            if (e.target.value) {
                              setMemberForm({ ...memberForm, spouseName: capitalizeName(e.target.value) })
                            }
                          }}
                          className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                          placeholder="Enter spouse's full name"
                        />
                        <p className="text-xs text-fg-muted mt-1">Spouse will be added as a member of the new family</p>
                      </div>
                    </div>
                  </>
                )}
                <div className="flex gap-4 justify-end pt-4">
                  <button 
                    type="button" 
                    onClick={() => {
                      setShowMemberModal(false)
                      setEditingMember(null)
                      setMemberForm({
                        firstName: '',
                        hebrewFirstName: '',
                        lastName: '',
                        hebrewLastName: '',
                        birthDate: '',
                        hebrewBirthDate: '',
                        gender: '',
                        weddingDate: '',
                        spouseName: '',
                        spouseFirstName: '',
                        spouseHebrewName: '',
                        spouseFatherHebrewName: '',
                        spouseCellPhone: '',
                        phone: '',
                        email: '',
                        address: '',
                        city: '',
                        state: '',
                        zip: ''
                      })
                    }}
                    className="px-6 py-2 border border-border rounded-xl hover:bg-app-subtle transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="px-6 py-2 bg-accent text-accent-fg rounded-xl hover:shadow-lg transition-all duration-200 transform hover:scale-105"
                  >
                    {editingMember ? 'Update Child' : 'Add Child'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showInfoModal && isAdmin && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="surface-card rounded-2xl p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-border">
              <h2 className="text-2xl font-bold mb-4 text-fg">Edit Family Information</h2>
              <form onSubmit={async (e) => {
                e.preventDefault()
                try {
                  const res = await fetch(`/api/families/${params.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ...infoForm,
                      weddingDate: infoForm.weddingDate ? new Date(infoForm.weddingDate).toISOString() : undefined,
                      paymentPlanId: infoForm.paymentPlanId || undefined
                    })
                  })
                  if (res.ok) {
                    setShowInfoModal(false)
                    fetchFamilyDetails()
                  }
                } catch (error) {
                  console.error('Error updating family info:', error)
                }
              }} className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-fg">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Family Name *</label>
                      <input
                        type="text"
                        required
                        value={infoForm.name}
                        onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Family Name (Hebrew)</label>
                      <input
                        type="text"
                        dir="rtl"
                        lang="he"
                        value={infoForm.hebrewName}
                        onChange={(e) => setInfoForm({ ...infoForm, hebrewName: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                        style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Wedding Date *</label>
                      <input
                        type="date"
                        required
                        value={infoForm.weddingDate}
                        onChange={(e) => setInfoForm({ ...infoForm, weddingDate: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Payment Plan</label>
                      <select
                        value={infoForm.paymentPlanId}
                        onChange={(e) => setInfoForm({ ...infoForm, paymentPlanId: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      >
                        <option value="">Select a plan</option>
                        {paymentPlans.map(plan => (
                          <option key={plan._id} value={plan._id}>{plan.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Husband Information */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-fg">Husband Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">First Name</label>
                      <input
                        type="text"
                        value={infoForm.husbandFirstName}
                        onChange={(e) => setInfoForm({ ...infoForm, husbandFirstName: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Hebrew Name</label>
                      <input
                        type="text"
                        dir="rtl"
                        lang="he"
                        value={infoForm.husbandHebrewName}
                        onChange={(e) => setInfoForm({ ...infoForm, husbandHebrewName: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                        style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Father's Hebrew Name</label>
                      <input
                        type="text"
                        dir="rtl"
                        lang="he"
                        value={infoForm.husbandFatherHebrewName}
                        onChange={(e) => setInfoForm({ ...infoForm, husbandFatherHebrewName: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                        style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Cell Phone</label>
                      <input
                        type="tel"
                        value={infoForm.husbandCellPhone}
                        onChange={(e) => setInfoForm({ ...infoForm, husbandCellPhone: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Wife Information */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-fg">Wife Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">First Name</label>
                      <input
                        type="text"
                        value={infoForm.wifeFirstName}
                        onChange={(e) => setInfoForm({ ...infoForm, wifeFirstName: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Hebrew Name</label>
                      <input
                        type="text"
                        dir="rtl"
                        lang="he"
                        value={infoForm.wifeHebrewName}
                        onChange={(e) => setInfoForm({ ...infoForm, wifeHebrewName: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                        style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Father's Hebrew Name</label>
                      <input
                        type="text"
                        dir="rtl"
                        lang="he"
                        value={infoForm.wifeFatherHebrewName}
                        onChange={(e) => setInfoForm({ ...infoForm, wifeFatherHebrewName: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                        style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Cell Phone</label>
                      <input
                        type="tel"
                        value={infoForm.wifeCellPhone}
                        onChange={(e) => setInfoForm({ ...infoForm, wifeCellPhone: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-fg">Contact Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium mb-2 text-fg">Email</label>
                      <input
                        type="email"
                        value={infoForm.email}
                        onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                        placeholder="family@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">Phone</label>
                      <input
                        type="tel"
                        value={infoForm.phone}
                        onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">ZIP Code</label>
                      <input
                        type="text"
                        value={infoForm.zip}
                        onChange={(e) => setInfoForm({ ...infoForm, zip: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                        placeholder="12345"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium mb-2 text-fg">Street Address</label>
                      <input
                        type="text"
                        value={infoForm.street || infoForm.address}
                        onChange={(e) => setInfoForm({ ...infoForm, street: e.target.value, address: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                        placeholder="123 Main Street"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">City</label>
                      <input
                        type="text"
                        value={infoForm.city}
                        onChange={(e) => setInfoForm({ ...infoForm, city: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                        placeholder="New York"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-fg">State</label>
                      <input
                        type="text"
                        value={infoForm.state}
                        onChange={(e) => setInfoForm({ ...infoForm, state: e.target.value })}
                        className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                        placeholder="NY"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => setShowInfoModal(false)}
                    className="px-6 py-2 border border-border rounded-xl hover:bg-app-subtle transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-accent text-accent-fg rounded-xl hover:shadow-lg transition-all duration-200 transform hover:scale-105"
                  >
                    Save Info
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showPaymentModal && isAdmin && (
          <Modal title="Add Payment" onClose={() => setShowPaymentModal(false)}>
            <form onSubmit={handleAddPayment} className="space-y-4">
              {/* Payment For Selection - Only show if opened from member view, otherwise default to family */}
              {viewingMemberId && memberActiveTab === 'payments' ? (
                <>
                  {/* When viewing a member, allow selecting payment for member or family */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Payment For *</label>
                    <select
                      value={paymentForm.paymentFor}
                      onChange={(e) => setPaymentForm({ 
                        ...paymentForm, 
                        paymentFor: e.target.value as 'family' | 'member',
                        memberId: e.target.value === 'family' ? '' : viewingMemberId
                      })}
                      className="w-full border rounded px-3 py-2"
                      required
                    >
                      <option value="member">Member (Current: {data?.members?.find((m: any) => m._id === viewingMemberId)?.firstName} {data?.members?.find((m: any) => m._id === viewingMemberId)?.lastName})</option>
                      <option value="family">Family</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {/* When on family Payments tab, payment is always for family - hide the selection */}
                  <input type="hidden" value="family" />
                </>
              )}

              {/* Member Selection - Show only if paymentFor is 'member' and not viewing a specific member */}
              {paymentForm.paymentFor === 'member' && !viewingMemberId && (
                <div>
                  <label className="block text-sm font-medium mb-1">Select Member *</label>
                  <select
                    value={paymentForm.memberId}
                    onChange={(e) => setPaymentForm({ ...paymentForm, memberId: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    required={paymentForm.paymentFor === 'member'}
                  >
                    <option value="">Select a member...</option>
                    {data?.members?.map((member: any) => (
                      <option key={member._id} value={member._id}>
                        {member.firstName} {member.lastName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Amount *</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount || ''}
                  onChange={(e) => {
                    const value = e.target.value
                    setPaymentForm({ ...paymentForm, amount: value ? parseFloat(value) : 0 })
                  }}
                  className="w-full border rounded px-3 py-2"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Payment Date *</label>
                <input
                  type="date"
                  required
                  value={paymentForm.paymentDate}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Year *</label>
                <input
                  type="number"
                  required
                  value={paymentForm.year}
                  onChange={(e) => setPaymentForm({ ...paymentForm, year: parseInt(e.target.value) })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={paymentForm.type}
                  onChange={(e) => setPaymentForm({ ...paymentForm, type: e.target.value as any })}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="membership">Membership</option>
                  <option value="donation">Donation</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Payment Frequency *</label>
                <select
                  value={paymentForm.paymentFrequency}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentFrequency: e.target.value as 'one-time' | 'monthly' })}
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="one-time">One-Time Payment</option>
                  <option value="monthly">Monthly Payment</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Payment Method *</label>
                <select
                  value={paymentForm.paymentMethod || 'cash'}
                  onChange={(e) => {
                    const selectedMethod = e.target.value as 'cash' | 'credit_card' | 'check' | 'quick_pay'
                    setPaymentForm({ ...paymentForm, paymentMethod: selectedMethod, useSavedCard: false })
                  }}
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="cash">Cash</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="check">Check</option>
                  <option value="quick_pay">Quick Pay</option>
                </select>
              </div>

              {/* Credit Card Fields */}
              {paymentForm.paymentMethod === 'credit_card' && (
                <div className="space-y-3 p-4 bg-accent/10 rounded-lg border border-accent/20">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-fg">Credit Card Information</h4>
                    {paymentForm.amount > 0 && (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={useStripe}
                          onChange={(e) => {
                            setUseStripe(e.target.checked)
                            if (e.target.checked) {
                              setPaymentForm({ ...paymentForm, useSavedCard: false })
                            }
                          }}
                          className="rounded"
                        />
                        <span>Use Stripe (Secure Payment)</span>
                      </label>
                    )}
                  </div>

                  {/* Saved Cards */}
                  {savedPaymentMethods.length > 0 && !useStripe && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium mb-2">Saved Cards on File</label>
                      <div className="space-y-2">
                        {savedPaymentMethods.map((card) => (
                          <label
                            key={card._id}
                            className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/10 ${
                              paymentForm.useSavedCard && paymentForm.selectedSavedCardId === card._id
                                ? 'bg-accent/20 border-accent'
                                : 'bg-surface'
                            }`}
                          >
                            <input
                              type="radio"
                              name="savedCard"
                              checked={paymentForm.useSavedCard && paymentForm.selectedSavedCardId === card._id}
                              onChange={() => setPaymentForm({
                                ...paymentForm,
                                useSavedCard: true,
                                selectedSavedCardId: card._id
                              })}
                              className="rounded"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{card.cardType.toUpperCase()}</span>
                                <span>•••• {card.last4}</span>
                                {card.isDefault && (
                                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                                )}
                              </div>
                              <div className="text-xs text-fg-muted">
                                Expires {card.expiryMonth}/{card.expiryYear}
                                {card.nameOnCard && ` • ${card.nameOnCard}`}
                              </div>
                            </div>
                          </label>
                        ))}
                        <button
                          type="button"
                          onClick={() => setPaymentForm({ ...paymentForm, useSavedCard: false, selectedSavedCardId: '' })}
                          className="text-sm text-accent hover:text-accent-hover"
                        >
                          Use new card instead
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {!paymentForm.useSavedCard && (
                    <>
                  {useStripe ? (
                    <StripePaymentForm
                      amount={paymentForm.amount}
                      familyId={params.id as string}
                      paymentDate={paymentForm.paymentDate}
                      year={paymentForm.year}
                      type={paymentForm.type}
                      notes={paymentForm.notes}
                      saveCard={paymentForm.saveCard}
                      paymentFrequency={paymentForm.paymentFrequency}
                      memberId={paymentForm.paymentFor === 'member' && paymentForm.memberId ? paymentForm.memberId : undefined}
                      onSuccess={async () => {
                        setShowPaymentModal(false)
                        setUseStripe(false)
                        setPaymentForm({
                          amount: 0,
                          paymentDate: new Date().toISOString().split('T')[0],
                          year: new Date().getFullYear(),
                          type: 'membership',
                          paymentMethod: 'cash',
                          paymentFrequency: 'one-time',
                          paymentFor: 'family',
                          memberId: '',
                          saveCard: false,
                          useSavedCard: false,
                          selectedSavedCardId: '',
                          ccLast4: '',
                          ccCardType: '',
                          ccExpiryMonth: '',
                          ccExpiryYear: '',
                          ccNameOnCard: '',
                          checkNumber: '',
                          checkBankName: '',
                          checkRoutingNumber: '',
                          notes: ''
                        })
                        fetchFamilyDetails()
                        fetchSavedPaymentMethods()
                      }}
                      onError={(error) => {
                        toast.error(`Payment error: ${error}`)
                      }}
                    />
                  ) : (
                    <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Last 4 Digits *</label>
                      <input
                        type="text"
                        required
                        maxLength={4}
                        value={paymentForm.ccLast4}
                        onChange={(e) => setPaymentForm({ ...paymentForm, ccLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                        className="w-full border rounded px-3 py-2"
                        placeholder="1234"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Card Type</label>
                      <select
                        value={paymentForm.ccCardType}
                        onChange={(e) => setPaymentForm({ ...paymentForm, ccCardType: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      >
                        <option value="">Select...</option>
                        <option value="Visa">Visa</option>
                        <option value="Mastercard">Mastercard</option>
                        <option value="American Express">American Express</option>
                        <option value="Discover">Discover</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Expiry Month</label>
                      <input
                        type="text"
                        maxLength={2}
                        value={paymentForm.ccExpiryMonth}
                        onChange={(e) => setPaymentForm({ ...paymentForm, ccExpiryMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                        className="w-full border rounded px-3 py-2"
                        placeholder="MM"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Expiry Year</label>
                      <input
                        type="text"
                        maxLength={4}
                        value={paymentForm.ccExpiryYear}
                        onChange={(e) => setPaymentForm({ ...paymentForm, ccExpiryYear: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                        className="w-full border rounded px-3 py-2"
                        placeholder="YYYY"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Name on Card</label>
                    <input
                      type="text"
                      value={paymentForm.ccNameOnCard}
                      onChange={(e) => setPaymentForm({ ...paymentForm, ccNameOnCard: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="John Doe"
                    />
                  </div>
                      {paymentForm.amount > 0 && (
                        <label className="flex items-center gap-2 text-sm mt-3">
                          <input
                            type="checkbox"
                            checked={paymentForm.saveCard}
                            onChange={(e) => setPaymentForm({ ...paymentForm, saveCard: e.target.checked })}
                            className="rounded"
                          />
                          <span>Save card for future use</span>
                        </label>
                      )}
                    </>
                  )}
                    </>
                  )}
                  {paymentForm.useSavedCard && paymentForm.selectedSavedCardId && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg mt-3">
                      <p className="text-sm text-green-800 mb-2">
                        Ready to charge saved card. Click "Add Payment" below to process.
                      </p>
                      {paymentForm.paymentFrequency === 'monthly' && (
                        <p className="text-xs text-green-700">
                          This will be set up as a monthly recurring payment.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Check Fields */}
              {paymentForm.paymentMethod === 'check' && (
                <div className="space-y-3 p-4 bg-green-50 rounded-lg border border-green-200">
                  <h4 className="font-medium text-fg mb-2">Check Information</h4>
                  <div>
                    <label className="block text-sm font-medium mb-1">Check Number *</label>
                    <input
                      type="text"
                      required
                      value={paymentForm.checkNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, checkNumber: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="1234"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Bank Name</label>
                    <input
                      type="text"
                      value={paymentForm.checkBankName}
                      onChange={(e) => setPaymentForm({ ...paymentForm, checkBankName: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="Bank Name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Routing Number</label>
                    <input
                      type="text"
                      value={paymentForm.checkRoutingNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, checkRoutingNumber: e.target.value.replace(/\D/g, '') })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="9-digit routing number"
                      maxLength={9}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                />
              </div>
              {!(paymentForm.paymentMethod === 'credit_card' && useStripe) && (
                <div className="flex gap-4 justify-end">
                  <button type="button" onClick={() => {
                    setShowPaymentModal(false)
                    setUseStripe(false)
                  }} className="px-4 py-2 border rounded">
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 bg-accent text-white rounded">
                    Add Payment
                  </button>
                </div>
              )}
            </form>
          </Modal>
        )}

        {showEmailModal && isAdmin && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-surface rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold mb-4">Email Configuration</h2>
              <p className="text-sm text-fg-muted mb-4">
                Configure email settings to send statements via email.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Gmail Address *</label>
                  <input
                    type="email"
                    required
                    value={emailFormData.email}
                    onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
                    placeholder="your-email@gmail.com"
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Gmail App Password *</label>
                  <input
                    type="password"
                    required
                    value={emailFormData.password}
                    onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
                    placeholder="16-character app password"
                    className="w-full border rounded px-3 py-2"
                  />
                  <p className="text-xs text-fg-muted mt-1">
                    Generate an app password from{' '}
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-accent underline">
                      Google Account Settings
                    </a>
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">From Name</label>
                  <input
                    type="text"
                    value={emailFormData.fromName}
                    onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
                    placeholder="Kasa Family Management"
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div className="flex gap-4 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(false)}
                    className="px-4 py-2 border rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEmailConfig}
                    className="px-4 py-2 bg-purple-600 text-white rounded"
                  >
                    Save & Continue
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showEventModal && isAdmin && (
          <Modal title="Add Lifecycle Event" onClose={() => setShowEventModal(false)}>
            <form onSubmit={handleAddEvent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Event Type *</label>
                <select
                  value={eventForm.eventType}
                  onChange={(e) => updateEventAmount(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                >
                  {lifecycleEventTypes.length === 0 ? (
                    <option value="">Loading event types...</option>
                  ) : (
                    lifecycleEventTypes.map((eventType) => (
                      <option key={eventType._id} value={eventType.type}>
                        {eventType.name} - {formatMoney(eventType.amount)}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amount *</label>
                <input
                  type="number"
                  required
                  value={eventForm.amount}
                  onChange={(e) => setEventForm({ ...eventForm, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Event Date *</label>
                <input
                  type="date"
                  required
                  value={eventForm.eventDate}
                  onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Year *</label>
                <input
                  type="number"
                  required
                  value={eventForm.year}
                  onChange={(e) => setEventForm({ ...eventForm, year: parseInt(e.target.value) })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={eventForm.notes}
                  onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                />
              </div>
              <div className="flex gap-4 justify-end">
                <button type="button" onClick={() => setShowEventModal(false)} className="px-4 py-2 border rounded">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-accent text-white rounded">
                  Add Event
                </button>
              </div>
            </form>
          </Modal>
        )}

        {showWithdrawalModal && isAdmin && (
          <Modal
            title={editingWithdrawal ? 'Edit Withdrawal' : 'Add Withdrawal'}
            onClose={() => {
              setShowWithdrawalModal(false)
              setEditingWithdrawal(null)
            }}
          >
            <form onSubmit={handleSaveWithdrawal} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={withdrawalForm.amount}
                  onChange={(e) =>
                    setWithdrawalForm({
                      ...withdrawalForm,
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Withdrawal Date *</label>
                <input
                  type="date"
                  required
                  value={withdrawalForm.withdrawalDate}
                  onChange={(e) =>
                    setWithdrawalForm({ ...withdrawalForm, withdrawalDate: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reason</label>
                <input
                  type="text"
                  value={withdrawalForm.reason}
                  onChange={(e) =>
                    setWithdrawalForm({ ...withdrawalForm, reason: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g. Refund, Adjustment"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={withdrawalForm.notes}
                  onChange={(e) =>
                    setWithdrawalForm({ ...withdrawalForm, notes: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                />
              </div>
              <div className="flex gap-4 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowWithdrawalModal(false)
                    setEditingWithdrawal(null)
                  }}
                  className="px-4 py-2 border rounded"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-accent text-white rounded">
                  {editingWithdrawal ? 'Save Changes' : 'Add Withdrawal'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        <TaskFormModal
          open={showTaskModal && isAdmin}
          onClose={() => setShowTaskModal(false)}
          defaults={{
            relatedFamilyId: typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '',
            email: data?.family?.email || '',
          }}
          lockFamily
          onCreated={() => {
            if (activeTab === 'tasks') fetchFamilyTasks()
          }}
        />
      </div>
    </main>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-surface rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-xl font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}









































