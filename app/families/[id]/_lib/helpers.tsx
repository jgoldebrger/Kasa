import type React from 'react'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'
import { netPaymentAmount } from '@/lib/money'
import { formatLocaleDate } from '@/lib/date-utils'
import { sanitizePaymentNotes } from '@/lib/payments/sanitize'
import type { DataColumn } from '@/app/components/ui'

export function formatPaymentMethod(payment: any): string {
  if (!payment?.paymentMethod) return 'Cash'
  const labels: Record<string, string> = {
    cash: 'Cash',
    credit_card: payment.ccInfo?.last4 ? `Credit Card •••• ${payment.ccInfo.last4}` : 'Credit Card',
    check: payment.checkInfo?.checkNumber ? `Check #${payment.checkInfo.checkNumber}` : 'Check',
    quick_pay: 'Quick Pay',
  }
  return labels[payment.paymentMethod] || payment.paymentMethod
}

export function formatPaymentAmount(
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

export function paymentColumnsFor(tableHint: string, fmt: (n: number) => string): DataColumn<any>[] {
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

export function paymentMobileCard(p: any, fmt: (n: number) => string) {
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
export function computeMemberDisplay(
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
export const PLAN_COLOR_PALETTE = [
  'text-accent',
  'text-success dark:text-green-400',
  'text-purple-600 dark:text-purple-400',
  'text-warning dark:text-orange-400',
  'text-pink-600 dark:text-pink-400',
  'text-amber-600 dark:text-amber-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-rose-600 dark:text-rose-400',
] as const
export function planColorForNumber(planNumber: number | null | undefined): string {
  if (!planNumber || planNumber < 1) return 'text-fg-muted'
  const idx = (planNumber - 1) % PLAN_COLOR_PALETTE.length
  return PLAN_COLOR_PALETTE[idx]
}

export function buildMemberColumns({
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
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-danger hover:bg-danger/10"
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
export const qwertyToHebrew: { [key: string]: string } = {
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
export const handleHebrewInput = (e: React.KeyboardEvent<HTMLInputElement>, currentValue: string, setValue: (value: string) => void) => {
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
export const capitalizeName = (text: string): string => {
  if (!text) return text
  return text
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Helper function to format phone number (numbers only)
export const formatPhone = (value: string): string => {
  // Remove all non-numeric characters
  return value.replace(/\D/g, '')
}

// Helper function to validate email format
export const validateEmail = (email: string): boolean => {
  if (!email) return true // Empty is valid (optional field)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export interface FamilyDetails {
  family: any
  members: any[]
  payments: any[]
  withdrawals: any[]
  lifecycleEvents: any[]
  cycleCharges: any[]
  balance: any
}

export interface PaymentPlan {
  _id: string
  name: string
  yearlyPrice: number
  planNumber?: number
}

export interface LifecycleEventType {
  _id: string
  type: string
  name: string
  amount: number
}
