'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  UserGroupIcon,
  UserPlusIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/app/components/Toast'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { FAMILY_BALANCES_IDS_CAP } from '@/lib/schemas'
import {
  collectAllFamiliesPages,
  FAMILIES_LIST_PAGE_SIZE,
  familiesListUrl,
  parseFamiliesListResponse,
} from '@/lib/client/families-list'
import { parseFamilySaveError, validateFamilyFormFields } from '@/lib/client/family-form'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { formatLocaleDate, isFiniteDate } from '@/lib/date-utils'
import { useCurrency } from '@/lib/client/useCurrency'
import { useT } from '@/lib/client/i18n'
import {
  ActionMenu,
  Button,
  DataView,
  EmptyState,
  Modal,
  PageHeader,
  SkeletonRows,
  type DataColumn,
  type SortDir,
} from '@/app/components/ui'
import TaskFormModal from '@/app/components/tasks/TaskFormModal'

// QWERTY to Hebrew keyboard mapping
const qwertyToHebrew: { [key: string]: string } = {
  q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ',
  a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך',
  z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ',
  Q: '/', W: "'", E: 'ק', R: 'ר', T: 'א', Y: 'ט', U: 'ו', I: 'ן', O: 'ם', P: 'פ',
  A: 'ש', S: 'ד', D: 'ג', F: 'כ', G: 'ע', H: 'י', J: 'ח', K: 'ל', L: 'ך',
  Z: 'ז', X: 'ס', C: 'ב', V: 'ה', B: 'נ', N: 'מ', M: 'צ',
  '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '0': '0',
  '-': '-', '=': '=', '[': ']', ']': '[', '\\': '\\', ';': 'ף', "'": ',', ',': 'ת', '.': 'ץ', '/': '.',
  ' ': ' ',
}

const handleHebrewInput = (e: React.KeyboardEvent<HTMLInputElement>, currentValue: string, setValue: (value: string) => void) => {
  const input = e.currentTarget
  const cursorPosition = input.selectionStart || 0
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    const hebrewChar = qwertyToHebrew[e.key] || e.key
    const newValue = currentValue.slice(0, cursorPosition) + hebrewChar + currentValue.slice(cursorPosition)
    setValue(newValue)
    setTimeout(() => {
      input.setSelectionRange(cursorPosition + 1, cursorPosition + 1)
    }, 0)
  }
}

const capitalizeName = (text: string): string => {
  if (!text) return text
  return text
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const formatPhone = (value: string): string => value.replace(/\D/g, '')

const validateEmail = (email: string): boolean => {
  if (!email) return true
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

interface Family {
  _id: string
  name: string
  hebrewName?: string
  weddingDate: string
  husbandFirstName?: string
  husbandHebrewName?: string
  husbandFatherHebrewName?: string
  wifeFirstName?: string
  wifeHebrewName?: string
  wifeFatherHebrewName?: string
  husbandCellPhone?: string
  wifeCellPhone?: string
  email?: string
  phone?: string
  address?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  paymentPlanId?: string
  currentPlan?: number
  currentPayment: number
  openBalance: number
  memberCount?: number
  emailOptOut?: boolean
}

interface PaymentPlan {
  _id: string
  name: string
  yearlyPrice: number
  planNumber?: number
}

const initialForm = {
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
  paymentPlanId: '',
  currentPayment: 0,
  emailOptOut: false,
}

export interface FamiliesViewProps {
  initialFamilies?: Family[]
  initialPaymentPlans?: PaymentPlan[]
  initialFamiliesNextCursor?: string | null
  isAdmin?: boolean
}

export default function FamiliesView({
  initialFamilies,
  initialPaymentPlans,
  initialFamiliesNextCursor = null,
  isAdmin = false,
}: FamiliesViewProps = {}) {
  const toast = useToast()
  const confirm = useConfirm()
  const t = useT()
  const router = useRouter()
  const { format: formatMoney } = useCurrency()
  const familiesHydrated = initialFamilies !== undefined
  const plansHydrated = initialPaymentPlans !== undefined
  const [families, setFamilies] = useState<Family[]>(initialFamilies ?? [])
  const [nextCursor, setNextCursor] = useState<string | null>(initialFamiliesNextCursor)
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>(initialPaymentPlans ?? [])
  const [loading, setLoading] = useState(!familiesHydrated)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingFamily, setEditingFamily] = useState<Family | null>(null)
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(null)
  const [formData, setFormData] = useState(initialForm)
  const [taskFamily, setTaskFamily] = useState<Family | null>(null)
  // Bulk selection state. Persisted as a Set for O(1) toggling. Cleared on
  // family list refresh so stale ids can't leak into bulk actions.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showBulkPlanModal, setShowBulkPlanModal] = useState(false)
  const [bulkPlanValue, setBulkPlanValue] = useState<string>('')
  // StrictMode-safe gates: track whether each resource was server-prefetched.
  // Mutating a "first-run" flag inside the effect breaks under React 18 dev
  // strict-mode (the second pass sees the flag flipped to false and runs).
  const hasFetchedFamiliesRef = useRef(familiesHydrated)
  // Re-entrancy lock for the Add/Edit Family modal. Without this a
  // fast double-click or double Enter would POST the form twice and
  // create a duplicate family row before React could disable the
  // submit button.
  const formSubmittingRef = useRef(false)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const hasFetchedPlansRef = useRef(plansHydrated)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const mergeAdminBalances = useCallback(
    async (list: Family[], gen: number) => {
      if (!isAdmin || list.length === 0) return list
      try {
        const ids = list.map((f) => String(f._id))
        const balancesUrl =
          ids.length <= FAMILY_BALANCES_IDS_CAP
            ? `/api/families/balances?familyIds=${ids.join(',')}`
            : '/api/families/balances'
        const balances = await cachedFetch<Array<{ familyId: string; balance: number }>>(
          balancesUrl,
          { ttl: 30_000 },
        )
        if (isStale(gen)) return list
        if (Array.isArray(balances)) {
          const byId = new Map(balances.map((b) => [b.familyId, b.balance]))
          return list.map((f) => ({
            ...f,
            openBalance: byId.get(String(f._id)) ?? f.openBalance ?? 0,
          }))
        }
      } catch {
        /* keep legacy openBalance */
      }
      return list
    },
    [isAdmin, isStale],
  )

  const fetchFamiliesPage = useCallback(
    async (cursor: string | null, mode: 'reset' | 'append') => {
      const gen = begin()
      const url = familiesListUrl(cursor, FAMILIES_LIST_PAGE_SIZE)
      if (mode === 'reset') setLoading(true)
      else setLoadingMore(true)
      if (mode === 'reset') setLoadError(false)
      try {
        const data = await cachedFetch<any>(url, {
          ttl: 30_000,
          bypass: mode === 'reset',
        })
        if (isStale(gen)) return
        const { items, nextCursor: pageNext } = parseFamiliesListResponse<Family>(data)
        const merged = await mergeAdminBalances(items, gen)
        if (isStale(gen)) return
        setFamilies((prev) => (mode === 'append' ? [...prev, ...merged] : merged))
        setNextCursor(pageNext)
        if (mode === 'reset') setSelectedIds(new Set())
      } catch {
        if (isStale(gen)) return
        if (mode === 'reset') {
          setLoadError(true)
          toast.error(t('families.error.load'))
        } else {
          toast.error(t('families.error.loadMore'))
        }
      } finally {
        if (!isStale(gen)) {
          if (mode === 'reset') setLoading(false)
          else setLoadingMore(false)
        }
      }
    },
    [toast, begin, isStale, mergeAdminBalances, t],
  )

  const fetchFamilies = useCallback(async () => {
    await fetchFamiliesPage(null, 'reset')
  }, [fetchFamiliesPage])

  const loadMoreFamilies = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    await fetchFamiliesPage(nextCursor, 'append')
  }, [nextCursor, loadingMore, fetchFamiliesPage])

  const expandExportRows = useCallback(async () => {
    if (!nextCursor) return
    const gen = begin()
    try {
      const all = await collectAllFamiliesPages(async (cursor) => {
        const data = await cachedFetch<any>(familiesListUrl(cursor, FAMILIES_LIST_PAGE_SIZE), {
          ttl: 0,
          bypass: true,
        })
        if (isStale(gen)) return { items: [], nextCursor: null }
        return parseFamiliesListResponse<Family>(data)
      })
      if (isStale(gen)) return
      const merged = await mergeAdminBalances(all, gen)
      if (isStale(gen)) return
      setFamilies(merged)
      setNextCursor(null)
      return merged
    } catch {
      if (!isStale(gen)) toast.error(t('families.error.loadExport'))
    }
  }, [nextCursor, begin, isStale, mergeAdminBalances, toast, t])

  const fetchPaymentPlans = useCallback(async (opts?: { force?: boolean }) => {
    const gen = begin()
    try {
      const data = await cachedFetch<any>('/api/payment-plans', {
        ttl: 60_000,
        bypass: opts?.force,
        ...(opts?.force ? { cache: 'no-store' as RequestCache } : {}),
      })
      if (isStale(gen)) return
      if (Array.isArray(data)) setPaymentPlans(data)
    } catch {
      // Don't toast on transient failures here — payment plans are
      // referenced read-mostly across the page, and a temporary blip
      // already manifests as "Unknown Plan" cells. We deliberately
      // don't clear the existing list either: if we had plans last
      // render, keep them visible until the next successful refresh.
      // The mutation paths (Add/Edit Family) re-fetch explicitly via
      // `{ force: true }` so they'll surface failures there.
    }
  }, [begin, isStale])

  useEffect(() => {
    if (hasFetchedFamiliesRef.current) return
    hasFetchedFamiliesRef.current = true
    fetchFamilies()
  }, [fetchFamilies])

  useEffect(() => {
    if (hasFetchedPlansRef.current) return
    hasFetchedPlansRef.current = true
    fetchPaymentPlans()
  }, [fetchPaymentPlans])

  useOrgChanged(useCallback(() => {
    invalidate()
    hasFetchedFamiliesRef.current = false
    hasFetchedPlansRef.current = false
    setFamilies([])
    setNextCursor(null)
    setPaymentPlans([])
    setSelectedIds(new Set())
    setLoadError(false)
    setLoading(true)
    fetchFamilies()
    fetchPaymentPlans({ force: true })
  }, [fetchFamilies, fetchPaymentPlans, invalidate]))

  const getPlanNameById = useCallback(
    (planId?: string, currentPlan?: number): string => {
      if (planId) {
        const plan = paymentPlans.find((p) => p._id === planId)
        if (plan) return plan.name
      }
      if (currentPlan && paymentPlans.length > 0) {
        const plan = paymentPlans.find((p: any) => p.planNumber === currentPlan)
        if (plan) return plan.name
      }
      return t('families.unknownPlan')
    },
    [paymentPlans, t],
  )

  const resetFamilyModal = useCallback(() => {
    formSubmittingRef.current = false
    setFormSubmitting(false)
    setShowModal(false)
    setEditingFamily(null)
    setFormData(initialForm)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formSubmittingRef.current) return

    const formattedData = {
      ...formData,
      name: capitalizeName(formData.name),
      husbandFirstName: capitalizeName(formData.husbandFirstName),
      wifeFirstName: capitalizeName(formData.wifeFirstName),
      husbandCellPhone: formatPhone(formData.husbandCellPhone),
      wifeCellPhone: formatPhone(formData.wifeCellPhone),
      phone: formatPhone(formData.phone),
      email: (formData.email || '').trim(),
      emailOptOut: !!formData.emailOptOut,
    }

    const validationError = validateFamilyFormFields(formattedData)
    if (validationError) {
      toast.error(validationError)
      return
    }

    if (formattedData.email && !validateEmail(formattedData.email)) {
      toast.error(t('families.error.invalidEmail'))
      return
    }

    formSubmittingRef.current = true
    setFormSubmitting(true)
    try {
      const url = editingFamily ? `/api/families/${editingFamily._id}` : '/api/families'
      const method = editingFamily ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedData),
      })

      if (res.ok) {
        resetFamilyModal()
        invalidateCache(/^\/api\/families/)
        invalidateCache(/^\/api\/dashboard-stats/)
        fetchFamilies()
        toast.success(
          editingFamily
            ? t('families.success.updated').replace('{name}', formattedData.name)
            : t('families.success.created').replace('{name}', formattedData.name),
        )
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(parseFamilySaveError(error))
      }
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      formSubmittingRef.current = false
      setFormSubmitting(false)
    }
  }

  const handleEdit = (family: Family) => {
    setEditingFamily(family)
    if (!family.paymentPlanId) {
      toast.error(t('families.error.missingPlan'))
      return
    }
    setFormData({
      name: family.name,
      hebrewName: family.hebrewName || '',
      weddingDate: new Date(family.weddingDate).toISOString().split('T')[0],
      husbandFirstName: family.husbandFirstName || '',
      husbandHebrewName: family.husbandHebrewName || '',
      husbandFatherHebrewName: family.husbandFatherHebrewName || '',
      wifeFirstName: family.wifeFirstName || '',
      wifeHebrewName: family.wifeHebrewName || '',
      wifeFatherHebrewName: family.wifeFatherHebrewName || '',
      husbandCellPhone: family.husbandCellPhone || '',
      wifeCellPhone: family.wifeCellPhone || '',
      address: family.address || '',
      street: family.street || '',
      phone: family.phone || '',
      email: family.email || '',
      city: family.city || '',
      state: family.state || '',
      zip: family.zip || '',
      paymentPlanId: family.paymentPlanId,
      currentPayment: family.currentPayment,
      emailOptOut: !!family.emailOptOut,
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string, name: string) => {
    if (
      !(await confirm({
        title: t('families.deleteTitle'),
        message: t('families.deleteMessage').replace('{name}', name),
        destructive: true,
        confirmLabel: t('common.delete'),
      }))
    )
      return

    try {
      const res = await fetch(`/api/families/${id}`, { method: 'DELETE' })
      if (res.ok) {
        invalidateCache(/^\/api\/families/)
        invalidateCache(/^\/api\/dashboard-stats/)
        fetchFamilies()
        toast.success(t('families.success.deleted').replace('{name}', name))
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || t('families.error.delete'))
      }
    } catch {
      toast.error(t('common.networkError'))
    }
  }

  // ---- Sort ----
  // Search + pagination are owned by <DataView>; per-column filter configs
  // declare the filter UI (the toolbar's Filters button appears automatically
  // when at least one column has `filter:`).

  const sortedFamilies = useMemo(() => {
    if (!sort) return families
    const sorted = [...families]
    sorted.sort((a, b) => {
      let aVal: any, bVal: any
      switch (sort.id) {
        case 'name':
          aVal = (a.name || '').toLowerCase()
          bVal = (b.name || '').toLowerCase()
          break
        case 'weddingDate':
          aVal = isFiniteDate(a.weddingDate) ? new Date(a.weddingDate).getTime() : 0
          bVal = isFiniteDate(b.weddingDate) ? new Date(b.weddingDate).getTime() : 0
          break
        case 'members':
          aVal = a.memberCount || 0
          bVal = b.memberCount || 0
          break
        case 'plan':
          aVal = getPlanNameById(a.paymentPlanId, a.currentPlan).toLowerCase()
          bVal = getPlanNameById(b.paymentPlanId, b.currentPlan).toLowerCase()
          break
        case 'balance':
          aVal = a.openBalance || 0
          bVal = b.openBalance || 0
          break
        default:
          return 0
      }
      if (aVal == null) aVal = ''
      if (bVal == null) bVal = ''
      if (aVal < bVal) return sort.dir === 'asc' ? -1 : 1
      if (aVal > bVal) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [families, sort, getPlanNameById])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // Server-side bulk action API caps payload at 500 ids. Surface
  // that here so the user gets a guided experience instead of a
  // cryptic validation error after committing to a delete or plan
  // change.
  const BULK_SELECTION_CAP = 500
  const toggleSelectAllVisible = (rows: Family[]) => {
    setSelectedIds((prev) => {
      const visibleIds = rows.map((r) => r._id)
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id))
      if (allSelected) {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      const next = new Set(prev)
      let added = 0
      for (const id of visibleIds) {
        if (next.has(id)) continue
        if (next.size >= BULK_SELECTION_CAP) break
        next.add(id)
        added += 1
      }
      if (added < visibleIds.length - prev.size) {
        toast.error(
          t('families.bulkSelectionCap').replace('{cap}', BULK_SELECTION_CAP.toLocaleString()),
        )
      }
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const ok = await confirm({
      title: t('families.bulkDeleteTitle')
        .replace('{count}', String(ids.length))
        .replace('{unit}', ids.length === 1 ? t('families.familyUnit') : t('families.familiesUnit')),
      message: t('families.bulkDeleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    })
    if (!ok) return

    setBulkBusy(true)
    try {
      const res = await fetch('/api/families/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('families.error.bulkDelete'))
        return
      }
      toast.success(t('families.success.bulkDeleted').replace('{count}', String(data.modified || ids.length)))
      clearSelection()
      invalidateCache(/^\/api\/families/)
      fetchFamilies()
    } catch {
      toast.error(t('common.networkErrorShort'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkSetPlan = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    setBulkBusy(true)
    try {
      const res = await fetch('/api/families/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setPaymentPlan',
          ids,
          paymentPlanId: bulkPlanValue || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('families.error.bulkPlan'))
        return
      }
      toast.success(t('families.success.bulkUpdated').replace('{count}', String(data.modified || ids.length)))
      setShowBulkPlanModal(false)
      setBulkPlanValue('')
      clearSelection()
      invalidateCache(/^\/api\/families/)
      fetchFamilies()
    } catch {
      toast.error(t('common.networkErrorShort'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkSetEmailOptOut = async (emailOptOut: boolean) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/families/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setEmailOptOut', ids, emailOptOut }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('families.error.bulkUpdate'))
        return
      }
      toast.success(t('families.success.bulkUpdated').replace('{count}', String(data.modified || ids.length)))
      clearSelection()
      invalidateCache(/^\/api\/families/)
      fetchFamilies()
    } catch {
      toast.error(t('common.networkErrorShort'))
    } finally {
      setBulkBusy(false)
    }
  }

  const allColumns: DataColumn<Family>[] = [
    {
      id: 'select',
      header: (
        <input
          type="checkbox"
          aria-label={t('families.selectAll')}
          title={t('families.selectAll')}
          className="cursor-pointer"
          checked={
            sortedFamilies.length > 0 &&
            sortedFamilies.every((f) => selectedIds.has(f._id))
          }
          ref={(el) => {
            if (el) {
              const someSelected = sortedFamilies.some((f) => selectedIds.has(f._id))
              const allSelected =
                sortedFamilies.length > 0 &&
                sortedFamilies.every((f) => selectedIds.has(f._id))
              el.indeterminate = someSelected && !allSelected
            }
          }}
          onChange={() => toggleSelectAllVisible(sortedFamilies)}
        />
      ),
      headerText: '',
      cell: (f) => (
        <input
          type="checkbox"
          aria-label={t('families.selectFamily').replace('{name}', f.name)}
          className="cursor-pointer"
          checked={selectedIds.has(f._id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleSelect(f._id)}
        />
      ),
      exportValue: () => '',
      className: 'w-8',
    },
    {
      id: 'name',
      header: t('common.name'),
      headerText: t('common.name'),
      sortable: true,
      cell: (f) => (
        <Link href={`/families/${f._id}`} className="font-medium text-accent hover:text-accent-hover hover:underline focus-ring rounded">
          {f.name}
        </Link>
      ),
      exportValue: (f) => f.name,
      filter: { type: 'text', placeholder: t('families.nameFilterPlaceholder') },
    },
    {
      id: 'hebrewName',
      header: t('family.hebrewName'),
      headerText: t('family.hebrewName'),
      defaultHidden: true,
      cell: (f) => <span className="text-fg-muted">{f.hebrewName || '—'}</span>,
      exportValue: (f) => f.hebrewName || '',
    },
    {
      id: 'weddingDate',
      header: t('family.weddingDate'),
      headerText: t('family.weddingDate'),
      sortable: true,
      hideBelow: 'md',
      cell: (f) => <span className="tabular">{formatLocaleDate(f.weddingDate)}</span>,
      exportValue: (f) => (f.weddingDate ? new Date(f.weddingDate) : ''),
      filter: { type: 'dateRange', getValue: (f) => f.weddingDate || null },
    },
    {
      id: 'members',
      header: t('family.members'),
      headerText: t('family.members'),
      sortable: true,
      hideBelow: 'md',
      cell: (f) => (
        <span className="inline-flex items-center gap-1 text-fg-muted tabular">
          <UserGroupIcon className="h-4 w-4" aria-hidden="true" />
          {f.memberCount || 0}
        </span>
      ),
      exportValue: (f) => f.memberCount || 0,
      filter: { type: 'numberRange', getValue: (f) => f.memberCount || 0 },
    },
    {
      id: 'plan',
      header: t('family.plan'),
      headerText: t('family.plan'),
      sortable: true,
      hideBelow: 'lg',
      cell: (f) => <span className="text-fg-muted">{getPlanNameById(f.paymentPlanId, f.currentPlan)}</span>,
      exportValue: (f) => getPlanNameById(f.paymentPlanId, f.currentPlan),
      filter: { type: 'select', getValue: (f) => getPlanNameById(f.paymentPlanId, f.currentPlan) },
    },
    {
      id: 'email',
      header: t('common.email'),
      headerText: t('common.email'),
      defaultHidden: true,
      cell: (f) => <span className="text-fg-muted">{f.email || '—'}</span>,
      exportValue: (f) => f.email || '',
    },
    {
      id: 'phone',
      header: t('common.phone'),
      headerText: t('common.phone'),
      defaultHidden: true,
      cell: (f) => <span className="text-fg-muted tabular">{f.phone || f.husbandCellPhone || f.wifeCellPhone || '—'}</span>,
      exportValue: (f) => f.phone || f.husbandCellPhone || f.wifeCellPhone || '',
    },
    {
      id: 'address',
      header: t('common.address'),
      headerText: t('common.address'),
      defaultHidden: true,
      cell: (f) => (
        <span className="text-fg-muted">
          {[f.street, f.city, f.state, f.zip].filter(Boolean).join(', ') || '—'}
        </span>
      ),
      exportValue: (f) => [f.street, f.city, f.state, f.zip].filter(Boolean).join(', '),
    },
    {
      id: 'balance',
      header: t('family.balance'),
      headerText: t('family.openBalance'),
      sortable: true,
      align: 'right',
      cell: (f) => <span className="tabular font-medium">{formatMoney(f.openBalance)}</span>,
      exportValue: (f) => f.openBalance || 0,
      filter: { type: 'numberRange', getValue: (f) => f.openBalance || 0 },
    },
    {
      id: 'actions',
      header: '',
      headerText: t('common.actions'),
      align: 'right',
      cell: (f) => (
        <div className="flex items-center justify-end">
          <ActionMenu
            ariaLabel={t('families.actionsFor').replace('{name}', f.name)}
            items={[
              {
                label: t('families.addChild'),
                icon: <UserPlusIcon className="h-4 w-4" />,
                onClick: () => router.push(`/families/${f._id}?tab=members&add=true`),
              },
              {
                label: t('families.addTask'),
                icon: <ClipboardDocumentListIcon className="h-4 w-4" />,
                onClick: () => setTaskFamily(f),
              },
              {
                label: t('families.editFamily'),
                icon: <PencilIcon className="h-4 w-4" />,
                onClick: () => handleEdit(f),
              },
              {
                label: t('families.deleteFamily'),
                icon: <TrashIcon className="h-4 w-4" />,
                destructive: true,
                onClick: () => handleDelete(f._id, f.name),
              },
            ]}
          />
        </div>
      ),
      exportValue: () => '',
    },
  ]
  const columns = isAdmin
    ? allColumns
    : allColumns.filter((c) => !['select', 'plan', 'balance', 'actions'].includes(c.id))

  return (
    <div className="min-h-screen bg-app p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('nav.families')}
          subtitle={t('families.subtitle')}
          actions={
            isAdmin ? (
            <Button
              leftIcon={<PlusIcon className="h-5 w-5" />}
              onClick={() => {
                setFormData(initialForm)
                setEditingFamily(null)
                setShowModal(true)
                // Re-fetch plans on open in case a plan was created in
                // another tab / on the Settings page after this page mounted.
                void fetchPaymentPlans({ force: true })
              }}
            >
              {t('families.addFamily')}
            </Button>
            ) : undefined
          }
        />

        {isAdmin && selectedIds.size > 0 && (
          <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 shadow-sm">
            <span className="text-sm font-medium text-fg">
              {selectedIds.size} {t('families.selected')}
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-fg-muted hover:text-fg underline"
            >
              {t('common.clear')}
            </button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => {
                setBulkPlanValue('')
                setShowBulkPlanModal(true)
              }}
            >
              {t('families.changePlan')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => handleBulkSetEmailOptOut(true)}
            >
              {t('families.optOutEmail')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => handleBulkSetEmailOptOut(false)}
            >
              {t('families.optInEmail')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkBusy}
              onClick={handleBulkDelete}
            >
              {t('common.delete')}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="surface-card p-6">
            <SkeletonRows count={8} />
          </div>
        ) : loadError ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title={t('families.error.load')}
            description={t('dashboard.tasksLoadErrorDesc')}
            cta={{
              label: t('common.retry'),
              onClick: () => fetchFamilies(),
              icon: <ArrowPathIcon className="h-4 w-4" />,
            }}
          />
        ) : (
          <>
            <DataView
              tableId="families"
              rows={sortedFamilies}
              columns={columns}
              rowKey={(f) => f._id}
              sort={sort}
              onSortChange={(id, dir) => setSort({ id, dir })}
              globalSearch={{ placeholder: t('families.searchPlaceholder') }}
              expandExportRows={nextCursor ? expandExportRows : undefined}
              import={isAdmin ? { type: 'families' as const, onImported: () => fetchFamilies() } : undefined}
              mobileCard={(f) => (
                <FamilyMobileCard
                  family={f}
                  planName={getPlanNameById(f.paymentPlanId, f.currentPlan)}
                  canMutate={isAdmin}
                  onEdit={() => handleEdit(f)}
                  onDelete={() => handleDelete(f._id, f.name)}
                  onAddChild={() => router.push(`/families/${f._id}?tab=members&add=true`)}
                  onAddTask={() => setTaskFamily(f)}
                />
              )}
              empty={
                <EmptyState
                  icon={<UserGroupIcon className="h-10 w-10" />}
                  title={t('families.noFamilies')}
                  description={t('families.noFamiliesDesc')}
                  cta={
                    isAdmin
                      ? {
                          label: t('families.addFamily'),
                          onClick: () => {
                            setFormData(initialForm)
                            setEditingFamily(null)
                            setShowModal(true)
                          },
                          icon: <PlusIcon className="h-4 w-4" />,
                        }
                      : undefined
                  }
                />
              }
            />
            {nextCursor && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" loading={loadingMore} onClick={loadMoreFamilies}>
                  {t('common.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}

        <Modal
          open={showModal}
          onClose={resetFamilyModal}
          title={editingFamily ? `${t('common.edit')} ${editingFamily.name}` : t('families.addFamily')}
          maxWidth="max-w-3xl"
        >
          <FamilyModalBody
            formData={formData}
            setFormData={setFormData}
            onSubmit={handleSubmit}
            onClose={resetFamilyModal}
            editing={!!editingFamily}
            paymentPlans={paymentPlans}
            submitting={formSubmitting}
          />
        </Modal>

        <TaskFormModal
          open={!!taskFamily}
          onClose={() => setTaskFamily(null)}
          families={families}
          defaults={{
            relatedFamilyId: taskFamily?._id,
            email: taskFamily?.email || '',
          }}
          lockFamily
        />

        <Modal
          open={showBulkPlanModal}
          onClose={() => {
            setShowBulkPlanModal(false)
            setBulkPlanValue('')
          }}
          title={t('families.bulkPlanTitle')
            .replace('{count}', String(selectedIds.size))
            .replace(
              '{unit}',
              selectedIds.size === 1 ? t('families.familyUnit') : t('families.familiesUnit'),
            )}
          maxWidth="max-w-md"
        >
          <div className="p-4 space-y-4">
            <p className="text-sm text-fg-muted">
              {t('families.bulkPlanDesc')}
            </p>
            <select
              value={bulkPlanValue}
              onChange={(e) => setBulkPlanValue(e.target.value)}
              className="focus-ring w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
            >
              <option value="">{t('families.noPlan')}</option>
              {paymentPlans.map((p: any) => (
                <option key={p._id} value={p._id}>
                  {p.name || `Plan #${p.planNumber}`}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowBulkPlanModal(false)
                  setBulkPlanValue('')
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={handleBulkSetPlan} loading={bulkBusy}>
                {t('common.apply')}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  )
}

function FamilyMobileCard({
  family,
  planName,
  canMutate = true,
  onEdit,
  onDelete,
  onAddChild,
  onAddTask,
}: {
  family: Family
  planName: string
  canMutate?: boolean
  onEdit: () => void
  onDelete: () => void
  onAddChild: () => void
  onAddTask: () => void
}) {
  const t = useT()
  const { format: formatMoney } = useCurrency()
  return (
    <div className="surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/families/${family._id}`}
          className="font-semibold text-accent hover:underline focus-ring rounded"
        >
          {family.name}
        </Link>
        {canMutate && (
        <ActionMenu
          ariaLabel={t('families.actionsFor').replace('{name}', family.name)}
          items={[
            {
              label: t('families.addChild'),
              icon: <UserPlusIcon className="h-4 w-4" />,
              onClick: onAddChild,
            },
            {
              label: t('families.addTask'),
              icon: <ClipboardDocumentListIcon className="h-4 w-4" />,
              onClick: onAddTask,
            },
            {
              label: t('families.editFamily'),
              icon: <PencilIcon className="h-4 w-4" />,
              onClick: onEdit,
            },
            {
              label: t('families.deleteFamily'),
              icon: <TrashIcon className="h-4 w-4" />,
              destructive: true,
              onClick: onDelete,
            },
          ]}
        />
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-fg">
        <div>
          <dt className="text-fg-muted">{t('family.wedding')}</dt>
          <dd className="tabular">{formatLocaleDate(family.weddingDate)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t('family.members')}</dt>
          <dd className="tabular">{family.memberCount || 0}</dd>
        </div>
        {canMutate && (
          <>
        <div>
          <dt className="text-fg-muted">{t('family.plan')}</dt>
          <dd className="truncate">{planName}</dd>
        </div>
        <div className="text-end">
          <dt className="text-fg-muted">{t('family.balance')}</dt>
          <dd className="font-semibold text-fg tabular">{formatMoney(family.openBalance)}</dd>
        </div>
          </>
        )}
      </dl>
    </div>
  )
}

function FamilyModalBody({
  formData,
  setFormData,
  onSubmit,
  onClose,
  editing,
  paymentPlans,
  submitting,
}: {
  formData: any
  setFormData: (data: any) => void
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
  editing: boolean
  paymentPlans: PaymentPlan[]
  submitting: boolean
}) {
  const toast = useToast()
  const t = useT()
  const { format: formatMoney } = useCurrency()
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.familyName')}</label>
          <input
            type="text"
            required
            autoComplete="family-name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            onBlur={(e) => {
              if (e.target.value) setFormData({ ...formData, name: capitalizeName(e.target.value) })
            }}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.familyNameHebrew')}</label>
          <input
            type="text"
            required
            dir="rtl"
            lang="he"
            inputMode="text"
            value={formData.hebrewName}
            onChange={(e) => setFormData({ ...formData, hebrewName: e.target.value })}
            onKeyDown={(e) => handleHebrewInput(e, formData.hebrewName, (value) => setFormData({ ...formData, hebrewName: value }))}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle text-right outline-none"
            placeholder="שם משפחה בעברית"
            style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.husbandFirstName')}</label>
          <input
            type="text"
            autoComplete="given-name"
            value={formData.husbandFirstName}
            onChange={(e) => setFormData({ ...formData, husbandFirstName: e.target.value })}
            onBlur={(e) => {
              if (e.target.value) setFormData({ ...formData, husbandFirstName: capitalizeName(e.target.value) })
            }}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.husbandFirstNameHebrew')}</label>
          <input
            type="text"
            required
            dir="rtl"
            lang="he"
            inputMode="text"
            value={formData.husbandHebrewName}
            onChange={(e) => setFormData({ ...formData, husbandHebrewName: e.target.value })}
            onKeyDown={(e) => handleHebrewInput(e, formData.husbandHebrewName, (value) => setFormData({ ...formData, husbandHebrewName: value }))}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle text-right outline-none"
            placeholder="שם פרטי בעברית"
            style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.husbandFatherHebrew')}</label>
          <input
            type="text"
            dir="rtl"
            lang="he"
            inputMode="text"
            value={formData.husbandFatherHebrewName}
            onChange={(e) => setFormData({ ...formData, husbandFatherHebrewName: e.target.value })}
            onKeyDown={(e) => handleHebrewInput(e, formData.husbandFatherHebrewName, (value) => setFormData({ ...formData, husbandFatherHebrewName: value }))}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle text-right outline-none"
            placeholder="שם פרטי של האב בעברית"
            style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.wifeFirstName')}</label>
          <input
            type="text"
            autoComplete="given-name"
            value={formData.wifeFirstName}
            onChange={(e) => setFormData({ ...formData, wifeFirstName: e.target.value })}
            onBlur={(e) => {
              if (e.target.value) setFormData({ ...formData, wifeFirstName: capitalizeName(e.target.value) })
            }}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.wifeFirstNameHebrew')}</label>
          <input
            type="text"
            required
            dir="rtl"
            lang="he"
            inputMode="text"
            value={formData.wifeHebrewName}
            onChange={(e) => setFormData({ ...formData, wifeHebrewName: e.target.value })}
            onKeyDown={(e) => handleHebrewInput(e, formData.wifeHebrewName, (value) => setFormData({ ...formData, wifeHebrewName: value }))}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle text-right outline-none"
            placeholder="שם פרטי בעברית"
            style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.wifeFatherHebrew')}</label>
          <input
            type="text"
            dir="rtl"
            lang="he"
            inputMode="text"
            value={formData.wifeFatherHebrewName}
            onChange={(e) => setFormData({ ...formData, wifeFatherHebrewName: e.target.value })}
            onKeyDown={(e) => handleHebrewInput(e, formData.wifeFatherHebrewName, (value) => setFormData({ ...formData, wifeFatherHebrewName: value }))}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle text-right outline-none"
            placeholder="שם פרטי של האב בעברית"
            style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.husbandCell')}</label>
          <input
            type="tel"
            autoComplete="tel"
            value={formData.husbandCellPhone}
            onChange={(e) => setFormData({ ...formData, husbandCellPhone: formatPhone(e.target.value) })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
            placeholder="1234567890"
            pattern="[0-9]*"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.wifeCell')}</label>
          <input
            type="tel"
            autoComplete="tel"
            value={formData.wifeCellPhone}
            onChange={(e) => setFormData({ ...formData, wifeCellPhone: formatPhone(e.target.value) })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
            placeholder="1234567890"
            pattern="[0-9]*"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.street')}</label>
          <input
            type="text"
            autoComplete="street-address"
            value={formData.street}
            onChange={(e) => setFormData({ ...formData, street: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.city')}</label>
          <input
            type="text"
            autoComplete="address-level2"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.state')}</label>
          <input
            type="text"
            autoComplete="address-level1"
            value={formData.state}
            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.zip')}</label>
          <input
            type="text"
            autoComplete="postal-code"
            value={formData.zip}
            onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('common.email')}</label>
          <input
            type="email"
            autoComplete="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            onBlur={(e) => {
              if (e.target.value && !validateEmail(e.target.value)) {
                toast.error(t('families.error.invalidEmail'))
              }
            }}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
          <label className="mt-2 flex items-start gap-2 text-sm text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={!!formData.emailOptOut}
              onChange={(e) => setFormData({ ...formData, emailOptOut: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="font-medium">{t('families.form.emailOptOut')}</span>
              <span className="block text-xs text-fg-muted">
                {t('families.form.emailOptOutDesc')}
              </span>
            </span>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('common.phone')}</label>
          <input
            type="tel"
            autoComplete="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
            placeholder="1234567890"
            pattern="[0-9]*"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.weddingDate')}</label>
          <input
            type="date"
            required
            value={formData.weddingDate}
            onChange={(e) => setFormData({ ...formData, weddingDate: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">{t('families.form.paymentPlan')}</label>
          <select
            required
            value={formData.paymentPlanId || ''}
            onChange={(e) => setFormData({ ...formData, paymentPlanId: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          >
            <option value="">{t('families.form.selectPlan')}</option>
            {paymentPlans.map((plan) => (
              <option key={plan._id} value={plan._id}>
                {plan.name} — {t('families.form.planYearly').replace('{price}', formatMoney(plan.yearlyPrice))}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={submitting}>
          {editing ? t('common.saveChanges') : t('families.createFamily')}
        </Button>
      </div>
    </form>
  )
}
