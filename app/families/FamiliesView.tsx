'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  UserGroupIcon,
  UserPlusIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast, useConfirm } from '@/app/components/Toast'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import {
  collectAllFamiliesPages,
  FAMILIES_LIST_PAGE_SIZE,
  familiesListUrl,
  parseFamiliesListResponse,
} from '@/lib/client/families-list'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { formatLocaleDate, isFiniteDate } from '@/lib/date-utils'
import { useCurrency } from '@/lib/client/useCurrency'
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
  const router = useRouter()
  const { format: formatMoney } = useCurrency()
  const hasInitialFamilies = Array.isArray(initialFamilies) && initialFamilies.length > 0
  const [families, setFamilies] = useState<Family[]>(initialFamilies ?? [])
  const [nextCursor, setNextCursor] = useState<string | null>(initialFamiliesNextCursor)
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>(initialPaymentPlans ?? [])
  const [loading, setLoading] = useState(!hasInitialFamilies)
  const [loadingMore, setLoadingMore] = useState(false)
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
  const hasFetchedFamiliesRef = useRef(hasInitialFamilies)
  // Re-entrancy lock for the Add/Edit Family modal. Without this a
  // fast double-click or double Enter would POST the form twice and
  // create a duplicate family row before React could disable the
  // submit button.
  const formSubmittingRef = useRef(false)
  const hasFetchedPlansRef = useRef(
    Array.isArray(initialPaymentPlans) && initialPaymentPlans.length > 0,
  )
  const { begin, invalidate, isStale } = useRequestGeneration()

  const mergeAdminBalances = useCallback(
    async (list: Family[], gen: number) => {
      if (!isAdmin || list.length === 0) return list
      try {
        const balances = await cachedFetch<Array<{ familyId: string; balance: number }>>(
          '/api/families/balances',
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
          setFamilies([])
          setNextCursor(null)
          toast.error('Could not load families.')
        } else {
          toast.error('Could not load more families.')
        }
      } finally {
        if (!isStale(gen)) {
          if (mode === 'reset') setLoading(false)
          else setLoadingMore(false)
        }
      }
    },
    [toast, begin, isStale, mergeAdminBalances],
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
      if (!isStale(gen)) toast.error('Could not load all families for export.')
    }
  }, [nextCursor, begin, isStale, mergeAdminBalances, toast])

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
      return 'Unknown Plan'
    },
    [paymentPlans],
  )

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
      email: formData.email || '',
      emailOptOut: !!formData.emailOptOut,
    }

    if (formattedData.email && !validateEmail(formattedData.email)) {
      toast.error('Please enter a valid email address.')
      return
    }

    formSubmittingRef.current = true
    try {
      const url = editingFamily ? `/api/families/${editingFamily._id}` : '/api/families'
      const method = editingFamily ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedData),
      })

      if (res.ok) {
        setShowModal(false)
        setEditingFamily(null)
        setFormData(initialForm)
        invalidateCache(/^\/api\/families/)
        invalidateCache(/^\/api\/dashboard-stats/)
        fetchFamilies()
        toast.success(editingFamily ? `${formattedData.name} updated.` : `${formattedData.name} created.`)
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(error.error || error.details || 'Could not save family.')
      }
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      formSubmittingRef.current = false
    }
  }

  const handleEdit = (family: Family) => {
    setEditingFamily(family)
    if (!family.paymentPlanId) {
      toast.error('Family is missing a payment plan. Please update the family.')
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
        title: 'Delete family?',
        message: `This permanently deletes ${name} and all of their data.`,
        destructive: true,
        confirmLabel: 'Delete',
      }))
    )
      return

    try {
      const res = await fetch(`/api/families/${id}`, { method: 'DELETE' })
      if (res.ok) {
        invalidateCache(/^\/api\/families/)
        invalidateCache(/^\/api\/dashboard-stats/)
        fetchFamilies()
        toast.success(`${name} deleted.`)
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || 'Could not delete family.')
      }
    } catch {
      toast.error('Network error — please try again.')
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
          `Selection capped at ${BULK_SELECTION_CAP.toLocaleString()} families. ` +
          `Run bulk actions in batches to cover the rest.`,
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
      title: `Delete ${ids.length} ${ids.length === 1 ? 'family' : 'families'}?`,
      message: 'They will be moved to the recycle bin and can be restored within 30 days.',
      confirmLabel: 'Delete',
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
        toast.error(data.error || 'Bulk delete failed.')
        return
      }
      toast.success(`Deleted ${data.modified || ids.length} families.`)
      clearSelection()
      invalidateCache(/^\/api\/families/)
      fetchFamilies()
    } catch {
      toast.error('Network error.')
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
        toast.error(data.error || 'Bulk plan change failed.')
        return
      }
      toast.success(`Updated ${data.modified || ids.length} families.`)
      setShowBulkPlanModal(false)
      setBulkPlanValue('')
      clearSelection()
      invalidateCache(/^\/api\/families/)
      fetchFamilies()
    } catch {
      toast.error('Network error.')
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
        toast.error(data.error || 'Bulk update failed.')
        return
      }
      toast.success(`Updated ${data.modified || ids.length} families.`)
      clearSelection()
      invalidateCache(/^\/api\/families/)
      fetchFamilies()
    } catch {
      toast.error('Network error.')
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
          aria-label="Select all matching the current filter (capped at 500)"
          title="Select all matching the current filter (capped at 500)"
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
          aria-label={`Select ${f.name}`}
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
      header: 'Name',
      headerText: 'Name',
      sortable: true,
      cell: (f) => (
        <Link href={`/families/${f._id}`} className="font-medium text-accent hover:text-accent-hover hover:underline focus-ring rounded">
          {f.name}
        </Link>
      ),
      exportValue: (f) => f.name,
      filter: { type: 'text', placeholder: 'Family name…' },
    },
    {
      id: 'hebrewName',
      header: 'Hebrew Name',
      headerText: 'Hebrew Name',
      defaultHidden: true,
      cell: (f) => <span className="text-fg-muted">{f.hebrewName || '—'}</span>,
      exportValue: (f) => f.hebrewName || '',
    },
    {
      id: 'weddingDate',
      header: 'Wedding Date',
      headerText: 'Wedding Date',
      sortable: true,
      hideBelow: 'md',
      cell: (f) => <span className="tabular">{formatLocaleDate(f.weddingDate)}</span>,
      exportValue: (f) => (f.weddingDate ? new Date(f.weddingDate) : ''),
      filter: { type: 'dateRange', getValue: (f) => f.weddingDate || null },
    },
    {
      id: 'members',
      header: 'Members',
      headerText: 'Members',
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
      header: 'Plan',
      headerText: 'Plan',
      sortable: true,
      hideBelow: 'lg',
      cell: (f) => <span className="text-fg-muted">{getPlanNameById(f.paymentPlanId, f.currentPlan)}</span>,
      exportValue: (f) => getPlanNameById(f.paymentPlanId, f.currentPlan),
      filter: { type: 'select', getValue: (f) => getPlanNameById(f.paymentPlanId, f.currentPlan) },
    },
    {
      id: 'email',
      header: 'Email',
      headerText: 'Email',
      defaultHidden: true,
      cell: (f) => <span className="text-fg-muted">{f.email || '—'}</span>,
      exportValue: (f) => f.email || '',
    },
    {
      id: 'phone',
      header: 'Phone',
      headerText: 'Phone',
      defaultHidden: true,
      cell: (f) => <span className="text-fg-muted tabular">{f.phone || f.husbandCellPhone || f.wifeCellPhone || '—'}</span>,
      exportValue: (f) => f.phone || f.husbandCellPhone || f.wifeCellPhone || '',
    },
    {
      id: 'address',
      header: 'Address',
      headerText: 'Address',
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
      header: 'Balance',
      headerText: 'Open Balance',
      sortable: true,
      align: 'right',
      cell: (f) => <span className="tabular font-medium">{formatMoney(f.openBalance)}</span>,
      exportValue: (f) => f.openBalance || 0,
      filter: { type: 'numberRange', getValue: (f) => f.openBalance || 0 },
    },
    {
      id: 'actions',
      header: '',
      headerText: 'Actions',
      align: 'right',
      cell: (f) => (
        <div className="flex items-center justify-end">
          <ActionMenu
            ariaLabel={`Actions for ${f.name}`}
            items={[
              {
                label: 'Add child',
                icon: <UserPlusIcon className="h-4 w-4" />,
                onClick: () => router.push(`/families/${f._id}?tab=members&add=true`),
              },
              {
                label: 'Add task',
                icon: <ClipboardDocumentListIcon className="h-4 w-4" />,
                onClick: () => setTaskFamily(f),
              },
              {
                label: 'Edit family',
                icon: <PencilIcon className="h-4 w-4" />,
                onClick: () => handleEdit(f),
              },
              {
                label: 'Delete family',
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
          title="Families"
          subtitle="Manage family members and their information."
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
              Add Family
            </Button>
            ) : undefined
          }
        />

        {isAdmin && selectedIds.size > 0 && (
          <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 shadow-sm">
            <span className="text-sm font-medium text-fg">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-fg-muted hover:text-fg underline"
            >
              Clear
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
              Change plan
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => handleBulkSetEmailOptOut(true)}
            >
              Opt out of email
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => handleBulkSetEmailOptOut(false)}
            >
              Opt in to email
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkBusy}
              onClick={handleBulkDelete}
            >
              Delete
            </Button>
          </div>
        )}

        {loading ? (
          <div className="surface-card p-6">
            <SkeletonRows count={8} />
          </div>
        ) : (
          <>
            <DataView
              tableId="families"
              rows={sortedFamilies}
              columns={columns}
              rowKey={(f) => f._id}
              sort={sort}
              onSortChange={(id, dir) => setSort({ id, dir })}
              globalSearch={{ placeholder: 'Search by name, email, phone, address, plan…' }}
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
                  title="No families yet"
                  description="Create your first family to start tracking payments and members."
                  cta={
                    isAdmin
                      ? {
                          label: 'Add Family',
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
                  Load more
                </Button>
              </div>
            )}
          </>
        )}

        <Modal
          open={showModal}
          onClose={() => {
            setShowModal(false)
            setEditingFamily(null)
            setFormData(initialForm)
          }}
          title={editingFamily ? `Edit ${editingFamily.name}` : 'Add Family'}
          maxWidth="max-w-3xl"
        >
          <FamilyModalBody
            formData={formData}
            setFormData={setFormData}
            onSubmit={handleSubmit}
            onClose={() => {
              setShowModal(false)
              setEditingFamily(null)
              setFormData(initialForm)
            }}
            editing={!!editingFamily}
            paymentPlans={paymentPlans}
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
          title={`Change plan for ${selectedIds.size} ${selectedIds.size === 1 ? 'family' : 'families'}`}
          maxWidth="max-w-md"
        >
          <div className="p-4 space-y-4">
            <p className="text-sm text-fg-muted">
              Assign a payment plan to all selected families. Choose "No plan" to clear the assignment.
            </p>
            <select
              value={bulkPlanValue}
              onChange={(e) => setBulkPlanValue(e.target.value)}
              className="focus-ring w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
            >
              <option value="">No plan</option>
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
                Cancel
              </Button>
              <Button onClick={handleBulkSetPlan} loading={bulkBusy}>
                Apply
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
          ariaLabel={`Actions for ${family.name}`}
          items={[
            {
              label: 'Add child',
              icon: <UserPlusIcon className="h-4 w-4" />,
              onClick: onAddChild,
            },
            {
              label: 'Add task',
              icon: <ClipboardDocumentListIcon className="h-4 w-4" />,
              onClick: onAddTask,
            },
            {
              label: 'Edit family',
              icon: <PencilIcon className="h-4 w-4" />,
              onClick: onEdit,
            },
            {
              label: 'Delete family',
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
          <dt className="text-fg-muted">Wedding</dt>
          <dd className="tabular">{formatLocaleDate(family.weddingDate)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Members</dt>
          <dd className="tabular">{family.memberCount || 0}</dd>
        </div>
        {canMutate && (
          <>
        <div>
          <dt className="text-fg-muted">Plan</dt>
          <dd className="truncate">{planName}</dd>
        </div>
        <div className="text-right">
          <dt className="text-fg-muted">Balance</dt>
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
}: {
  formData: any
  setFormData: (data: any) => void
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
  editing: boolean
  paymentPlans: PaymentPlan[]
}) {
  const toast = useToast()
  const { format: formatMoney } = useCurrency()
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">Family Name *</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Family Name (Hebrew) *</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Husband First Name</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Husband First Name (Hebrew) *</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Husband&apos;s Father (Hebrew)</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Wife First Name</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Wife First Name (Hebrew) *</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Wife&apos;s Father (Hebrew)</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Husband Cell Phone</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Wife Cell Phone</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Street</label>
          <input
            type="text"
            autoComplete="street-address"
            value={formData.street}
            onChange={(e) => setFormData({ ...formData, street: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">City</label>
          <input
            type="text"
            autoComplete="address-level2"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">State</label>
          <input
            type="text"
            autoComplete="address-level1"
            value={formData.state}
            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">Email</label>
          <input
            type="email"
            autoComplete="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            onBlur={(e) => {
              if (e.target.value && !validateEmail(e.target.value)) {
                toast.error('Please enter a valid email address.')
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
              <span className="font-medium">Opt out of bulk statement emails</span>
              <span className="block text-xs text-fg-muted">
                Skip this family in &ldquo;Send via Email&rdquo; jobs and the monthly
                auto-email cron. Ad-hoc per-family sends from the family page are
                unaffected.
              </span>
            </span>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">Phone</label>
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
          <label className="block text-sm font-medium text-fg mb-1.5">Wedding Date *</label>
          <input
            type="date"
            required
            value={formData.weddingDate}
            onChange={(e) => setFormData({ ...formData, weddingDate: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">Payment Plan *</label>
          <select
            required
            value={formData.paymentPlanId || ''}
            onChange={(e) => setFormData({ ...formData, paymentPlanId: e.target.value })}
            className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none"
          >
            <option value="">Select a payment plan…</option>
            {paymentPlans.map((plan) => (
              <option key={plan._id} value={plan._id}>
                {plan.name} — {formatMoney(plan.yearlyPrice)}/year
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{editing ? 'Save changes' : 'Create family'}</Button>
      </div>
    </form>
  )
}
