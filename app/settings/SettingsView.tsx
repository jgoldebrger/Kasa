'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { EnvelopeIcon, PlusIcon, TrashIcon, CalendarIcon, CreditCardIcon, UserGroupIcon, PrinterIcon, DocumentArrowDownIcon, PhotoIcon, IdentificationIcon, TagIcon, ClockIcon, GlobeAltIcon } from '@heroicons/react/24/outline'
import { useConfirm, useToast } from '@/app/components/Toast'
import { convertToHebrewDate } from '@/lib/hebrew-date'
import { escapeHtml } from '@/lib/html-escape'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useCurrency } from '@/lib/client/useCurrency'
import { isFiniteDate } from '@/lib/date-utils'
import { PageHeader, SkeletonRows, Tabs } from '@/app/components/ui'
import MembersPanel from '@/app/components/settings/MembersPanel'
import BrandingPanel from '@/app/components/settings/BrandingPanel'
import TrashPanel from '@/app/components/settings/TrashPanel'
import LetterheadPanel from '@/app/components/settings/LetterheadPanel'
import MailLabelsPanel from '@/app/components/settings/MailLabelsPanel'
import LocalizationPanel from '@/app/components/settings/LocalizationPanel'
import ActivityPanel from '@/app/components/settings/ActivityPanel'
import PaymentPlansTable from '@/app/components/settings/PaymentPlansTable'
import EventTypesTable from '@/app/components/settings/EventTypesTable'
import BillingPanel, { type BillingSnapshot } from '@/app/components/settings/BillingPanel'

interface LifecycleEventType {
  _id: string
  type: string
  name: string
  amount: number
}

interface Family {
  _id: string
  name: string
  weddingDate: string
}

interface PaymentPlan {
  _id: string
  name: string
  yearlyPrice: number
  familyCount?: number
  families?: Family[]
}

const EMPTY_LETTERHEAD = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
  taxId: '',
  signatureName: '',
  signatureTitle: '',
  statementFooter: '',
  receiptThankYou: '',
  taxDeductibleDisclosure: '',
}

type TabType =
  | 'email'
  | 'eventTypes'
  | 'paymentPlans'
  | 'automation'
  | 'kevittel'
  | 'cycle'
  | 'branding'
  | 'letterhead'
  | 'labels'
  | 'localization'
  | 'activity'
  | 'members'
  | 'billing'
  | 'trash'

const VALID_TABS: readonly TabType[] = [
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
] as const

function isValidTab(s: string | null | undefined): s is TabType {
  return !!s && (VALID_TABS as readonly string[]).includes(s)
}

// Hebrew month numbers follow @hebcal: 1=Nisan ... 7=Tishrei ... 12=Adar
// (or Adar I in a leap year), 13=Adar II (leap years only). We render all
// 13 so admins can pick Adar II if they want, with a parenthetical that
// flags its leap-year-only nature.
const HEBREW_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: 'Tishrei' },
  { value: 8, label: 'Cheshvan' },
  { value: 9, label: 'Kislev' },
  { value: 10, label: 'Tevet' },
  { value: 11, label: 'Shevat' },
  { value: 12, label: 'Adar (Adar I in leap years)' },
  { value: 13, label: 'Adar II (leap years only)' },
  { value: 1, label: 'Nisan' },
  { value: 2, label: 'Iyar' },
  { value: 3, label: 'Sivan' },
  { value: 4, label: 'Tammuz' },
  { value: 5, label: 'Av' },
  { value: 6, label: 'Elul' },
]

function hebrewMonthLabel(month: number | undefined | null): string {
  const m = Number(month)
  const hit = HEBREW_MONTH_OPTIONS.find((o) => o.value === m)
  return hit ? hit.label.replace(/ \(.*\)$/, '') : ''
}

export interface SettingsViewProps {
  initialEmailConfig?: any | null
  initialEventTypes?: LifecycleEventType[]
  initialPaymentPlans?: PaymentPlan[]
  initialCycleConfig?: any | null
  initialCurrentRole?: 'owner' | 'admin' | 'member' | null
  initialBilling?: BillingSnapshot | null
}

export default function SettingsView({
  initialEmailConfig,
  initialEventTypes,
  initialPaymentPlans,
  initialCycleConfig,
  initialCurrentRole,
  initialBilling,
}: SettingsViewProps = {}) {
  const confirm = useConfirm()
  const toast = useToast()
  const { format: formatMoney, symbol: currencySymbol } = useCurrency()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Deep-link support: `?tab=members` and friends.
  const initialTab: TabType = isValidTab(searchParams.get('tab'))
    ? (searchParams.get('tab') as TabType)
    : 'email'
  const [activeTab, setActiveTab] = useState<TabType>(initialTab)

  // Keep activeTab in sync when the URL changes (e.g. Playwright goto with ?tab=).
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const next = isValidTab(tabParam) ? tabParam : 'email'
    setActiveTab((prev) => (prev === next ? prev : next))
  }, [searchParams])

  // Track the current user's role in the active org so we can gate the
  // Members + Trash tabs. Resolved from the MembersPanel fetch and cached
  // here so the gate updates the instant the panel loads.
  const [currentRole, setCurrentRole] = useState<'owner' | 'admin' | 'member' | null>(
    initialCurrentRole ?? null,
  )
  const canSeePrivilegedTabs = currentRole === 'owner' || currentRole === 'admin'
  const canPurge = currentRole === 'owner'
  const isOwner = currentRole === 'owner'
  // StrictMode-safe gate — when the server prefetch already resolved the
  // role we skip the mount fetch entirely. We never mutate the ref inside
  // the effect (the React 18 dev replay would defeat a "first run" flag).
  const hasFetchedRoleRef = useRef(initialCurrentRole !== undefined && initialCurrentRole !== null)
  // One-shot per-mount flag so the "kevittel/labels truncated at 1000"
  // toast doesn't fire on every refetch (tab switches, org switches).
  const cancelledKevittelWarningRef = useRef(false)
  const cancelledLabelsWarningRef = useRef(false)

  // Surface role even when the user hasn't opened the Members tab yet,
  // by hitting /api/org-members once on mount. Cheap call.
  useEffect(() => {
    if (hasFetchedRoleRef.current) return
    hasFetchedRoleRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/org-members')
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        // Validate the role string against the known enum so an
        // unexpected server response (rare, but defense in depth)
        // can't widen `canSeePrivilegedTabs` by sending an unknown
        // string that doesn't strictly equal 'member'.
        const role = data?.currentUserRole
        if (role === 'owner' || role === 'admin' || role === 'member') {
          setCurrentRole(role)
        }
      } catch {
        // ignore — tab gating just stays restrictive
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const changeTab = useCallback(
    (id: string) => {
      if (!isValidTab(id)) return
      setActiveTab(id)
      // Keep the URL in sync so reload / back works.
      const url = new URL(window.location.href)
      if (id === 'email') url.searchParams.delete('tab')
      else url.searchParams.set('tab', id)
      router.replace(url.pathname + (url.search || ''), { scroll: false })
    },
    [router],
  )
  
  // Email Configuration state. When the server provided initial data we
  // seed both the config and the form so the email-tab form is pre-filled
  // on first paint (no skeleton flash).
  const hasInitialEmailConfig = initialEmailConfig !== undefined
  const seededEmailConfig =
    initialEmailConfig && initialEmailConfig.configured !== false && initialEmailConfig.email
      ? initialEmailConfig
      : null
  const [loading, setLoading] = useState(!hasInitialEmailConfig)
  // `saving` is scoped to the Email tab (covers both Save and Send Test).
  // Cycle has its own `cycleSaving` — previously both tabs shared a
  // single flag, so saving Email + switching to Cycle (or vice versa)
  // briefly disabled the wrong form and showed "Saving..." on the
  // unrelated tab.
  const [saving, setSaving] = useState(false)
  const [cycleSaving, setCycleSaving] = useState(false)
  const [emailConfig, setEmailConfig] = useState<any>(seededEmailConfig)
  const [emailFormData, setEmailFormData] = useState({
    email: seededEmailConfig?.email || '',
    password: '',
    fromName: seededEmailConfig?.fromName || 'Kasa Family Management'
  })
  // Inline status messages were replaced with toast notifications.
  // This shim keeps the existing call-sites compiling while routing the
  // user-visible message through the global toast system.
  const setMessage = (msg: { type: 'success' | 'error'; text: string } | null) => {
    if (!msg) return
    if (msg.type === 'success') toast.success(msg.text)
    else toast.error(msg.text)
  }
  
  // Event Types state
  const hasInitialEventTypes = Array.isArray(initialEventTypes) && initialEventTypes.length > 0
  const seededEventTypes = hasInitialEventTypes
    ? [...(initialEventTypes as LifecycleEventType[])].sort((a, b) => a.name.localeCompare(b.name))
    : []
  const [eventTypes, setEventTypes] = useState<LifecycleEventType[]>(seededEventTypes)
  const [eventTypesLoading, setEventTypesLoading] = useState(!hasInitialEventTypes)
  const [showEventTypeModal, setShowEventTypeModal] = useState(false)
  const [editingEventType, setEditingEventType] = useState<LifecycleEventType | null>(null)
  const [eventTypeFormData, setEventTypeFormData] = useState({
    type: '',
    name: '',
    amount: ''
  })

  // Payment Plans state
  const hasInitialPaymentPlans = Array.isArray(initialPaymentPlans) && initialPaymentPlans.length > 0
  const [plans, setPlans] = useState<PaymentPlan[]>(initialPaymentPlans ?? [])
  const [plansLoading, setPlansLoading] = useState(!hasInitialPaymentPlans)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState<PaymentPlan | null>(null)
  // `yearlyPrice` is kept as the raw input string while the modal is
  // open so the user can naturally type "12.50" or pause on "12." —
  // parsing to a number on every keystroke turned "12." into 12 and
  // ate the decimal point. The numeric coercion happens at submit time
  // (see `handleSubmitPlan`).
  const [planFormData, setPlanFormData] = useState<{ name: string; yearlyPrice: string }>(
    { name: '', yearlyPrice: '0' },
  )

  // Centralized closers so Escape + backdrop dismiss + the explicit
  // Cancel button all do the same thing (reset form state, not just
  // hide the modal).
  const closeEventTypeModal = useCallback(() => {
    setShowEventTypeModal(false)
    resetEventTypeForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const closePlanModal = useCallback(() => {
    setShowPlanModal(false)
    setEditingPlan(null)
    resetPlanForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global Escape handler — closes whichever modal is open. Native
  // `<dialog>` would handle this for free, but these modals are
  // role="dialog" divs.
  useEffect(() => {
    if (!showEventTypeModal && !showPlanModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showEventTypeModal) closeEventTypeModal()
      else if (showPlanModal) closePlanModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showEventTypeModal, showPlanModal, closeEventTypeModal, closePlanModal])

  // Kevittel state
  const [kevittelFamilies, setKevittelFamilies] = useState<any[]>([])
  const [kevittelLoading, setKevittelLoading] = useState(true)

  // Cycle Configuration state
  const hasInitialCycleConfig = initialCycleConfig !== undefined
  const [cycleConfig, setCycleConfig] = useState<any>(initialCycleConfig ?? null)
  const [cycleLoading, setCycleLoading] = useState(!hasInitialCycleConfig)
  const [cycleFormData, setCycleFormData] = useState<{
    cycleCalendar: 'gregorian' | 'hebrew'
    cycleStartMonth: number
    cycleStartDay: number
    cycleStartHebrewMonth: number
    cycleStartHebrewDay: number
    cycleAutoRollover: boolean
    description: string
  }>({
    cycleCalendar:
      initialCycleConfig?.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
    cycleStartMonth: initialCycleConfig?.cycleStartMonth || 9,
    cycleStartDay: initialCycleConfig?.cycleStartDay || 1,
    cycleStartHebrewMonth: initialCycleConfig?.cycleStartHebrewMonth || 7, // Tishrei
    cycleStartHebrewDay: initialCycleConfig?.cycleStartHebrewDay || 1,
    cycleAutoRollover: Boolean(initialCycleConfig?.cycleAutoRollover),
    description: initialCycleConfig?.description || 'Membership cycle start date'
  })

  // Automation config (Bar Mitzvah auto-assign) state. Fetched lazily on
  // first tab open because the values are tiny and most users never visit
  // the tab.
  const [automationConfig, setAutomationConfig] = useState<{
    barMitzvahAutoAssignPlanId: string | null
    barMitzvahAutoCreateEventTypeId: string | null
    weddingConversionDefaultPlanId: string | null
    monthlyStatementAutoGenerate: boolean
    monthlyStatementAutoEmail: boolean
    monthlyStatementCalendar: 'gregorian' | 'hebrew'
    monthlyStatementDay: number
    monthlyStatementHebrewDay: number
  }>({
    barMitzvahAutoAssignPlanId: null,
    barMitzvahAutoCreateEventTypeId: null,
    weddingConversionDefaultPlanId: null,
    monthlyStatementAutoGenerate: false,
    monthlyStatementAutoEmail: false,
    monthlyStatementCalendar: 'gregorian',
    monthlyStatementDay: 1,
    monthlyStatementHebrewDay: 1,
  })
  const [automationLoading, setAutomationLoading] = useState(true)
  const [automationSaving, setAutomationSaving] = useState(false)

  // Letterhead state. All free-form string fields; the API normalizes
  // missing values to empty strings, so the form is always fully
  // controlled. We lazy-fetch on first visit to the Letterhead tab.
  const [letterhead, setLetterhead] = useState<typeof EMPTY_LETTERHEAD>(EMPTY_LETTERHEAD)
  const [letterheadLoading, setLetterheadLoading] = useState(true)
  const [letterheadSaving, setLetterheadSaving] = useState(false)

  // Mail Labels state. All client-side; the print path uses the loaded
  // families directly. We fetch families + plans lazily on first visit.
  const [labelFamilies, setLabelFamilies] = useState<any[]>([])
  const [labelsLoading, setLabelsLoading] = useState(true)
  const [labelFilters, setLabelFilters] = useState<{
    planIds: string[]
    balance: 'all' | 'negative'
    requireAddress: boolean
    search: string
  }>({
    planIds: [],
    balance: 'all',
    requireAddress: true,
    search: '',
  })

  // Activity (audit log) viewer state. Cursor-paginated read-only view
  // backed by GET /api/audit-log. We accumulate pages into `auditItems`
  // and keep the next cursor in `auditNextCursor`; passing `null` to
  // the fetcher resets to page 1.
  const [auditItems, setAuditItems] = useState<any[]>([])
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditActionFilter, setAuditActionFilter] = useState<string>('')
  const [auditUserFilter, setAuditUserFilter] = useState<string>('')
  const [auditResourceTypeFilter, setAuditResourceTypeFilter] = useState<string>('')
  const [auditFromDate, setAuditFromDate] = useState<string>('')
  const [auditToDate, setAuditToDate] = useState<string>('')
  const [auditUsersMap, setAuditUsersMap] = useState<Record<string, { name?: string; email?: string }>>({})

  // StrictMode-safe mount latch. Each ref starts as `true` for whichever
  // dataset the server provided so the corresponding fetch is skipped on
  // mount; refs we don't have data for stay `false` and fetch once.
  const hasFetchedEmailRef = useRef(hasInitialEmailConfig)
  const hasFetchedEventTypesRef = useRef(hasInitialEventTypes)
  const hasFetchedPlansRef = useRef(hasInitialPaymentPlans)
  const hasFetchedCycleRef = useRef(hasInitialCycleConfig)
  // `settingsFetchGenRef` is bumped EXACTLY ONCE per org change (see
  // `useOrgChanged` below). Every fetcher captures the current value
  // when it starts (`const gen = settingsFetchGenRef.current`) and
  // bails on completion if a later org change has invalidated it.
  //
  // Note the deliberate `read` (not `++`) at fetch-start: previously
  // each fetcher did `const gen = ++settingsFetchGenRef.current`, so
  // when org-change kicked off 5 fetches in parallel they each bumped
  // the counter and only the LAST one to start (max gen) survived the
  // post-await check — the other four bailed and left email/plans/
  // event-types/cycle showing the previous org's data. Reading without
  // mutating fixes that race: all five share the same gen and all five
  // commit, until the next org change bumps the counter and aborts any
  // still-in-flight requests.
  const settingsFetchGenRef = useRef(0)
  const [orgFetchEpoch, setOrgFetchEpoch] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!hasFetchedEmailRef.current) {
      hasFetchedEmailRef.current = true
      void fetchEmailConfig()
    }
    if (!hasFetchedEventTypesRef.current) {
      hasFetchedEventTypesRef.current = true
      void fetchEventTypes()
    }
    if (!hasFetchedPlansRef.current) {
      hasFetchedPlansRef.current = true
      void fetchPlans()
    }
    if (!hasFetchedCycleRef.current) {
      hasFetchedCycleRef.current = true
      void fetchCycleConfig()
    }
    // Kevittel is always fetched on mount — it's lazy in the active-tab
    // effect anyway, but keep this for back-compat (no server prefetch yet).
    void fetchKevittelData()
    return () => {
      cancelled = true
    }
    // Mount-only bootstrap; org switches refetch via useOrgChanged below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useOrgChanged(useCallback(() => {
    // Bump the shared fetch-generation ONCE — fetchers below capture the
    // post-bump value and bail if a *subsequent* org change invalidates
    // them. (Previously each fetcher also bumped the counter, which made
    // 4 of every 5 parallel fetches bail.)
    settingsFetchGenRef.current += 1
    hasFetchedEmailRef.current = false
    hasFetchedEventTypesRef.current = false
    hasFetchedPlansRef.current = false
    hasFetchedCycleRef.current = false
    hasFetchedAutomationRef.current = false
    hasFetchedLetterheadRef.current = false
    hasFetchedLabelsRef.current = false
    hasFetchedAuditRef.current = false
    // Reset role gating + force the /api/org-members refetch — without
    // this, tab gates (Members / Trash / Activity / privileged content)
    // reflect the PREVIOUS org's role until the user opens Members.
    hasFetchedRoleRef.current = false
    setCurrentRole(null)
    // Reset the "kevittel/labels was capped" warning so it can fire
    // again for the newly switched-in org if that org is also large.
    cancelledKevittelWarningRef.current = false
    cancelledLabelsWarningRef.current = false
    setEventTypes([])
    setPlans([])
    setCycleConfig(null)
    setKevittelFamilies([])
    setLabelFamilies([])
    setAuditItems([])
    setAuditNextCursor(null)
    setAuditUsersMap({})
    // Clear org-scoped form/config so the user can't briefly interact
    // with the previous org's email or letterhead/automation state.
    setEmailConfig(null)
    setEmailFormData({ email: '', password: '', fromName: 'Kasa Family Management' })
    setAutomationConfig({
      barMitzvahAutoAssignPlanId: null,
      barMitzvahAutoCreateEventTypeId: null,
      weddingConversionDefaultPlanId: null,
      monthlyStatementAutoGenerate: false,
      monthlyStatementAutoEmail: false,
      monthlyStatementCalendar: 'gregorian',
      monthlyStatementDay: 1,
      monthlyStatementHebrewDay: 1,
    })
    setLetterhead(EMPTY_LETTERHEAD)
    setLetterheadLoading(true)
    setAutomationLoading(true)
    setLabelsLoading(true)
    setOrgFetchEpoch((e) => e + 1)
    invalidateCache(/.*/)
    fetchEmailConfig()
    fetchEventTypes()
    fetchPlans()
    fetchCycleConfig()
    fetchKevittelData()
    // Refetch role separately — it's a tiny call and we want tab gates
    // updated before the user clicks anything.
    void (async () => {
      try {
        const res = await fetch('/api/org-members')
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const role = data?.currentUserRole
        if (role === 'owner' || role === 'admin' || role === 'member') {
          setCurrentRole(role)
        }
        hasFetchedRoleRef.current = true
      } catch {
        /* tab gating stays restrictive until next interaction */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []))

  // Refresh Kevittel data when switching to the Kevittel tab
  useEffect(() => {
    if (activeTab === 'kevittel' && !kevittelLoading) {
      fetchKevittelData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // Email Configuration functions
  const fetchEmailConfig = async () => {
    const gen = settingsFetchGenRef.current
    try {
      const res = await fetch('/api/email-config')
      if (gen !== settingsFetchGenRef.current) return
      if (res.ok) {
        const config = await res.json().catch(() => ({}))
        if (gen !== settingsFetchGenRef.current) return
        // The API returns 200 with `{ configured: false }` for orgs that
        // haven't set up email yet — normalize to null so existing UI
        // guards (`{emailConfig && ...}`) keep working.
        if (config?.configured === false || !config?.email) {
          setEmailConfig(null)
        } else {
          setEmailConfig(config)
          setEmailFormData({
            email: config.email || '',
            password: '',
            fromName: config.fromName || 'Kasa Family Management',
          })
        }
      } else {
        if (gen !== settingsFetchGenRef.current) return
        setEmailConfig(null)
        toast.error('Failed to load email configuration.')
      }
    } catch (error) {
      if (gen !== settingsFetchGenRef.current) return
      console.error('Error fetching email config:', error)
      toast.error('Failed to load email configuration.')
    } finally {
      // Only clear the skeleton if this fetch is still the latest. A
      // superseded fetch (org switched mid-flight) would otherwise
      // briefly hide the skeleton while the NEW fetch is still loading.
      if (gen === settingsFetchGenRef.current) setLoading(false)
    }
  }

  const handleSaveEmailConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    if (!emailFormData.email) {
      setMessage({ type: 'error', text: 'Email address is required' })
      setSaving(false)
      return
    }

    if (!emailConfig && !emailFormData.password) {
      setMessage({ type: 'error', text: 'Password is required for new email configuration' })
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailFormData)
      })

      const result = await res.json().catch(() => ({}))

      if (res.ok) {
        setEmailConfig(result)
        setEmailFormData(prev => ({ ...prev, password: '' }))
        setMessage({ 
          type: 'success', 
          text: emailConfig 
            ? 'Email configuration updated successfully!' 
            : 'Email configuration saved successfully!' 
        })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to save email configuration' })
      }
    } catch (error: any) {
      console.error('Error saving email config:', error)
      setMessage({ type: 'error', text: 'Error saving email configuration' })
    } finally {
      setSaving(false)
    }
  }

  const handleTestEmail = async () => {
    if (!emailConfig?.email) {
      setMessage({ type: 'error', text: 'Please save email configuration first' })
      return
    }

    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/email-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await res.json().catch(() => ({}))

      if (res.ok) {
        setMessage({ type: 'success', text: 'Test email sent successfully! Check your inbox.' })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to send test email' })
      }
    } catch (error: any) {
      console.error('Error sending test email:', error)
      setMessage({ type: 'error', text: 'Error sending test email' })
    } finally {
      setSaving(false)
    }
  }

  // Automation config functions (Bar Mitzvah auto-assign).
  // The lazy-load effect below this declaration triggers on first tab open.
  const hasFetchedAutomationRef = useRef(false)
  const fetchAutomationConfig = useCallback(async () => {
    const gen = settingsFetchGenRef.current
    try {
      setAutomationLoading(true)
      const res = await fetch('/api/organizations/automation')
      if (gen !== settingsFetchGenRef.current) return
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (gen !== settingsFetchGenRef.current) return
        setAutomationConfig({
          barMitzvahAutoAssignPlanId: data.barMitzvahAutoAssignPlanId ?? null,
          barMitzvahAutoCreateEventTypeId: data.barMitzvahAutoCreateEventTypeId ?? null,
          weddingConversionDefaultPlanId: data.weddingConversionDefaultPlanId ?? null,
          monthlyStatementAutoGenerate: !!data.monthlyStatementAutoGenerate,
          monthlyStatementAutoEmail: !!data.monthlyStatementAutoEmail,
          monthlyStatementCalendar:
            data.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
          monthlyStatementDay:
            typeof data.monthlyStatementDay === 'number' ? data.monthlyStatementDay : 1,
          monthlyStatementHebrewDay:
            typeof data.monthlyStatementHebrewDay === 'number'
              ? data.monthlyStatementHebrewDay
              : 1,
        })
      } else {
        if (gen !== settingsFetchGenRef.current) return
        toast.error('Failed to load automation settings.')
      }
    } catch (error) {
      if (gen !== settingsFetchGenRef.current) return
      console.error('Error fetching automation config:', error)
      toast.error('Failed to load automation settings.')
    } finally {
      if (gen === settingsFetchGenRef.current) setAutomationLoading(false)
    }
  }, [toast])

  const handleSaveAutomationConfig = async () => {
    setAutomationSaving(true)
    // Snapshot the current draft so we can roll the UI back to the
    // server's truth on failure. Previously a failed save left the
    // checkboxes/dropdowns showing the user's UNSAVED edits with no
    // indication they hadn't been persisted — refreshing the page would
    // silently revert them.
    const draftSnapshot = automationConfig
    try {
      const res = await fetch('/api/organizations/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barMitzvahAutoAssignPlanId: automationConfig.barMitzvahAutoAssignPlanId || null,
          barMitzvahAutoCreateEventTypeId:
            automationConfig.barMitzvahAutoCreateEventTypeId || null,
          weddingConversionDefaultPlanId:
            automationConfig.weddingConversionDefaultPlanId || null,
          monthlyStatementAutoGenerate: automationConfig.monthlyStatementAutoGenerate,
          monthlyStatementAutoEmail: automationConfig.monthlyStatementAutoEmail,
          monthlyStatementCalendar: automationConfig.monthlyStatementCalendar,
          monthlyStatementDay: automationConfig.monthlyStatementDay,
          monthlyStatementHebrewDay: automationConfig.monthlyStatementHebrewDay,
        }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setAutomationConfig({
          barMitzvahAutoAssignPlanId: data.barMitzvahAutoAssignPlanId ?? null,
          barMitzvahAutoCreateEventTypeId: data.barMitzvahAutoCreateEventTypeId ?? null,
          weddingConversionDefaultPlanId: data.weddingConversionDefaultPlanId ?? null,
          monthlyStatementAutoGenerate: !!data.monthlyStatementAutoGenerate,
          monthlyStatementAutoEmail: !!data.monthlyStatementAutoEmail,
          monthlyStatementCalendar:
            data.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
          monthlyStatementDay:
            typeof data.monthlyStatementDay === 'number' ? data.monthlyStatementDay : 1,
          monthlyStatementHebrewDay:
            typeof data.monthlyStatementHebrewDay === 'number'
              ? data.monthlyStatementHebrewDay
              : 1,
        })
        toast.success('Automation settings saved')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Failed to save automation settings')
        // Roll back to server truth so the user isn't left looking at
        // unsaved edits. Refetch in the background; falls back to the
        // pre-edit snapshot if the refetch also fails.
        try {
          await fetchAutomationConfig()
        } catch {
          setAutomationConfig(draftSnapshot)
        }
      }
    } catch (error) {
      console.error('Error saving automation config:', error)
      toast.error('Failed to save automation settings')
      // Network failure — roll back the same way.
      setAutomationConfig(draftSnapshot)
    } finally {
      setAutomationSaving(false)
    }
  }

  // Lazy-fetch the automation config the first time the user opens the
  // tab. Placed here so the `useCallback` above is in scope.
  useEffect(() => {
    if (activeTab !== 'automation') return
    if (hasFetchedAutomationRef.current) return
    hasFetchedAutomationRef.current = true
    let cancelled = false
    void fetchAutomationConfig().finally(() => {
      if (cancelled) hasFetchedAutomationRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchAutomationConfig, orgFetchEpoch])

  // ──────────────── Letterhead ────────────────
  const hasFetchedLetterheadRef = useRef(false)
  const fetchLetterhead = useCallback(async () => {
    const gen = settingsFetchGenRef.current
    try {
      setLetterheadLoading(true)
      const res = await fetch('/api/organizations/letterhead')
      if (gen !== settingsFetchGenRef.current) return
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        if (gen !== settingsFetchGenRef.current) return
        const payload = body?.data ?? body
        setLetterhead({ ...EMPTY_LETTERHEAD, ...(payload || {}) })
      } else {
        if (gen !== settingsFetchGenRef.current) return
        toast.error('Failed to load letterhead.')
      }
    } catch (error) {
      if (gen !== settingsFetchGenRef.current) return
      console.error('Error fetching letterhead:', error)
      toast.error('Failed to load letterhead.')
    } finally {
      if (gen === settingsFetchGenRef.current) setLetterheadLoading(false)
    }
  }, [toast])

  const handleSaveLetterhead = async (e: React.FormEvent) => {
    e.preventDefault()
    setLetterheadSaving(true)
    try {
      const res = await fetch('/api/organizations/letterhead', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(letterhead),
      })
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        const payload = body?.data ?? body
        setLetterhead({ ...EMPTY_LETTERHEAD, ...(payload || {}) })
        toast.success('Letterhead saved')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Failed to save letterhead')
      }
    } catch (error) {
      console.error('Error saving letterhead:', error)
      toast.error('Failed to save letterhead')
    } finally {
      setLetterheadSaving(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'letterhead') return
    if (hasFetchedLetterheadRef.current) return
    hasFetchedLetterheadRef.current = true
    let cancelled = false
    void fetchLetterhead().finally(() => {
      if (cancelled) hasFetchedLetterheadRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchLetterhead, orgFetchEpoch])

  // ──────────────── Mail Labels ────────────────
  // We pull the family list once on first visit. We deliberately reuse
  // the same /api/families endpoint Kevittel uses — the response already
  // includes balance + planId + the address fields we need.
  const hasFetchedLabelsRef = useRef(false)
  const fetchLabelData = useCallback(async () => {
    const gen = settingsFetchGenRef.current
    try {
      setLabelsLoading(true)
      // Make sure plans are loaded for the filter dropdown.
      if (plans.length === 0) await fetchPlans({ force: false })
      if (gen !== settingsFetchGenRef.current) return
      const res = await fetch('/api/families')
      if (gen !== settingsFetchGenRef.current) return
      if (res.ok) {
        const list = await res.json().catch(() => [])
        if (gen !== settingsFetchGenRef.current) return
        const items: any[] = Array.isArray(list)
          ? list
          : Array.isArray(list?.items)
            ? list.items
            : []
        setLabelFamilies(items)
        const LABELS_HARD_CAP = 1000
        if (
          items.length >= LABELS_HARD_CAP &&
          !cancelledLabelsWarningRef.current
        ) {
          cancelledLabelsWarningRef.current = true
          toast.error(
            `Showing the first ${LABELS_HARD_CAP.toLocaleString()} families. ` +
            `Filter by plan or print in batches to include the rest.`,
          )
        }
      } else {
        if (gen !== settingsFetchGenRef.current) return
        toast.error('Failed to load families for mail labels.')
      }
    } catch (error) {
      if (gen !== settingsFetchGenRef.current) return
      console.error('Error fetching label families:', error)
      toast.error('Failed to load families for mail labels.')
    } finally {
      if (gen === settingsFetchGenRef.current) setLabelsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast])

  useEffect(() => {
    if (activeTab !== 'labels') return
    if (hasFetchedLabelsRef.current) return
    hasFetchedLabelsRef.current = true
    let cancelled = false
    void fetchLabelData().finally(() => {
      if (cancelled) hasFetchedLabelsRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchLabelData, orgFetchEpoch])

  // ──────────────── Audit log (Activity tab) ────────────────
  const hasFetchedAuditRef = useRef(false)
  const fetchAuditPage = useCallback(
    async (cursor: string | null) => {
      const gen = settingsFetchGenRef.current
      try {
        setAuditLoading(true)
        const qs = new URLSearchParams()
        if (cursor) qs.set('cursor', cursor)
        if (auditActionFilter) qs.set('action', auditActionFilter)
        if (auditUserFilter) qs.set('userId', auditUserFilter)
        if (auditResourceTypeFilter) qs.set('resourceType', auditResourceTypeFilter)
        if (auditFromDate) qs.set('fromDate', auditFromDate)
        if (auditToDate) qs.set('toDate', auditToDate)
        qs.set('limit', '50')
        const res = await fetch(`/api/audit-log?${qs.toString()}`)
        if (gen !== settingsFetchGenRef.current) return
        if (!res.ok) {
          toast.error('Failed to load activity log')
          // Only clear rows on a FILTER change (cursor === null). For
          // "load more" we keep the existing rows so the user doesn't
          // lose their scroll position on a transient error.
          if (cursor === null) {
            setAuditItems([])
            setAuditNextCursor(null)
          }
          return
        }
        const data = await res.json().catch(() => ({}))
        if (gen !== settingsFetchGenRef.current) return
        const items = Array.isArray(data?.items) ? data.items : []
        setAuditItems((prev) => (cursor ? [...prev, ...items] : items))
        setAuditNextCursor(data?.nextCursor || null)
      } catch (error) {
        if (gen !== settingsFetchGenRef.current) return
        console.error('Error loading audit log:', error)
        toast.error('Failed to load activity log')
      } finally {
        if (gen === settingsFetchGenRef.current) setAuditLoading(false)
      }
    },
    [auditActionFilter, auditUserFilter, auditResourceTypeFilter, auditFromDate, auditToDate, toast],
  )

  // Resolve user ids in the visible audit page to display names. Fetched
  // once per visit; cheap-ish because most orgs have <50 members.
  const fetchAuditUsers = useCallback(async () => {
    const gen = settingsFetchGenRef.current
    try {
      const res = await fetch('/api/org-members')
      if (gen !== settingsFetchGenRef.current) return
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      if (gen !== settingsFetchGenRef.current) return
      const members: any[] = Array.isArray(data?.members) ? data.members : []
      const map: Record<string, { name?: string; email?: string }> = {}
      for (const m of members) {
        if (m?.userId) map[String(m.userId)] = { name: m.name, email: m.email }
      }
      setAuditUsersMap(map)
    } catch {
      // best-effort; the UI falls back to raw user ids
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'activity') return
    if (hasFetchedAuditRef.current) return
    hasFetchedAuditRef.current = true
    let cancelled = false
    void fetchAuditPage(null)
    void fetchAuditUsers()
    return () => {
      cancelled = true
      if (cancelled) hasFetchedAuditRef.current = false
    }
  }, [activeTab, fetchAuditPage, fetchAuditUsers])

  // Re-fetch when filters change (only after the first visit).
  useEffect(() => {
    if (activeTab !== 'activity') return
    if (!hasFetchedAuditRef.current) return
    setAuditNextCursor(null)
    fetchAuditPage(null)
    // We intentionally exclude fetchAuditPage to avoid double-fires when
    // the callback identity changes alongside the filter values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditActionFilter, auditUserFilter, auditResourceTypeFilter, auditFromDate, auditToDate])

  const exportAuditCsv = useCallback(() => {
    const qs = new URLSearchParams()
    if (auditActionFilter) qs.set('action', auditActionFilter)
    if (auditUserFilter) qs.set('userId', auditUserFilter)
    if (auditResourceTypeFilter) qs.set('resourceType', auditResourceTypeFilter)
    if (auditFromDate) qs.set('fromDate', auditFromDate)
    if (auditToDate) qs.set('toDate', auditToDate)
    qs.set('format', 'csv')
    // Trigger a native download — the server returns the right
    // Content-Disposition for the browser to save the file.
    window.location.href = `/api/audit-log?${qs.toString()}`
  }, [auditActionFilter, auditUserFilter, auditResourceTypeFilter, auditFromDate, auditToDate])

  // Cycle Configuration functions
  const fetchCycleConfig = async () => {
    const gen = settingsFetchGenRef.current
    try {
      setCycleLoading(true)
      const res = await fetch('/api/cycle-config')
      if (gen !== settingsFetchGenRef.current) return
      if (res.ok) {
        const config = await res.json().catch(() => ({}))
        if (gen !== settingsFetchGenRef.current) return
        setCycleConfig(config)
        setCycleFormData({
          cycleCalendar: config.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
          cycleStartMonth: config.cycleStartMonth || 9,
          cycleStartDay: config.cycleStartDay || 1,
          cycleStartHebrewMonth: config.cycleStartHebrewMonth || 7,
          cycleStartHebrewDay: config.cycleStartHebrewDay || 1,
          cycleAutoRollover: Boolean(config.cycleAutoRollover),
          description: config.description || 'Membership cycle start date'
        })
      } else {
        if (gen !== settingsFetchGenRef.current) return
        setCycleConfig(null)
      }
    } catch (error) {
      if (gen !== settingsFetchGenRef.current) return
      console.error('Error fetching cycle config:', error)
      setCycleConfig(null)
    } finally {
      if (gen === settingsFetchGenRef.current) setCycleLoading(false)
    }
  }

  const handleSaveCycleConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setCycleSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/cycle-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cycleFormData)
      })

      const result = await res.json().catch(() => ({}))

      if (res.ok) {
        // Mirror the server's normalized response into both the
        // canonical config AND the form draft, so any server-side
        // clamps/normalizations (e.g. day clamped to month length) show
        // up immediately in the form instead of disagreeing with the
        // success banner.
        setCycleConfig(result)
        if (result && typeof result === 'object') {
          setCycleFormData((prev) => ({ ...prev, ...result }))
        }
        setMessage({ 
          type: 'success', 
          text: cycleConfig 
            ? 'Cycle configuration updated successfully!' 
            : 'Cycle configuration saved successfully!' 
        })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to save cycle configuration' })
      }
    } catch (error: any) {
      console.error('Error saving cycle config:', error)
      setMessage({ type: 'error', text: 'Error saving cycle configuration' })
    } finally {
      setCycleSaving(false)
    }
  }

  // Event Types functions
  const fetchEventTypes = async () => {
    const gen = settingsFetchGenRef.current
    try {
      const res = await fetch('/api/lifecycle-event-types')
      if (gen !== settingsFetchGenRef.current) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => [])
      if (gen !== settingsFetchGenRef.current) return
      if (Array.isArray(data)) {
        // Copy before sort — `.sort()` mutates the source array, and
        // the fetch response is sometimes a shared reference (cached
        // body, console-cached JSON, etc.).
        const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name))
        setEventTypes(sorted)
      } else {
        setEventTypes([])
      }
    } catch (error) {
      if (gen !== settingsFetchGenRef.current) return
      console.error('Error fetching event types:', error)
      toast.error('Failed to load event types.')
      setEventTypes([])
    } finally {
      if (gen === settingsFetchGenRef.current) setEventTypesLoading(false)
    }
  }

  const resetEventTypeForm = () => {
    setEventTypeFormData({
      type: '',
      name: '',
      amount: ''
    })
    setEditingEventType(null)
  }

  const handleEditEventType = (eventType: LifecycleEventType) => {
    setEditingEventType(eventType)
    setEventTypeFormData({
      type: eventType.type,
      name: eventType.name,
      amount: eventType.amount.toString()
    })
    setShowEventTypeModal(true)
  }

  const handleDeleteEventType = async (id: string) => {
    if (
      !(await confirm({
        message: 'Are you sure you want to delete this event type?',
        destructive: true,
        confirmLabel: 'Delete',
      }))
    ) {
      return
    }

    try {
      const res = await fetch(`/api/lifecycle-event-types/${id}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        setMessage({ type: 'success', text: 'Event type deleted successfully!' })
        fetchEventTypes()
      } else {
        const error = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: error.error || 'Failed to delete event type' })
      }
    } catch (error) {
      console.error('Error deleting event type:', error)
      setMessage({ type: 'error', text: 'Failed to delete event type' })
    }
  }

  const eventTypeSubmittingRef = useRef(false)
  const handleSubmitEventType = async (e: React.FormEvent) => {
    e.preventDefault()
    // Re-entrancy guard. The submit button isn't disabled while the
    // network call is in flight, so a fast double-click would otherwise
    // fire two POST/PUTs and create duplicate event types.
    if (eventTypeSubmittingRef.current) return
    const parsedAmount = parseFloat(String(eventTypeFormData.amount))
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      toast.error('Enter a valid non-negative amount')
      return
    }
    eventTypeSubmittingRef.current = true
    try {
      const url = editingEventType
        ? `/api/lifecycle-event-types/${editingEventType._id}`
        : '/api/lifecycle-event-types'
      
      const method = editingEventType ? 'PUT' : 'POST'
      
      const body = editingEventType
        ? { name: eventTypeFormData.name, amount: parsedAmount }
        : { type: eventTypeFormData.type, name: eventTypeFormData.name, amount: parsedAmount }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

      if (res.ok) {
        setShowEventTypeModal(false)
        resetEventTypeForm()
        setMessage({ 
          type: 'success', 
          text: editingEventType ? 'Event type updated successfully!' : 'Event type created successfully!' 
        })
        fetchEventTypes()
      } else {
        const error = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: error.error || 'Failed to save event type' })
      }
    } catch (error) {
      console.error('Error saving event type:', error)
      setMessage({ type: 'error', text: 'Failed to save event type' })
    } finally {
      eventTypeSubmittingRef.current = false
    }
  }

  // Payment Plans functions
  const fetchPlans = async (opts?: { force?: boolean }) => {
    const gen = settingsFetchGenRef.current
    try {
      // Server returns Cache-Control: max-age=60; bypass it on post-mutation
      // refetches so we always see the latest.
      const res = await fetch('/api/payment-plans', opts?.force ? { cache: 'no-store' } : {})
      if (gen !== settingsFetchGenRef.current) return
      const data = await res.json().catch(() => null)
      if (gen !== settingsFetchGenRef.current) return
      if (res.ok && Array.isArray(data)) {
        setPlans(data)
      } else {
        // Transient failure: surface to the user but DON'T blow away the
        // currently-rendered plans. Previously this cleared the table on
        // any non-OK response — e.g. a 502 from the CDN — leaving an
        // empty UI with no toast.
        console.error('Failed to fetch payment plans:', res.status, data)
        toast.error('Could not reload payment plans.')
      }
    } catch (error) {
      if (gen !== settingsFetchGenRef.current) return
      console.error('Error fetching payment plans:', error)
      toast.error('Could not reload payment plans.')
    } finally {
      if (gen === settingsFetchGenRef.current) setPlansLoading(false)
    }
  }

  const planSubmittingRef = useRef(false)
  const handleSubmitPlan = async (e: React.FormEvent) => {
    e.preventDefault()
    // Re-entrancy guard — see `handleSubmitEventType` for rationale.
    if (planSubmittingRef.current) return
    const yearlyPrice = Number(planFormData.yearlyPrice)
    if (!Number.isFinite(yearlyPrice) || yearlyPrice < 0) {
      toast.error('Enter a valid non-negative yearly price')
      return
    }
    planSubmittingRef.current = true
    try {
      const url = editingPlan 
        ? `/api/payment-plans/${editingPlan._id}`
        : '/api/payment-plans'
      
      const method = editingPlan ? 'PUT' : 'POST'
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...planFormData, yearlyPrice }),
      })

      if (res.ok) {
        setShowPlanModal(false)
        setEditingPlan(null)
        resetPlanForm()
        invalidateCache('/api/payment-plans')
        fetchPlans({ force: true })
        setMessage({ type: 'success', text: editingPlan ? 'Payment plan updated successfully!' : 'Payment plan created successfully!' })
      } else {
        const error = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: error.error || 'Failed to save payment plan' })
      }
    } catch (error) {
      console.error('Error saving payment plan:', error)
      setMessage({ type: 'error', text: 'Failed to save payment plan' })
    } finally {
      planSubmittingRef.current = false
    }
  }

  const handleEditPlan = (plan: PaymentPlan) => {
    setEditingPlan(plan)
    setPlanFormData({
      name: plan.name,
      yearlyPrice: String(plan.yearlyPrice ?? 0),
    })
    setShowPlanModal(true)
  }

  const handleDeletePlan = async (id: string) => {
    if (
      !(await confirm({
        message: 'Are you sure you want to delete this payment plan?',
        destructive: true,
        confirmLabel: 'Delete',
      }))
    )
      return

    try {
      const res = await fetch(`/api/payment-plans/${id}`, { method: 'DELETE' })
      if (res.ok) {
        invalidateCache('/api/payment-plans')
        fetchPlans({ force: true })
        setMessage({ type: 'success', text: 'Payment plan deleted successfully!' })
      } else {
        const error = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: error.error || 'Failed to delete payment plan' })
      }
    } catch (error) {
      console.error('Error deleting payment plan:', error)
      setMessage({ type: 'error', text: 'Failed to delete payment plan' })
    }
  }

  const resetPlanForm = () => {
    setPlanFormData({
      name: '',
      yearlyPrice: '0',
    })
  }


  // Kevittel functions
  const fetchKevittelData = async () => {
    const gen = settingsFetchGenRef.current
    try {
      // Fetch all families
      const familiesRes = await fetch('/api/families')
      if (gen !== settingsFetchGenRef.current) return
      if (!familiesRes.ok) {
        console.error('Failed to fetch families:', familiesRes.status)
        setKevittelFamilies([])
        // Don't clear loading here — the `finally` below does it with
        // the gen-guard so a superseded fetch doesn't unhide the
        // skeleton for the in-flight successor.
        return
      }
      
      const familiesPayload = await familiesRes.json().catch(() => null)
      if (gen !== settingsFetchGenRef.current) return

      // `/api/families` returns either a flat array (legacy mode) or
      // `{ items, nextCursor }` when `?limit=` is passed. Defend against
      // both shapes plus the error-object shape (e.g. `{ error: '...' }`)
      // that earlier slipped through and crashed `.map` at runtime.
      const families: any[] = Array.isArray(familiesPayload)
        ? familiesPayload
        : Array.isArray(familiesPayload?.items)
          ? familiesPayload.items
          : []

      // The list endpoint caps unbounded responses at 1000 rows. For
      // very large orgs the print/PDF would silently drop the rest —
      // surface that to the user so they know the kevittel they're
      // about to print is incomplete.
      const KEVITTEL_HARD_CAP = 1000
      if (
        families.length >= KEVITTEL_HARD_CAP &&
        !cancelledKevittelWarningRef.current
      ) {
        cancelledKevittelWarningRef.current = true
        toast.error(
          `Showing the first ${KEVITTEL_HARD_CAP.toLocaleString()} families. ` +
          `Use search or print sections separately to include the rest.`,
        )
      }

      // Fetch members for each family and sort by age.
      const familiesWithMembers = await Promise.all(
        families.map(async (family: any) => {
          try {
            const membersRes = await fetch(`/api/families/${family._id}/members`)
            if (!membersRes.ok) {
              return { ...family, members: [] }
            }

            const members = await membersRes.json().catch(() => [])

            // Sort children by birthDate (oldest first).
            const sortedChildren = members
              .filter((member: any) => member.birthDate)
              .sort((a: any, b: any) => {
                const dateA = isFiniteDate(a.birthDate) ? new Date(a.birthDate).getTime() : Infinity
                const dateB = isFiniteDate(b.birthDate) ? new Date(b.birthDate).getTime() : Infinity
                return dateA - dateB
              })

            return { ...family, members: sortedChildren }
          } catch (error) {
            console.error(`Error fetching members for family ${family._id}:`, error)
            return { ...family, members: [] }
          }
        })
      )

      if (gen !== settingsFetchGenRef.current) return
      setKevittelFamilies(familiesWithMembers)
    } catch (error) {
      console.error('Error fetching kevittel data:', error)
      if (gen !== settingsFetchGenRef.current) return
      setKevittelFamilies([])
    } finally {
      if (gen === settingsFetchGenRef.current) setKevittelLoading(false)
    }
  }

  // Per-tab loading: render the page immediately and let each tab
  // show its own skeleton (defined inline below) so users can navigate
  // between tabs without waiting for every fetch to settle.
  const isTabLoading =
    (activeTab === 'email' && loading) ||
    (activeTab === 'eventTypes' && eventTypesLoading) ||
    (activeTab === 'paymentPlans' && plansLoading) ||
    (activeTab === 'automation' && automationLoading) ||
    (activeTab === 'kevittel' && kevittelLoading) ||
    (activeTab === 'cycle' && cycleLoading) ||
    (activeTab === 'letterhead' && letterheadLoading) ||
    (activeTab === 'labels' && labelsLoading) ||
    (activeTab === 'activity' && auditLoading && auditItems.length === 0)

  return (
    <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app-subtle">
      <div className="max-w-6xl mx-auto">
        <PageHeader title="Settings" subtitle="Manage your system configuration." />

        {/* Tabs */}
        <div className="bg-surface rounded-2xl shadow border border-border mb-6 p-2 sm:p-3">
          <Tabs
            label="Settings sections"
            activeId={activeTab}
            onChange={changeTab}
            items={[
              {
                id: 'email',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <EnvelopeIcon className="h-4 w-4" aria-hidden="true" /> Email
                  </span>
                ),
              },
              {
                id: 'eventTypes',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" aria-hidden="true" /> Event Types
                  </span>
                ),
              },
              {
                id: 'paymentPlans',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <CreditCardIcon className="h-4 w-4" aria-hidden="true" /> Payment Plans
                  </span>
                ),
              },
              {
                id: 'automation',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" aria-hidden="true" /> Automation
                  </span>
                ),
              },
              {
                id: 'kevittel',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <UserGroupIcon className="h-4 w-4" aria-hidden="true" /> Kevittel
                  </span>
                ),
              },
              {
                id: 'cycle',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" aria-hidden="true" /> Cycle
                  </span>
                ),
              },
              {
                id: 'branding',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <PhotoIcon className="h-4 w-4" aria-hidden="true" /> Branding
                  </span>
                ),
              },
              {
                id: 'labels',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <TagIcon className="h-4 w-4" aria-hidden="true" /> Mail Labels
                  </span>
                ),
              },
              {
                id: 'localization',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <GlobeAltIcon className="h-4 w-4" aria-hidden="true" /> Localization
                  </span>
                ),
              },
              // Letterhead + Activity (audit log) are admin/owner-only.
              // Members and Trash are also admin/owner-only. We hide the
              // tabs entirely for plain members so the UI doesn't tease
              // at gated functionality.
              ...(canSeePrivilegedTabs
                ? [
                    {
                      id: 'letterhead' as const,
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <IdentificationIcon className="h-4 w-4" aria-hidden="true" /> Letterhead
                        </span>
                      ),
                    },
                    {
                      id: 'activity' as const,
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <ClockIcon className="h-4 w-4" aria-hidden="true" /> Activity
                        </span>
                      ),
                    },
                    {
                      id: 'members' as const,
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <UserGroupIcon className="h-4 w-4" aria-hidden="true" /> Members
                        </span>
                      ),
                    },
                    {
                      id: 'billing' as const,
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <CreditCardIcon className="h-4 w-4" aria-hidden="true" /> Billing
                        </span>
                      ),
                    },
                    {
                      id: 'trash' as const,
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <TrashIcon className="h-4 w-4" aria-hidden="true" /> Recycle bin
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>

        {/* Per-tab skeleton while the relevant fetch is in flight. */}
        {isTabLoading && (
          <div className="bg-surface rounded-lg shadow p-6 mb-6">
            <SkeletonRows count={5} />
          </div>
        )}

        {/* Email Configuration Tab */}
        {activeTab === 'email' && !isTabLoading && (
          <div className="bg-surface rounded-lg shadow-lg p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <EnvelopeIcon className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-fg">Email Configuration</h2>
                <p className="text-sm text-fg-muted">Configure Gmail settings for sending statements</p>
              </div>
            </div>

            {emailConfig && (
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800">
                  <strong>✓ Email configuration is active:</strong> {emailConfig.email}
                </p>
                <p className="text-xs text-green-700 mt-1">
                  Your email settings are saved and will be used automatically for sending statements.
                </p>
              </div>
            )}

            <form onSubmit={handleSaveEmailConfig} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-fg">
                  Gmail Address *
                </label>
                <input
                  type="email"
                  required
                  value={emailFormData.email}
                  onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
                  placeholder="your-email@gmail.com"
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p className="text-xs text-fg-muted mt-1">
                  Gmail account to send statements from
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-fg">
                  Gmail App Password {emailConfig ? '(leave empty to keep current)' : '*'}
                </label>
                <input
                  type="password"
                  required={!emailConfig}
                  value={emailFormData.password}
                  onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
                  placeholder={emailConfig ? "Leave empty to keep current password" : "16-character app password"}
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p className="text-xs text-fg-muted mt-1">
                  Generate an app password from{' '}
                  <a 
                    href="https://myaccount.google.com/apppasswords" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-accent underline hover:text-accent-hover"
                  >
                    Google Account Settings
                  </a>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-fg">
                  From Name
                </label>
                <input
                  type="text"
                  value={emailFormData.fromName}
                  onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
                  placeholder="Kasa Family Management"
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p className="text-xs text-fg-muted mt-1">
                  Display name shown in sent emails
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="focus-ring bg-accent text-accent-fg px-4 py-2 rounded-md flex items-center gap-2 hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  <EnvelopeIcon className="h-4 w-4" />
                  {saving ? 'Saving...' : emailConfig ? 'Update Configuration' : 'Save Configuration'}
                </button>

                {emailConfig && (
                  <button
                    type="button"
                    onClick={handleTestEmail}
                    disabled={saving}
                    className="focus-ring border border-border bg-surface text-fg px-4 py-2 rounded-md flex items-center gap-2 hover:bg-fg/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    <EnvelopeIcon className="h-4 w-4" />
                    Send Test Email
                  </button>
                )}
              </div>
            </form>

            {emailConfig && (
              <div className="mt-6 p-4 bg-accent/10 border border-accent/20 rounded-lg">
                <h3 className="font-semibold text-fg mb-2">How It Works</h3>
                <ul className="text-sm text-accent-hover space-y-1 list-disc list-inside">
                  <li>Email configuration is stored securely in the database</li>
                  <li>Saved settings are used automatically for all statement emails</li>
                  <li>Opt in to monthly auto-send from the Automation tab to email statements on the 1st of each month</li>
                  <li>You can send individual statements from the Statements page or Family detail page</li>
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Event Types Tab */}
        {activeTab === 'eventTypes' && !isTabLoading && (
          <div className="bg-surface rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                  <CalendarIcon className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-fg">Lifecycle Event Types</h2>
                  <p className="text-sm text-fg-muted">Manage event types and their default amounts</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    resetEventTypeForm()
                    setShowEventTypeModal(true)
                  }}
                  className="bg-accent text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-accent-hover transition-colors"
                >
                  <PlusIcon className="h-5 w-5" />
                  Add Event Type
                </button>
              </div>
            </div>

            <EventTypesTable
              eventTypes={eventTypes}
              onEdit={handleEditEventType}
              onDelete={handleDeleteEventType}
              tableId="settings-event-types"
              emptyCta={
                eventTypes.length === 0
                  ? {
                      label: 'Add event type',
                      onClick: () => {
                        resetEventTypeForm()
                        setShowEventTypeModal(true)
                      },
                    }
                  : undefined
              }
            />
            {eventTypes.length > 0 && (
              <div className="mt-3 flex justify-end text-sm">
                <span className="text-fg-muted">
                  Total ({eventTypes.length} event types):{' '}
                  <span className="font-bold text-fg tabular">
                    {formatMoney(
                      eventTypes.reduce((sum, e) => {
                        const n = Number(e.amount)
                        return sum + (Number.isFinite(n) ? n : 0)
                      }, 0),
                    )}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Payment Plans Tab */}
        {activeTab === 'paymentPlans' && !isTabLoading && (
          <div className="bg-surface rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <CreditCardIcon className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-fg">Payment Plans</h2>
                  <p className="text-sm text-fg-muted">Manage payment plans and view families using each plan</p>
                </div>
              </div>
              <button
                onClick={() => {
                  resetPlanForm()
                  setEditingPlan(null)
                  setShowPlanModal(true)
                }}
                className="focus-ring bg-accent text-accent-fg px-4 py-2 rounded-md flex items-center gap-2 hover:bg-accent-hover transition-colors text-sm font-medium"
              >
                <PlusIcon className="h-4 w-4" />
                Add Payment Plan
              </button>
            </div>

            <PaymentPlansTable
              plans={plans}
              onEdit={handleEditPlan}
              onDelete={handleDeletePlan}
              tableId="settings-payment-plans"
            />
          </div>
        )}

        {/* Event Type Modal */}
        {showEventTypeModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            // Clicking the dimmed backdrop closes the modal. Inner
            // `stopPropagation` on the dialog box prevents clicks inside
            // form fields from also closing it.
            onClick={(e) => {
              if (e.target === e.currentTarget) closeEventTypeModal()
            }}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="bg-surface rounded-lg shadow-xl p-8 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold mb-4">
                {editingEventType ? 'Edit' : 'Add'} Event Type
              </h2>
              <form onSubmit={handleSubmitEventType} className="space-y-4">
                {!editingEventType && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Type Code *</label>
                    <input
                      type="text"
                      value={eventTypeFormData.type}
                      onChange={(e) => setEventTypeFormData({ ...eventTypeFormData, type: e.target.value })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="e.g., wedding, graduation"
                      required
                    />
                    <p className="text-xs text-fg-muted mt-1">
                      Unique identifier (lowercase, use underscores)
                    </p>
                  </div>
                )}
                {editingEventType && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Type Code</label>
                    <input
                      type="text"
                      value={eventTypeFormData.type}
                      className="w-full border rounded px-3 py-2 bg-fg/5"
                      disabled
                    />
                    <p className="text-xs text-fg-muted mt-1">
                      Type code cannot be changed after creation
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input
                    type="text"
                    value={eventTypeFormData.name}
                    onChange={(e) => setEventTypeFormData({ ...eventTypeFormData, name: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="e.g., Chasena, Bar Mitzvah"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Amount ({currencySymbol}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={eventTypeFormData.amount}
                    onChange={(e) => setEventTypeFormData({ ...eventTypeFormData, amount: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-accent text-white px-4 py-2 rounded-lg hover:bg-accent-hover"
                  >
                    {editingEventType ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEventTypeModal(false)
                      resetEventTypeForm()
                    }}
                    className="flex-1 bg-fg/10 text-fg px-4 py-2 rounded-lg hover:bg-fg/10"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Automation Tab */}
        {activeTab === 'automation' && !isTabLoading && (
          <div className="bg-surface rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                <CalendarIcon className="h-6 w-6 text-accent" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-fg">Automation</h2>
                <p className="text-sm text-fg-muted">
                  Optional rules that fire automatically when member data changes.
                </p>
              </div>
            </div>

            <div className="space-y-5 max-w-2xl">
              <div className="border border-border rounded-lg p-5">
                <h3 className="text-lg font-semibold text-fg mb-1">Bar Mitzvah</h3>
                <p className="text-sm text-fg-muted mb-5">
                  When a male member reaches Bar Mitzvah age (Hebrew calendar), the
                  actions below trigger automatically. Each rule is independent — leave
                  a dropdown blank to skip that action.
                </p>

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="auto-assign-plan"
                      className="block text-sm font-medium text-fg mb-1"
                    >
                      Auto-assign payment plan
                    </label>
                    <select
                      id="auto-assign-plan"
                      value={automationConfig.barMitzvahAutoAssignPlanId || ''}
                      onChange={(e) =>
                        setAutomationConfig((c) => ({
                          ...c,
                          barMitzvahAutoAssignPlanId: e.target.value || null,
                        }))
                      }
                      className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                    >
                      <option value="">— Do not auto-assign —</option>
                      {plans.map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.name} ({formatMoney(p.yearlyPrice)}/yr)
                        </option>
                      ))}
                    </select>
                    {plans.length === 0 && (
                      <p className="text-xs text-fg-muted mt-1">
                        No payment plans configured yet. Add one in the Payment Plans
                        tab first.
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="auto-create-event"
                      className="block text-sm font-medium text-fg mb-1"
                    >
                      Auto-create lifecycle event
                    </label>
                    <select
                      id="auto-create-event"
                      value={automationConfig.barMitzvahAutoCreateEventTypeId || ''}
                      onChange={(e) =>
                        setAutomationConfig((c) => ({
                          ...c,
                          barMitzvahAutoCreateEventTypeId: e.target.value || null,
                        }))
                      }
                      className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                    >
                      <option value="">— Do not auto-create —</option>
                      {eventTypes.map((ev) => (
                        <option key={ev._id} value={ev._id}>
                          {ev.name} ({formatMoney(ev.amount)})
                        </option>
                      ))}
                    </select>
                    {eventTypes.length === 0 && (
                      <p className="text-xs text-fg-muted mt-1">
                        No event types configured yet. Add one in the Event Types tab
                        first.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="border border-border rounded-lg p-5">
                <h3 className="text-lg font-semibold text-fg mb-1">Monthly statements</h3>
                <p className="text-sm text-fg-muted mb-5">
                  Run the &ldquo;Generate Monthly Batch&rdquo; and email steps
                  automatically every month for the previous month&rsquo;s period.
                  Both toggles are independent — turn on only generation, only
                  email, or both. The email step requires a saved Gmail
                  configuration in the Email tab, and skips any family marked
                  &ldquo;Opt out of bulk statement emails&rdquo; on the family form.
                </p>

                <div className="space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={automationConfig.monthlyStatementAutoGenerate}
                      onChange={(e) =>
                        setAutomationConfig((c) => ({
                          ...c,
                          monthlyStatementAutoGenerate: e.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 accent-accent"
                    />
                    <span className="text-sm">
                      <span className="block font-medium text-fg">
                        Auto-generate monthly statements
                      </span>
                      <span className="block text-fg-muted">
                        Equivalent to clicking &ldquo;Generate Monthly Batch&rdquo;
                        every month for last month&rsquo;s period.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={automationConfig.monthlyStatementAutoEmail}
                      onChange={(e) =>
                        setAutomationConfig((c) => ({
                          ...c,
                          monthlyStatementAutoEmail: e.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 accent-accent"
                    />
                    <span className="text-sm">
                      <span className="block font-medium text-fg">
                        Auto-email monthly statements
                      </span>
                      <span className="block text-fg-muted">
                        Sends a PDF statement to every family with an email address
                        on file (and not opted out). Requires email configuration
                        in the Email tab.
                      </span>
                      {automationConfig.monthlyStatementAutoEmail && !emailConfig?.email && (
                        <span className="mt-2 inline-block text-xs text-yellow-700 dark:text-yellow-400">
                          No email configuration found yet — set one up in the Email
                          tab or the cron will fail for this org.
                        </span>
                      )}
                    </span>
                  </label>

                  <div className="pt-2 border-t border-border space-y-3">
                    <div>
                      <span className="block text-sm font-medium text-fg mb-2">
                        Schedule by
                      </span>
                      <div
                        role="radiogroup"
                        aria-label="Schedule calendar"
                        className="inline-flex rounded-md border border-border overflow-hidden"
                      >
                        {(['gregorian', 'hebrew'] as const).map((cal) => {
                          const active = automationConfig.monthlyStatementCalendar === cal
                          const disabled =
                            !automationConfig.monthlyStatementAutoGenerate &&
                            !automationConfig.monthlyStatementAutoEmail
                          return (
                            <button
                              key={cal}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={disabled}
                              onClick={() =>
                                setAutomationConfig((c) => ({
                                  ...c,
                                  monthlyStatementCalendar: cal,
                                }))
                              }
                              className={`focus-ring px-3 py-1.5 text-sm transition-colors ${
                                active
                                  ? 'bg-accent text-accent-fg'
                                  : 'bg-surface text-fg hover:bg-fg/5'
                              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {cal === 'gregorian' ? 'Gregorian calendar' : 'Hebrew calendar'}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {automationConfig.monthlyStatementCalendar === 'gregorian' ? (
                      <div>
                        <label
                          htmlFor="monthly-statement-day"
                          className="block text-sm font-medium text-fg mb-1"
                        >
                          Day of the Gregorian month to run
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="monthly-statement-day"
                            type="number"
                            min={1}
                            max={31}
                            value={automationConfig.monthlyStatementDay}
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10)
                              const clamped = Number.isFinite(raw)
                                ? Math.max(1, Math.min(31, raw))
                                : 1
                              setAutomationConfig((c) => ({
                                ...c,
                                monthlyStatementDay: clamped,
                              }))
                            }}
                            disabled={
                              !automationConfig.monthlyStatementAutoGenerate &&
                              !automationConfig.monthlyStatementAutoEmail
                            }
                            className="focus-ring w-24 bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none disabled:opacity-50"
                          />
                          <span className="text-sm text-fg-muted">of every Gregorian month</span>
                        </div>
                        <p className="text-xs text-fg-muted mt-2">
                          Generate runs at 2 AM UTC, email runs at 3 AM UTC. If the
                          month is shorter than this day (e.g. you pick 31 but it&rsquo;s
                          February), the job runs on the last day of that month so it
                          never gets skipped.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <label
                          htmlFor="monthly-statement-hebrew-day"
                          className="block text-sm font-medium text-fg mb-1"
                        >
                          Day of the Hebrew month to run
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="monthly-statement-hebrew-day"
                            type="number"
                            min={1}
                            max={30}
                            value={automationConfig.monthlyStatementHebrewDay}
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10)
                              const clamped = Number.isFinite(raw)
                                ? Math.max(1, Math.min(30, raw))
                                : 1
                              setAutomationConfig((c) => ({
                                ...c,
                                monthlyStatementHebrewDay: clamped,
                              }))
                            }}
                            disabled={
                              !automationConfig.monthlyStatementAutoGenerate &&
                              !automationConfig.monthlyStatementAutoEmail
                            }
                            className="focus-ring w-24 bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none disabled:opacity-50"
                          />
                          <span className="text-sm text-fg-muted">of every Hebrew month</span>
                        </div>
                        <p className="text-xs text-fg-muted mt-2">
                          Generate runs at 2 AM UTC, email runs at 3 AM UTC. Hebrew
                          months are 29 or 30 days; if you pick 30 in a 29-day month,
                          the job runs on the 29th so it&rsquo;s never skipped.
                        </p>
                        <p className="text-xs text-fg-muted mt-1">
                          For reference, today is{' '}
                          <span className="font-medium text-fg">
                            {convertToHebrewDate(new Date()) || '—'}
                          </span>
                          .
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="border border-border rounded-lg p-5">
                <h3 className="text-lg font-semibold text-fg mb-1">
                  Child → family conversion
                </h3>
                <p className="text-sm text-fg-muted mb-5">
                  When a child member reaches their wedding date (cron) or is
                  converted manually, the newly created family is assigned this
                  default plan. Leave blank to create the family with no plan and
                  assign one yourself.
                </p>

                <div>
                  <label
                    htmlFor="wedding-default-plan"
                    className="block text-sm font-medium text-fg mb-1"
                  >
                    Default plan for newly converted families
                  </label>
                  <select
                    id="wedding-default-plan"
                    value={automationConfig.weddingConversionDefaultPlanId || ''}
                    onChange={(e) =>
                      setAutomationConfig((c) => ({
                        ...c,
                        weddingConversionDefaultPlanId: e.target.value || null,
                      }))
                    }
                    className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                  >
                    <option value="">— Do not auto-assign —</option>
                    {plans.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name} ({formatMoney(p.yearlyPrice)}/yr)
                      </option>
                    ))}
                  </select>
                  {plans.length === 0 && (
                    <p className="text-xs text-fg-muted mt-1">
                      No payment plans configured yet. Add one in the Payment Plans
                      tab first.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleSaveAutomationConfig}
                  disabled={automationSaving}
                  className="bg-accent text-white px-5 py-2 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-60"
                >
                  {automationSaving ? 'Saving…' : 'Save automation settings'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Kevittel Tab */}
        {activeTab === 'kevittel' && !isTabLoading && (
          <div className="bg-surface rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-end mb-6">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const printWindow = window.open('', '_blank')
                    if (printWindow) {
                      const familiesWithKevittel = kevittelFamilies
                        .filter((family) => {
                          const hasHusbandName = family.husbandHebrewName && family.husbandHebrewName.trim() !== ''
                          const hasWifeName = family.wifeHebrewName && family.wifeHebrewName.trim() !== ''
                          const hasChildren = (family.members || []).some((child: any) => child.hebrewFirstName && child.hebrewFirstName.trim() !== '')
                          return hasHusbandName || hasWifeName || hasChildren
                        })
                        .map((family) => {
                          const husbandHebrewName = family.husbandHebrewName || ''
                          const husbandFatherHebrewName = family.husbandFatherHebrewName || ''
                          const wifeHebrewName = family.wifeHebrewName || ''
                          const wifeFatherHebrewName = family.wifeFatherHebrewName || ''
                          const children = family.members || []
                          
                          const entries: string[] = []
                          
                          if (husbandHebrewName && husbandHebrewName.trim() !== '') {
                            let husbandEntry = escapeHtml(husbandHebrewName)
                            if (husbandFatherHebrewName && husbandFatherHebrewName.trim() !== '') {
                              husbandEntry += ` בן ${escapeHtml(husbandFatherHebrewName)}`
                            }
                            entries.push(husbandEntry)
                          }
                          
                          if (wifeHebrewName && wifeHebrewName.trim() !== '') {
                            // Match the on-screen render: wives are prefixed
                            // with `וזו'` (the Hebrew "and his wife..."
                            // formula). Print + PDF dropped the prefix
                            // historically — they now agree with the screen.
                            let wifeEntry = `וזו' ${escapeHtml(wifeHebrewName)}`
                            if (wifeFatherHebrewName && wifeFatherHebrewName.trim() !== '') {
                              wifeEntry += ` בת ${escapeHtml(wifeFatherHebrewName)}`
                            }
                            entries.push(wifeEntry)
                          }
                          
                          children.forEach((child: any) => {
                            const childHebrewName = child.hebrewFirstName || ''
                            if (childHebrewName && childHebrewName.trim() !== '') {
                              entries.push(`ב' ${escapeHtml(childHebrewName)}`)
                            }
                          })
                          
                          return entries.join('<br>')
                        })
                        .filter(text => text.trim() !== '')
                      
                      printWindow.document.write(`
                        <html>
                          <head>
                            <title>Kevittel</title>
                            <style>
                              @media print {
                                @page { margin: 2cm; }
                                body { margin: 0; }
                              }
                              body {
                                font-family: Arial Hebrew, David, sans-serif;
                                direction: rtl;
                                text-align: right;
                                padding: 40px;
                                line-height: 2;
                                font-size: 18px;
                              }
                              .kevittel-item {
                                margin-bottom: 20px;
                                padding: 10px 0;
                                border-bottom: 1px solid #eee;
                              }
                              .kevittel-item:last-child {
                                border-bottom: none;
                              }
                            </style>
                          </head>
                          <body>
                            ${familiesWithKevittel.map(text => `<div class="kevittel-item">${text}</div>`).join('')}
                          </body>
                        </html>
                      `)
                      printWindow.document.close()
                      printWindow.print()
                    }
                  }}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
                >
                  <PrinterIcon className="h-5 w-5" />
                  Print
                </button>
                <button
                  onClick={() => {
                    const printWindow = window.open('', '_blank')
                    if (printWindow) {
                      const familiesWithKevittel = kevittelFamilies
                        .filter((family) => {
                          const hasHusbandName = family.husbandHebrewName && family.husbandHebrewName.trim() !== ''
                          const hasWifeName = family.wifeHebrewName && family.wifeHebrewName.trim() !== ''
                          const hasChildren = (family.members || []).some((child: any) => child.hebrewFirstName && child.hebrewFirstName.trim() !== '')
                          return hasHusbandName || hasWifeName || hasChildren
                        })
                        .map((family) => {
                          const husbandHebrewName = family.husbandHebrewName || ''
                          const husbandFatherHebrewName = family.husbandFatherHebrewName || ''
                          const wifeHebrewName = family.wifeHebrewName || ''
                          const wifeFatherHebrewName = family.wifeFatherHebrewName || ''
                          const children = family.members || []
                          
                          const entries: string[] = []
                          
                          if (husbandHebrewName && husbandHebrewName.trim() !== '') {
                            let husbandEntry = escapeHtml(husbandHebrewName)
                            if (husbandFatherHebrewName && husbandFatherHebrewName.trim() !== '') {
                              husbandEntry += ` בן ${escapeHtml(husbandFatherHebrewName)}`
                            }
                            entries.push(husbandEntry)
                          }
                          
                          if (wifeHebrewName && wifeHebrewName.trim() !== '') {
                            // Match the on-screen render: wives are prefixed
                            // with `וזו'` (the Hebrew "and his wife..."
                            // formula). Print + PDF dropped the prefix
                            // historically — they now agree with the screen.
                            let wifeEntry = `וזו' ${escapeHtml(wifeHebrewName)}`
                            if (wifeFatherHebrewName && wifeFatherHebrewName.trim() !== '') {
                              wifeEntry += ` בת ${escapeHtml(wifeFatherHebrewName)}`
                            }
                            entries.push(wifeEntry)
                          }
                          
                          children.forEach((child: any) => {
                            const childHebrewName = child.hebrewFirstName || ''
                            if (childHebrewName && childHebrewName.trim() !== '') {
                              entries.push(`ב' ${escapeHtml(childHebrewName)}`)
                            }
                          })
                          
                          return entries.join('<br>')
                        })
                        .filter(text => text.trim() !== '')
                      
                      printWindow.document.write(`
                        <html>
                          <head>
                            <title>Kevittel</title>
                            <style>
                              @media print {
                                @page { margin: 2cm; }
                                body { margin: 0; }
                              }
                              body {
                                font-family: Arial Hebrew, David, sans-serif;
                                direction: rtl;
                                text-align: right;
                                padding: 40px;
                                line-height: 2;
                                font-size: 18px;
                              }
                              .kevittel-item {
                                margin-bottom: 20px;
                                padding: 10px 0;
                                border-bottom: 1px solid #eee;
                              }
                              .kevittel-item:last-child {
                                border-bottom: none;
                              }
                            </style>
                          </head>
                          <body>
                            ${familiesWithKevittel.map(text => `<div class="kevittel-item">${text}</div>`).join('')}
                          </body>
                        </html>
                      `)
                      printWindow.document.close()
                      printWindow.print()
                    }
                  }}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-green-700 transition-colors"
                >
                  <DocumentArrowDownIcon className="h-5 w-5" />
                  Save as PDF
                </button>
              </div>
            </div>

            <div id="kevittel-content" className="space-y-4 print:space-y-2">
              {kevittelLoading ? (
                <div className="text-center py-12 text-fg-muted">
                  Loading families...
                </div>
              ) : (() => {
                const familiesWithHebrewNames = kevittelFamilies.filter((family) => {
                  // Only show families that have at least one Hebrew name.
                  const hasHusbandName = family.husbandHebrewName && family.husbandHebrewName.trim() !== ''
                  const hasWifeName = family.wifeHebrewName && family.wifeHebrewName.trim() !== ''
                  const hasChildren = (family.members || []).some((child: any) => child.hebrewFirstName && child.hebrewFirstName.trim() !== '')
                  return hasHusbandName || hasWifeName || hasChildren
                })

                
                if (kevittelFamilies.length === 0) {
                  return (
                    <div className="text-center py-12 text-fg-muted">
                      No families found.
                    </div>
                  )
                }
                
                if (familiesWithHebrewNames.length === 0) {
                  return (
                    <div className="text-center py-12">
                      <p className="text-fg-muted mb-4">
                        No families with Hebrew names found.
                      </p>
                      <p className="text-sm text-fg-subtle">
                        Please add Hebrew names to families in the Families section.
                      </p>
                      {kevittelFamilies.length > 0 && (
                        <p className="text-xs text-fg-subtle mt-2">
                          {kevittelFamilies.length} families loaded, but none have qualifying entries to print.
                        </p>
                      )}
                    </div>
                  )
                }
                
                return (
                  <>
                    {familiesWithHebrewNames.map((family) => {
                      const husbandHebrewName = family.husbandHebrewName || ''
                      const husbandFatherHebrewName = family.husbandFatherHebrewName || ''
                      const wifeHebrewName = family.wifeHebrewName || ''
                      const wifeFatherHebrewName = family.wifeFatherHebrewName || ''
                      const children = family.members || []
                      
                      // Build separate entries for each person (each on its own row)
                      const entries: string[] = []
                      
                      // Husband: name + בן + father's name
                      if (husbandHebrewName && husbandHebrewName.trim() !== '') {
                        let husbandEntry = husbandHebrewName
                        if (husbandFatherHebrewName && husbandFatherHebrewName.trim() !== '') {
                          husbandEntry += ` בן ${husbandFatherHebrewName}`
                        }
                        entries.push(husbandEntry)
                      }
                      
                      // Wife: זו' + name + בת + father's name
                      if (wifeHebrewName && wifeHebrewName.trim() !== '') {
                        let wifeEntry = `וזו' ${wifeHebrewName}`
                        if (wifeFatherHebrewName && wifeFatherHebrewName.trim() !== '') {
                          wifeEntry += ` בת ${wifeFatherHebrewName}`
                        }
                        entries.push(wifeEntry)
                      }
                      
                      // Add children with "ב" prefix, sorted by age (oldest first)
                      children.forEach((child: any) => {
                        const childHebrewName = child.hebrewFirstName || ''
                        if (childHebrewName && childHebrewName.trim() !== '') {
                          entries.push(`ב' ${childHebrewName}`)
                        }
                      })
                      
                      if (entries.length === 0) {
                        return null
                      }
                      
                      return (
                        <div 
                          key={family._id} 
                          className="border-b border-border py-3 print:py-2 print:border-border"
                        >
                          {entries.map((entry, index) => (
                            <div 
                              key={index}
                              className="text-xl font-semibold text-fg print:text-lg print:font-normal mb-2 last:mb-0"
                              dir="rtl"
                              lang="he"
                              style={{ fontFamily: 'Arial Hebrew, David, sans-serif', textAlign: 'right', lineHeight: '1.8' }}
                            >
                              {entry}
                            </div>
                          ))}
                        </div>
                      )
                    }).filter(Boolean)}
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* Payment Plan Modal */}
        {showPlanModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={(e) => {
              if (e.target === e.currentTarget) closePlanModal()
            }}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="bg-surface rounded-lg shadow-xl p-8 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold mb-4">
                {editingPlan ? 'Edit' : 'Add'} Payment Plan
              </h2>
              <form onSubmit={handleSubmitPlan} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-fg">Plan Name *</label>
                  <input
                    type="text"
                    required
                    value={planFormData.name}
                    onChange={(e) => setPlanFormData({ ...planFormData, name: e.target.value })}
                    className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    placeholder="e.g., Yearly membership"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-fg">Yearly Price ({currencySymbol}) *</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={planFormData.yearlyPrice}
                    onChange={(e) => setPlanFormData({ ...planFormData, yearlyPrice: e.target.value })}
                    className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  />
                </div>
                <div className="flex gap-4 justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlanModal(false)
                      setEditingPlan(null)
                      resetPlanForm()
                    }}
                    className="px-6 py-2 border border-border rounded-xl hover:bg-app-subtle transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="focus-ring px-4 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium"
                  >
                    {editingPlan ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Branding Tab — visible to all members, write-gated by role inside. */}
        {activeTab === 'branding' && (
          <BrandingPanel canManage={canSeePrivilegedTabs} />
        )}

        {/* Members Tab — admin / owner only. */}
        {activeTab === 'members' && canSeePrivilegedTabs && (
          <MembersPanel onRoleResolved={setCurrentRole} />
        )}

        {/* Billing Tab — admin / owner can view; owner manages subscription. */}
        {activeTab === 'billing' && canSeePrivilegedTabs && (
          <BillingPanel
            canManage={canSeePrivilegedTabs}
            isOwner={isOwner}
            initialBilling={initialBilling}
          />
        )}

        {/* Trash Tab — admin / owner only, purge is owner-only. */}
        {activeTab === 'trash' && canSeePrivilegedTabs && (
          <TrashPanel canPurge={canPurge} />
        )}

        {/* If a privileged tab was deep-linked by a non-privileged user,
            show a friendly fallback instead of a silent blank page. */}
        {(activeTab === 'members' ||
          activeTab === 'billing' ||
          activeTab === 'trash' ||
          activeTab === 'letterhead' ||
          activeTab === 'activity') &&
          !canSeePrivilegedTabs &&
          currentRole !== null && (
            <div className="surface-card p-6 text-sm text-fg-muted">
              You need to be an organization owner or admin to view this tab.
            </div>
          )}

        {/* Letterhead Tab — admin / owner only. */}
        {activeTab === 'letterhead' && canSeePrivilegedTabs && !isTabLoading && (
          <LetterheadPanel
            letterhead={letterhead}
            setLetterhead={setLetterhead}
            saving={letterheadSaving}
            onSubmit={handleSaveLetterhead}
          />
        )}

        {/* Mail Labels Tab — visible to all members. Print-only. */}
        {activeTab === 'labels' && !isTabLoading && (
          <MailLabelsPanel
            families={labelFamilies}
            plans={plans}
            filters={labelFilters}
            setFilters={setLabelFilters}
          />
        )}

        {/* Localization (currency + locale) Tab — admin/owner only. */}
        {activeTab === 'localization' && canSeePrivilegedTabs && (
          <LocalizationPanel />
        )}

        {/* Activity (audit log) Tab — admin / owner only. */}
        {activeTab === 'activity' && canSeePrivilegedTabs && (
          <ActivityPanel
            items={auditItems}
            nextCursor={auditNextCursor}
            loading={auditLoading}
            usersMap={auditUsersMap}
            actionFilter={auditActionFilter}
            setActionFilter={setAuditActionFilter}
            userFilter={auditUserFilter}
            setUserFilter={setAuditUserFilter}
            resourceTypeFilter={auditResourceTypeFilter}
            setResourceTypeFilter={setAuditResourceTypeFilter}
            fromDate={auditFromDate}
            setFromDate={setAuditFromDate}
            toDate={auditToDate}
            setToDate={setAuditToDate}
            onLoadMore={() => fetchAuditPage(auditNextCursor)}
            onExportCsv={exportAuditCsv}
          />
        )}

        {/* Cycle Configuration Tab */}
        {activeTab === 'cycle' && !isTabLoading && (
          <div className="bg-surface rounded-lg shadow-lg p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-fg">Cycle Configuration</h2>
              <p className="text-sm text-fg-muted">Configure the membership year start date</p>
            </div>

            {cycleConfig && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-800">
                  <strong>✓ Cycle configuration is active:</strong> Membership year starts on{' '}
                  {cycleConfig.cycleCalendar === 'hebrew'
                    ? `${cycleConfig.cycleStartHebrewDay || 1} ${hebrewMonthLabel(cycleConfig.cycleStartHebrewMonth || 7)} (Hebrew calendar)`
                    : new Date(
                        2024,
                        cycleConfig.cycleStartMonth - 1,
                        cycleConfig.cycleStartDay,
                      ).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                </p>
                <p className="text-sm text-green-700 mt-1">
                  {cycleConfig.cycleAutoRollover
                    ? 'Auto-rollover is ON — each cycle start, every family is charged their plan\u2019s yearly price and balances are updated automatically.'
                    : 'Auto-rollover is OFF — this date is informational only. Turn on the toggle below to have balances charged automatically each cycle.'}
                </p>
            </div>
            )}

            <form onSubmit={handleSaveCycleConfig} className="space-y-4">
              <div>
                <span className="block text-sm font-medium mb-2 text-fg">
                  Calendar
                </span>
                <div
                  role="radiogroup"
                  aria-label="Cycle calendar"
                  className="inline-flex rounded-md border border-border overflow-hidden"
                >
                  {(['gregorian', 'hebrew'] as const).map((cal) => {
                    const active = cycleFormData.cycleCalendar === cal
                    return (
                      <button
                        key={cal}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() =>
                          setCycleFormData({ ...cycleFormData, cycleCalendar: cal })
                        }
                        className={`focus-ring px-3 py-1.5 text-sm transition-colors ${
                          active
                            ? 'bg-accent text-accent-fg'
                            : 'bg-surface text-fg hover:bg-fg/5'
                        }`}
                      >
                        {cal === 'gregorian' ? 'Gregorian calendar' : 'Hebrew calendar'}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-fg-muted mt-2">
                  Pick which calendar drives the cycle start date.
                </p>
              </div>

              {cycleFormData.cycleCalendar === 'gregorian' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-fg">
                      Cycle Start Month *
                    </label>
                    <select
                      value={cycleFormData.cycleStartMonth}
                      onChange={(e) =>
                        setCycleFormData({
                          ...cycleFormData,
                          cycleStartMonth: parseInt(e.target.value),
                        })
                      }
                      className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      required
                    >
                      <option value={1}>January</option>
                      <option value={2}>February</option>
                      <option value={3}>March</option>
                      <option value={4}>April</option>
                      <option value={5}>May</option>
                      <option value={6}>June</option>
                      <option value={7}>July</option>
                      <option value={8}>August</option>
                      <option value={9}>September</option>
                      <option value={10}>October</option>
                      <option value={11}>November</option>
                      <option value={12}>December</option>
                    </select>
                    <p className="text-xs text-fg-muted mt-1">
                      The Gregorian month when the membership year begins
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-fg">
                      Cycle Start Day *
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={cycleFormData.cycleStartDay}
                      onChange={(e) =>
                        setCycleFormData({
                          ...cycleFormData,
                          cycleStartDay: parseInt(e.target.value) || 1,
                        })
                      }
                      className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      required
                    />
                    <p className="text-xs text-fg-muted mt-1">
                      The day of the Gregorian month when the membership year begins (1-31)
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-fg">
                      Hebrew Month *
                    </label>
                    <select
                      value={cycleFormData.cycleStartHebrewMonth}
                      onChange={(e) =>
                        setCycleFormData({
                          ...cycleFormData,
                          cycleStartHebrewMonth: parseInt(e.target.value),
                        })
                      }
                      className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      required
                    >
                      {HEBREW_MONTH_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-fg-muted mt-1">
                      The Hebrew month when the membership year begins. Tishrei is the
                      traditional start of the civil year.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-fg">
                      Hebrew Day *
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={cycleFormData.cycleStartHebrewDay}
                      onChange={(e) =>
                        setCycleFormData({
                          ...cycleFormData,
                          cycleStartHebrewDay: parseInt(e.target.value) || 1,
                        })
                      }
                      className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      required
                    />
                    <p className="text-xs text-fg-muted mt-1">
                      The day of the Hebrew month (1–30). If you pick 30 in a 29-day
                      Hebrew month, the cycle starts on the 29th of that month.
                    </p>
                    <p className="text-xs text-fg-muted mt-1">
                      For reference, today is{' '}
                      <span className="font-medium text-fg">
                        {convertToHebrewDate(new Date()) || '—'}
                      </span>
                      .
                    </p>
                  </div>
                </>
              )}

              <div className="border-t border-border pt-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cycleFormData.cycleAutoRollover}
                    onChange={(e) =>
                      setCycleFormData({
                        ...cycleFormData,
                        cycleAutoRollover: e.target.checked,
                      })
                    }
                    className="mt-1 h-4 w-4 text-orange-600 focus:ring-orange-500 border-border rounded"
                  />
                  <span>
                    <span className="block text-sm font-medium text-fg">
                      Auto-charge families on each cycle start
                    </span>
                    <span className="block text-xs text-fg-muted mt-1">
                      When enabled, a daily background job will charge every family their
                      plan&rsquo;s yearly price the moment the cycle date arrives in the
                      calendar you picked above. Each charge is recorded once per cycle —
                      re-running the job on the same day is safe and has no effect. Leave
                      this off if you want to keep handling annual billing manually.
                    </span>
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-fg">
                  Description
                </label>
                <input
                  type="text"
                  value={cycleFormData.description}
                  onChange={(e) => setCycleFormData({ ...cycleFormData, description: e.target.value })}
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  placeholder="Membership cycle start date"
                />
                <p className="text-xs text-fg-muted mt-1">
                  Optional description for this cycle configuration
                </p>
              </div>

              <div className="pt-4 border-t">
                <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 mb-4">
                  <p className="text-sm text-accent-hover">
                    <strong>How it works:</strong> When the cycle start date arrives each year, 
                    family balances will be increased based on their payment plans. This ensures 
                    that membership fees are properly tracked and calculated annually.
                  </p>
                </div>

                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={cycleSaving}
                    className="focus-ring px-4 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cycleSaving ? 'Saving...' : cycleConfig ? 'Update Configuration' : 'Save Configuration'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  )
}
