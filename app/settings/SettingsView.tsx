'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type React from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConfirm, useToast } from '@/app/components/Toast'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useCurrency } from '@/lib/client/useCurrency'
import { isFiniteDate } from '@/lib/date-utils'
import { PageHeader, SkeletonRows, Card, Input, Modal, Button } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { Role } from '@/types/auth'
import SettingsNav, { type SettingsTabId } from '@/app/components/settings/SettingsNav'
import PanelSkeleton from './panels/PanelSkeleton'
import type { BillingSnapshot } from '@/app/components/settings/BillingPanel'

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

type TabType = SettingsTabId

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
  'dataExport',
] as const

function isValidTab(s: string | null | undefined): s is TabType {
  return !!s && (VALID_TABS as readonly string[]).includes(s)
}

const DynamicEmailPanel = dynamic(() => import('./panels/EmailPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicEventTypesPanel = dynamic(() => import('./panels/EventTypesPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicPaymentPlansPanel = dynamic(() => import('./panels/PaymentPlansPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicAutomationPanel = dynamic(() => import('./panels/AutomationPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicKevittelPanel = dynamic(() => import('./panels/KevittelPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicCyclePanel = dynamic(() => import('./panels/CyclePanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicLabelsPanel = dynamic(() => import('./panels/LabelsPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicActivityPanel = dynamic(() => import('./panels/ActivityPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicSecurityPanel = dynamic(() => import('./panels/SecurityPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicLetterheadPanel = dynamic(() => import('@/app/components/settings/LetterheadPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicMembersPanel = dynamic(() => import('@/app/components/settings/MembersPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicBrandingPanel = dynamic(() => import('@/app/components/settings/BrandingPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicTrashPanel = dynamic(() => import('@/app/components/settings/TrashPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicDataExportPanel = dynamic(() => import('./panels/DataExportPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicBillingPanel = dynamic(() => import('@/app/components/settings/BillingPanel'), {
  loading: () => <PanelSkeleton />,
})
const DynamicLocalizationPanel = dynamic(
  () => import('@/app/components/settings/LocalizationPanel'),
  { loading: () => <PanelSkeleton /> },
)

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
  const t = useT()
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
  const [currentRole, setCurrentRole] = useState<Role | null>(initialCurrentRole ?? null)
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
    (id: SettingsTabId) => {
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
    fromName: seededEmailConfig?.fromName || 'Kasa Family Management',
    replyTo: seededEmailConfig?.replyTo || '',
  })
  const [emailMessage, setEmailMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  // Inline status messages were replaced with toast notifications.
  // This shim keeps the existing call-sites compiling while routing the
  // user-visible message through the global toast system.
  const setMessage = (msg: { type: 'success' | 'error'; text: string } | null) => {
    if (!msg) return
    if (msg.type === 'success') toast.success(msg.text)
    else toast.error(msg.text)
  }

  // Event Types state
  const hasInitialEventTypes = initialEventTypes !== undefined
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
    amount: '',
  })

  // Payment Plans state
  const hasInitialPaymentPlans = initialPaymentPlans !== undefined
  const [plans, setPlans] = useState<PaymentPlan[]>(initialPaymentPlans ?? [])
  const [plansLoading, setPlansLoading] = useState(!hasInitialPaymentPlans)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState<PaymentPlan | null>(null)
  // `yearlyPrice` is kept as the raw input string while the modal is
  // open so the user can naturally type "12.50" or pause on "12." —
  // parsing to a number on every keystroke turned "12." into 12 and
  // ate the decimal point. The numeric coercion happens at submit time
  // (see `handleSubmitPlan`).
  const [planFormData, setPlanFormData] = useState<{ name: string; yearlyPrice: string }>({
    name: '',
    yearlyPrice: '0',
  })

  const resetEventTypeForm = useCallback(() => {
    setEventTypeFormData({ type: '', name: '', amount: '' })
    setEditingEventType(null)
  }, [])

  const resetPlanForm = useCallback(() => {
    setPlanFormData({ name: '', yearlyPrice: '0' })
  }, [])

  // Centralized closers so Escape + backdrop dismiss + the explicit
  // Cancel button all do the same thing (reset form state, not just
  // hide the modal).
  const closeEventTypeModal = useCallback(() => {
    setShowEventTypeModal(false)
    resetEventTypeForm()
  }, [resetEventTypeForm])
  const closePlanModal = useCallback(() => {
    setShowPlanModal(false)
    setEditingPlan(null)
    resetPlanForm()
  }, [resetPlanForm])

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
    cycleCalendar: initialCycleConfig?.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
    cycleStartMonth: initialCycleConfig?.cycleStartMonth || 9,
    cycleStartDay: initialCycleConfig?.cycleStartDay || 1,
    cycleStartHebrewMonth: initialCycleConfig?.cycleStartHebrewMonth || 7, // Tishrei
    cycleStartHebrewDay: initialCycleConfig?.cycleStartHebrewDay || 1,
    cycleAutoRollover: Boolean(initialCycleConfig?.cycleAutoRollover),
    description: initialCycleConfig?.description || 'Membership cycle start date',
  })

  // Automation config (Bar Mitzvah auto-assign) state. Fetched lazily on
  // first tab open because the values are tiny and most users never visit
  // the tab.
  const [automationConfig, setAutomationConfig] = useState<{
    barMitzvahAutoAssignPlanId: string | null
    barMitzvahAutoCreateEventTypeId: string | null
    addChildAutoCreateEventTypeId: string | null
    weddingConversionDefaultPlanId: string | null
    monthlyStatementAutoGenerate: boolean
    monthlyStatementAutoEmail: boolean
    monthlyStatementCalendar: 'gregorian' | 'hebrew'
    monthlyStatementDay: number
    monthlyStatementHebrewDay: number
  }>({
    barMitzvahAutoAssignPlanId: null,
    barMitzvahAutoCreateEventTypeId: null,
    addChildAutoCreateEventTypeId: null,
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
  const [auditUsersMap, setAuditUsersMap] = useState<
    Record<string, { name?: string; email?: string }>
  >({})

  // StrictMode-safe mount latch. Each ref starts as `true` for whichever
  // dataset the server provided so the corresponding fetch is skipped on
  // mount; refs we don't have data for stay `false` and fetch once.
  const hasFetchedEmailRef = useRef(hasInitialEmailConfig)
  const hasFetchedEventTypesRef = useRef(hasInitialEventTypes)
  const hasFetchedPlansRef = useRef(hasInitialPaymentPlans)
  const hasFetchedCycleRef = useRef(hasInitialCycleConfig)
  const hasFetchedKevittelRef = useRef(false)
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

  useOrgChanged(
    useCallback(() => {
      // Bump the shared fetch-generation ONCE — fetchers below capture the
      // post-bump value and bail if a *subsequent* org change invalidates
      // them. (Previously each fetcher also bumped the counter, which made
      // 4 of every 5 parallel fetches bail.)
      settingsFetchGenRef.current += 1
      hasFetchedEmailRef.current = false
      hasFetchedEventTypesRef.current = false
      hasFetchedPlansRef.current = false
      hasFetchedCycleRef.current = false
      hasFetchedKevittelRef.current = false
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
      setEmailFormData({ email: '', password: '', fromName: 'Kasa Family Management', replyTo: '' })
      setLoading(true)
      setEventTypesLoading(true)
      setPlansLoading(true)
      setCycleLoading(true)
      setKevittelLoading(true)
      setAutomationConfig({
        barMitzvahAutoAssignPlanId: null,
        barMitzvahAutoCreateEventTypeId: null,
        addChildAutoCreateEventTypeId: null,
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
    }, []),
  )

  // Refresh Kevittel data when switching to the Kevittel tab
  useEffect(() => {
    if (activeTab !== 'kevittel') return
    if (hasFetchedKevittelRef.current) return
    hasFetchedKevittelRef.current = true
    let cancelled = false
    void fetchKevittelData().finally(() => {
      if (cancelled) hasFetchedKevittelRef.current = false
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, orgFetchEpoch])

  // Email Configuration functions
  const fetchEmailConfig = useCallback(async () => {
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
            replyTo: config.replyTo || '',
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
  }, [toast])

  const handleSaveEmailConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setEmailMessage(null)

    if (!emailFormData.email) {
      setEmailMessage({ type: 'error', text: t('settings.email.errors.emailRequired') })
      setSaving(false)
      return
    }

    if (!emailConfig && !emailFormData.password) {
      setEmailMessage({ type: 'error', text: t('settings.email.errors.passwordRequired') })
      setSaving(false)
      return
    }

    try {
      const res = await fetch('/api/email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailFormData),
      })

      const result = await res.json().catch(() => ({}))

      if (res.ok) {
        setEmailConfig(result)
        setEmailFormData((prev) => ({ ...prev, password: '' }))
        setEmailMessage({
          type: 'success',
          text: emailConfig
            ? t('settings.email.success.updated')
            : t('settings.email.success.saved'),
        })
      } else {
        setEmailMessage({
          type: 'error',
          text: result.error || t('settings.email.errors.saveFailed'),
        })
      }
    } catch (error: any) {
      console.error('Error saving email config:', error)
      setEmailMessage({ type: 'error', text: t('settings.email.errors.saveError') })
    } finally {
      setSaving(false)
    }
  }

  const handleTestEmail = async () => {
    if (!emailConfig?.email) {
      setEmailMessage({ type: 'error', text: t('settings.email.errors.saveFirst') })
      return
    }

    setSaving(true)
    setEmailMessage(null)

    try {
      const res = await fetch('/api/email-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await res.json().catch(() => ({}))

      if (res.ok) {
        setEmailMessage({ type: 'success', text: t('settings.email.success.testSent') })
      } else {
        setEmailMessage({
          type: 'error',
          text: result.error || t('settings.email.errors.testFailed'),
        })
      }
    } catch (error: any) {
      console.error('Error sending test email:', error)
      setEmailMessage({ type: 'error', text: t('settings.email.errors.testError') })
    } finally {
      setSaving(false)
      await fetchEmailConfig()
    }
  }

  // Automation config functions (Bar Mitzvah auto-assign).
  // The lazy-load effect below this declaration triggers on first tab open.
  const hasFetchedAutomationRef = useRef(false)
  const fetchAutomationConfig = useCallback(async () => {
    const gen = settingsFetchGenRef.current
    try {
      setAutomationLoading(true)
      const data = await cachedFetch<Record<string, unknown>>('/api/organizations/automation', {
        ttl: 60_000,
      })
      if (gen !== settingsFetchGenRef.current) return
      setAutomationConfig({
        barMitzvahAutoAssignPlanId: (data.barMitzvahAutoAssignPlanId as string | null) ?? null,
        barMitzvahAutoCreateEventTypeId:
          (data.barMitzvahAutoCreateEventTypeId as string | null) ?? null,
        addChildAutoCreateEventTypeId:
          (data.addChildAutoCreateEventTypeId as string | null) ?? null,
        weddingConversionDefaultPlanId:
          (data.weddingConversionDefaultPlanId as string | null) ?? null,
        monthlyStatementAutoGenerate: !!data.monthlyStatementAutoGenerate,
        monthlyStatementAutoEmail: !!data.monthlyStatementAutoEmail,
        monthlyStatementCalendar:
          data.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
        monthlyStatementDay:
          typeof data.monthlyStatementDay === 'number' ? data.monthlyStatementDay : 1,
        monthlyStatementHebrewDay:
          typeof data.monthlyStatementHebrewDay === 'number' ? data.monthlyStatementHebrewDay : 1,
      })
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
          barMitzvahAutoCreateEventTypeId: automationConfig.barMitzvahAutoCreateEventTypeId || null,
          addChildAutoCreateEventTypeId: automationConfig.addChildAutoCreateEventTypeId || null,
          weddingConversionDefaultPlanId: automationConfig.weddingConversionDefaultPlanId || null,
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
          addChildAutoCreateEventTypeId: data.addChildAutoCreateEventTypeId ?? null,
          weddingConversionDefaultPlanId: data.weddingConversionDefaultPlanId ?? null,
          monthlyStatementAutoGenerate: !!data.monthlyStatementAutoGenerate,
          monthlyStatementAutoEmail: !!data.monthlyStatementAutoEmail,
          monthlyStatementCalendar:
            data.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
          monthlyStatementDay:
            typeof data.monthlyStatementDay === 'number' ? data.monthlyStatementDay : 1,
          monthlyStatementHebrewDay:
            typeof data.monthlyStatementHebrewDay === 'number' ? data.monthlyStatementHebrewDay : 1,
        })
        toast.success('Automation settings saved')
        invalidateCache('/api/organizations/automation')
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
        if (items.length >= LABELS_HARD_CAP && !cancelledLabelsWarningRef.current) {
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
    [
      auditActionFilter,
      auditUserFilter,
      auditResourceTypeFilter,
      auditFromDate,
      auditToDate,
      toast,
    ],
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
    void fetchAuditPage(null)
    void fetchAuditUsers()
    return () => {
      hasFetchedAuditRef.current = false
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
  const fetchCycleConfig = useCallback(async () => {
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
          description: config.description || 'Membership cycle start date',
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
  }, [])

  const handleSaveCycleConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setCycleSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/cycle-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cycleFormData),
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
            : 'Cycle configuration saved successfully!',
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
  const fetchEventTypes = useCallback(async () => {
    const gen = settingsFetchGenRef.current
    try {
      const data = await cachedFetch<LifecycleEventType[]>('/api/lifecycle-event-types', {
        ttl: 60_000,
      })
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
  }, [toast])

  const handleEditEventType = (eventType: LifecycleEventType) => {
    setEditingEventType(eventType)
    setEventTypeFormData({
      type: eventType.type,
      name: eventType.name,
      amount: eventType.amount.toString(),
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
        method: 'DELETE',
      })

      if (res.ok) {
        invalidateCache('/api/lifecycle-event-types')
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
  const [eventTypeSubmitting, setEventTypeSubmitting] = useState(false)
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
    setEventTypeSubmitting(true)
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
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        invalidateCache('/api/lifecycle-event-types')
        setShowEventTypeModal(false)
        resetEventTypeForm()
        setMessage({
          type: 'success',
          text: editingEventType
            ? 'Event type updated successfully!'
            : 'Event type created successfully!',
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
      setEventTypeSubmitting(false)
    }
  }

  // Payment Plans functions
  const fetchPlans = useCallback(
    async (opts?: { force?: boolean }) => {
      const gen = settingsFetchGenRef.current
      try {
        const data = await cachedFetch<PaymentPlan[]>('/api/payment-plans', {
          ttl: 60_000,
          bypass: opts?.force,
        })
        if (gen !== settingsFetchGenRef.current) return
        if (Array.isArray(data)) {
          setPlans(data)
        } else {
          console.error('Failed to fetch payment plans: unexpected response', data)
          toast.error('Could not reload payment plans.')
        }
      } catch (error) {
        if (gen !== settingsFetchGenRef.current) return
        console.error('Error fetching payment plans:', error)
        toast.error('Could not reload payment plans.')
      } finally {
        if (gen === settingsFetchGenRef.current) setPlansLoading(false)
      }
    },
    [toast],
  )

  const planSubmittingRef = useRef(false)
  const [planSubmitting, setPlanSubmitting] = useState(false)
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
    setPlanSubmitting(true)
    try {
      const url = editingPlan ? `/api/payment-plans/${editingPlan._id}` : '/api/payment-plans'

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
        setMessage({
          type: 'success',
          text: editingPlan
            ? 'Payment plan updated successfully!'
            : 'Payment plan created successfully!',
        })
      } else {
        const error = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: error.error || 'Failed to save payment plan' })
      }
    } catch (error) {
      console.error('Error saving payment plan:', error)
      setMessage({ type: 'error', text: 'Failed to save payment plan' })
    } finally {
      planSubmittingRef.current = false
      setPlanSubmitting(false)
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
      if (families.length >= KEVITTEL_HARD_CAP && !cancelledKevittelWarningRef.current) {
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
        }),
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

  // Lazy-fetch core settings tabs on first visit (or after org switch).
  useEffect(() => {
    if (activeTab !== 'automation') return
    if (hasFetchedAutomationRef.current) return
    hasFetchedAutomationRef.current = true
    let cancelled = false
    void fetchAutomationConfig().finally(() => {
      if (cancelled) hasFetchedAutomationRef.current = false
    })
    if (!hasFetchedEventTypesRef.current) {
      hasFetchedEventTypesRef.current = true
      void fetchEventTypes().finally(() => {
        if (cancelled) hasFetchedEventTypesRef.current = false
      })
    }
    if (!hasFetchedPlansRef.current) {
      hasFetchedPlansRef.current = true
      void fetchPlans().finally(() => {
        if (cancelled) hasFetchedPlansRef.current = false
      })
    }
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchAutomationConfig, fetchEventTypes, fetchPlans, orgFetchEpoch])

  useEffect(() => {
    if (activeTab !== 'email') return
    if (hasFetchedEmailRef.current) return
    hasFetchedEmailRef.current = true
    let cancelled = false
    void fetchEmailConfig().finally(() => {
      if (cancelled) hasFetchedEmailRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchEmailConfig, orgFetchEpoch])

  useEffect(() => {
    if (activeTab !== 'eventTypes') return
    if (hasFetchedEventTypesRef.current) return
    hasFetchedEventTypesRef.current = true
    let cancelled = false
    void fetchEventTypes().finally(() => {
      if (cancelled) hasFetchedEventTypesRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchEventTypes, orgFetchEpoch])

  useEffect(() => {
    if (activeTab !== 'paymentPlans') return
    if (hasFetchedPlansRef.current) return
    hasFetchedPlansRef.current = true
    let cancelled = false
    void fetchPlans().finally(() => {
      if (cancelled) hasFetchedPlansRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchPlans, orgFetchEpoch])

  useEffect(() => {
    if (activeTab !== 'cycle') return
    if (hasFetchedCycleRef.current) return
    hasFetchedCycleRef.current = true
    let cancelled = false
    void fetchCycleConfig().finally(() => {
      if (cancelled) hasFetchedCycleRef.current = false
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, fetchCycleConfig, orgFetchEpoch])

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
        <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

        <div className="flex flex-col md:flex-row gap-6 items-start">
          <aside className="w-full md:w-56 lg:w-64 shrink-0 md:sticky md:top-6">
            <SettingsNav
              activeId={activeTab}
              onChange={changeTab}
              canSeePrivilegedTabs={canSeePrivilegedTabs}
            />
          </aside>

          <div className="flex-1 min-w-0 w-full">
            {/* Per-tab skeleton while the relevant fetch is in flight. */}
            {isTabLoading && (
              <Card className="mb-6">
                <SkeletonRows count={5} />
              </Card>
            )}

            {/* Email Configuration Tab */}
            {activeTab === 'email' && !isTabLoading && (
              <DynamicEmailPanel
                emailConfig={emailConfig}
                emailFormData={emailFormData}
                setEmailFormData={setEmailFormData}
                saving={saving}
                message={emailMessage}
                onSubmit={handleSaveEmailConfig}
                onTest={handleTestEmail}
              />
            )}

            {/* Event Types Tab */}
            {activeTab === 'eventTypes' && !isTabLoading && (
              <DynamicEventTypesPanel
                eventTypes={eventTypes}
                formatMoney={formatMoney}
                onAdd={() => {
                  resetEventTypeForm()
                  setShowEventTypeModal(true)
                }}
                onEdit={handleEditEventType}
                onDelete={handleDeleteEventType}
              />
            )}

            {/* Payment Plans Tab */}
            {activeTab === 'paymentPlans' && !isTabLoading && (
              <DynamicPaymentPlansPanel
                plans={plans}
                onAdd={() => {
                  resetPlanForm()
                  setEditingPlan(null)
                  setShowPlanModal(true)
                }}
                onEdit={handleEditPlan}
                onDelete={handleDeletePlan}
              />
            )}

            {/* Event Type Modal */}
            <Modal
              open={showEventTypeModal}
              onClose={closeEventTypeModal}
              title={
                editingEventType
                  ? t('settings.eventTypeModal.editTitle')
                  : t('settings.eventTypeModal.addTitle')
              }
              maxWidth="max-w-md"
            >
              <form onSubmit={handleSubmitEventType} className="space-y-4">
                {!editingEventType && (
                  <Input
                    label={t('settings.eventTypeModal.typeCode')}
                    required
                    type="text"
                    value={eventTypeFormData.type}
                    onChange={(e) =>
                      setEventTypeFormData({ ...eventTypeFormData, type: e.target.value })
                    }
                    placeholder={t('settings.eventTypeModal.typeCodePlaceholder')}
                    hint={t('settings.eventTypeModal.typeCodeHint')}
                  />
                )}
                {editingEventType && (
                  <Input
                    label={t('settings.eventTypeModal.typeCode')}
                    type="text"
                    value={eventTypeFormData.type}
                    disabled
                    hint={t('settings.eventTypeModal.typeCodeReadonlyHint')}
                  />
                )}
                <Input
                  label={t('settings.eventTypeModal.name')}
                  required
                  type="text"
                  value={eventTypeFormData.name}
                  onChange={(e) =>
                    setEventTypeFormData({ ...eventTypeFormData, name: e.target.value })
                  }
                  placeholder={t('settings.eventTypeModal.namePlaceholder')}
                />
                <Input
                  label={t('settings.eventTypeModal.amount').replace('{symbol}', currencySymbol)}
                  required
                  type="number"
                  step="0.01"
                  value={eventTypeFormData.amount}
                  onChange={(e) =>
                    setEventTypeFormData({ ...eventTypeFormData, amount: e.target.value })
                  }
                  placeholder="0.00"
                />
                <div className="flex gap-3 pt-2">
                  <Button type="submit" loading={eventTypeSubmitting} className="flex-1">
                    {eventTypeSubmitting
                      ? t('settings.eventTypeModal.saving')
                      : editingEventType
                        ? t('settings.eventTypeModal.update')
                        : t('settings.eventTypeModal.create')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      setShowEventTypeModal(false)
                      resetEventTypeForm()
                    }}
                  >
                    {t('settings.eventTypeModal.cancel')}
                  </Button>
                </div>
              </form>
            </Modal>

            {/* Automation Tab */}
            {activeTab === 'automation' && !isTabLoading && (
              <DynamicAutomationPanel
                automationConfig={automationConfig}
                setAutomationConfig={setAutomationConfig}
                plans={plans}
                eventTypes={eventTypes}
                formatMoney={formatMoney}
                emailConfig={emailConfig}
                saving={automationSaving}
                onSave={handleSaveAutomationConfig}
              />
            )}

            {/* Kevittel Tab */}
            {activeTab === 'kevittel' && !isTabLoading && (
              <DynamicKevittelPanel families={kevittelFamilies} loading={kevittelLoading} />
            )}

            {/* Payment Plan Modal */}
            <Modal
              open={showPlanModal}
              onClose={closePlanModal}
              title={
                editingPlan ? t('settings.planModal.editTitle') : t('settings.planModal.addTitle')
              }
              maxWidth="max-w-md"
            >
              <form onSubmit={handleSubmitPlan} className="space-y-4">
                <Input
                  label={t('settings.planModal.name')}
                  required
                  type="text"
                  value={planFormData.name}
                  onChange={(e) => setPlanFormData({ ...planFormData, name: e.target.value })}
                  placeholder={t('settings.planModal.namePlaceholder')}
                />
                <Input
                  label={t('settings.planModal.yearlyPrice').replace('{symbol}', currencySymbol)}
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={planFormData.yearlyPrice}
                  onChange={(e) =>
                    setPlanFormData({ ...planFormData, yearlyPrice: e.target.value })
                  }
                />
                <div className="flex gap-3 justify-end pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowPlanModal(false)
                      setEditingPlan(null)
                      resetPlanForm()
                    }}
                  >
                    {t('settings.planModal.cancel')}
                  </Button>
                  <Button type="submit" loading={planSubmitting}>
                    {planSubmitting
                      ? t('settings.planModal.saving')
                      : editingPlan
                        ? t('settings.planModal.update')
                        : t('settings.planModal.create')}
                  </Button>
                </div>
              </form>
            </Modal>

            {/* Branding Tab — visible to all members, write-gated by role inside. */}
            {activeTab === 'branding' && <DynamicBrandingPanel canManage={canSeePrivilegedTabs} />}

            {/* Members Tab — admin / owner only. */}
            {activeTab === 'members' && canSeePrivilegedTabs && (
              <DynamicMembersPanel onRoleResolved={setCurrentRole} />
            )}

            {/* Billing Tab — admin / owner can view; owner manages subscription. */}
            {activeTab === 'billing' && canSeePrivilegedTabs && (
              <DynamicBillingPanel
                canManage={canSeePrivilegedTabs}
                isOwner={isOwner}
                initialBilling={initialBilling}
              />
            )}

            {/* Trash Tab — admin / owner only, purge is owner-only. */}
            {activeTab === 'trash' && canSeePrivilegedTabs && (
              <DynamicTrashPanel canPurge={canPurge} />
            )}

            {activeTab === 'dataExport' && canSeePrivilegedTabs && <DynamicDataExportPanel />}

            {/* If a privileged tab was deep-linked by a non-privileged user,
            show a friendly fallback instead of a silent blank page. */}
            {(activeTab === 'members' ||
              activeTab === 'billing' ||
              activeTab === 'trash' ||
              activeTab === 'dataExport' ||
              activeTab === 'letterhead' ||
              activeTab === 'activity') &&
              !canSeePrivilegedTabs &&
              currentRole !== null && (
                <Card className="text-sm text-fg-muted">{t('settings.privilegedTabDenied')}</Card>
              )}

            {/* Letterhead Tab — admin / owner only. */}
            {activeTab === 'letterhead' && canSeePrivilegedTabs && !isTabLoading && (
              <DynamicLetterheadPanel
                letterhead={letterhead}
                setLetterhead={setLetterhead}
                saving={letterheadSaving}
                onSubmit={handleSaveLetterhead}
              />
            )}

            {/* Mail Labels Tab — visible to all members. Print-only. */}
            {activeTab === 'labels' && !isTabLoading && (
              <DynamicLabelsPanel
                families={labelFamilies}
                plans={plans}
                filters={labelFilters}
                setFilters={setLabelFilters}
              />
            )}

            {/* Localization (currency + locale) Tab — admin/owner only. */}
            {activeTab === 'localization' && canSeePrivilegedTabs && <DynamicLocalizationPanel />}

            {/* Activity (audit log) Tab — admin / owner only. */}
            {activeTab === 'activity' && canSeePrivilegedTabs && (
              <>
                <DynamicSecurityPanel isOwner={isOwner} />
                <DynamicActivityPanel
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
                  isOwner={isOwner}
                />
              </>
            )}

            {/* Cycle Configuration Tab */}
            {activeTab === 'cycle' && !isTabLoading && (
              <DynamicCyclePanel
                cycleConfig={cycleConfig}
                cycleFormData={cycleFormData}
                setCycleFormData={setCycleFormData}
                saving={cycleSaving}
                onSubmit={handleSaveCycleConfig}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
