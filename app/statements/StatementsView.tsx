'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  PlusIcon,
  PrinterIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentArrowDownIcon,
  EnvelopeIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'
import { useToast, useConfirm } from '@/app/components/Toast'
import { escapeHtml } from '@/lib/html-escape'
import { formatLocaleDate, isFiniteDate } from '@/lib/date-utils'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useCurrency } from '@/lib/client/useCurrency'
import { cachedFetch } from '@/lib/client-cache'
import { FAMILY_BALANCES_IDS_CAP } from '@/lib/schemas'
import { parseFamiliesListResponse } from '@/lib/client/families-list'
import {
  Button,
  Card,
  DataView,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonRows,
  Tabs,
  type DataColumn,
} from '@/app/components/ui'
import TaxReceiptsPanel from './TaxReceiptsPanel'

interface Statement {
  _id: string
  familyId: string
  statementNumber: string
  date: string
  fromDate: string
  toDate: string
  openingBalance: number
  income: number
  withdrawals: number
  expenses: number
  cycleCharges?: number
  closingBalance: number
}

interface Family {
  _id: string
  name: string
}

interface Transaction {
  type: string
  date: string
  description: string
  amount: number
  notes: string
}

const buildStatementTxColumns = (formatMoney: (v: number) => string): DataColumn<Transaction>[] => [
  {
    id: 'date',
    header: 'Date',
    headerText: 'Date',
    cell: (t) => <span className="tabular text-fg">{formatLocaleDate(t.date)}</span>,
    exportValue: (t) => (t.date ? new Date(t.date) : ''),
  },
  {
    id: 'type',
    header: 'Type',
    headerText: 'Type',
    cell: (t) => (
      <span
        className={`px-2 py-1 text-xs font-semibold rounded-full ${
          t.type === 'payment'
            ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'
            : t.type === 'withdrawal' || t.type === 'cycle-charge'
              ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'
              : 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'
        }`}
      >
        {t.type === 'payment'
          ? 'Payment'
          : t.type === 'withdrawal'
            ? 'Withdrawal'
            : t.type === 'cycle-charge'
              ? 'Annual Dues'
              : 'Event'}
      </span>
    ),
    exportValue: (t) => t.type,
  },
  {
    id: 'description',
    header: 'Description',
    headerText: 'Description',
    cell: (t) => <span className="text-fg">{t.description}</span>,
    exportValue: (t) => t.description || '',
  },
  {
    id: 'amount',
    header: 'Amount',
    headerText: 'Amount',
    align: 'right',
    cell: (t) => (
      <span
        className={`font-medium tabular ${
          t.amount >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
        }`}
      >
        {formatMoney(t.amount)}
      </span>
    ),
    exportValue: (t) => t.amount,
  },
  {
    id: 'notes',
    header: 'Notes',
    headerText: 'Notes',
    hideBelow: 'lg',
    defaultHidden: true,
    cell: (t) => <span className="text-fg text-sm">{t.notes || '—'}</span>,
    exportValue: (t) => t.notes || '',
  },
]

export interface StatementsViewProps {
  initialStatements?: Statement[]
}

export default function StatementsView({ initialStatements }: StatementsViewProps = {}) {
  const toast = useToast()
  const confirm = useConfirm()
  const { format: formatMoney } = useCurrency()
  const statementTxColumns = useMemo(() => buildStatementTxColumns(formatMoney), [formatMoney])
  const statementsHydrated = initialStatements !== undefined
  const [statements, setStatements] = useState<Statement[]>(initialStatements ?? [])
  const [familyNameById, setFamilyNameById] = useState<Record<string, string>>({})
  const [pickerFamilies, setPickerFamilies] = useState<Family[]>([])
  const [pickerSearch, setPickerSearch] = useState('')
  const [debouncedPickerSearch, setDebouncedPickerSearch] = useState('')
  const [pickerLoading, setPickerLoading] = useState(false)
  const [loading, setLoading] = useState(!statementsHydrated)
  const [error, setError] = useState(false)
  const hasFetchedRef = useRef(statementsHydrated)
  const hasFetchedPickerFamiliesRef = useRef(false)
  const pickerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const pollGenRef = useRef(0)
  const { begin, invalidate, isStale } = useRequestGeneration()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const [showModal, setShowModal] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  // 'statements' vs 'receipts' top-level view. We default to 'statements'
  // so existing deep-links and muscle memory keep working.
  const [view, setView] = useState<'statements' | 'receipts'>('statements')
  const [sendingEmails, setSendingEmails] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [autoGenerating, setAutoGenerating] = useState(false)
  const [emailResult, setEmailResult] = useState<{
    sent: number
    failed: number
    errors: string[]
  } | null>(null)
  const [expandedStatement, setExpandedStatement] = useState<string | null>(null)
  const [statementDetails, setStatementDetails] = useState<{ [key: string]: Transaction[] }>({})
  const [formData, setFormData] = useState({ familyId: '', fromDate: '', toDate: '' })
  const [emailFormData, setEmailFormData] = useState({
    email: '',
    password: '',
    fromName: 'Kasa Family Management',
    fromDate: '',
    toDate: '',
  })
  const [emailConfig, setEmailConfig] = useState<any>(null)
  const [saveEmailConfig, setSaveEmailConfig] = useState(false)

  const getFamilyName = useCallback(
    (familyId: string) => familyNameById[familyId] || 'N/A',
    [familyNameById],
  )

  const resolveFamilyNames = useCallback(
    async (familyIds: string[]) => {
      const gen = begin()
      const unique = [...new Set(familyIds.filter(Boolean))]
      if (unique.length === 0) return
      const chunks: string[][] = []
      for (let i = 0; i < unique.length; i += FAMILY_BALANCES_IDS_CAP) {
        chunks.push(unique.slice(i, i + FAMILY_BALANCES_IDS_CAP))
      }
      try {
        const results = await Promise.all(
          chunks.map(async (chunk) => {
            const data = await cachedFetch<{ names?: Record<string, string> }>(
              `/api/families?view=names&familyIds=${chunk.join(',')}`,
              { ttl: 60_000 },
            )
            if (isStale(gen)) return null
            return data?.names ?? {}
          }),
        )
        if (isStale(gen)) return
        setFamilyNameById((prev) => {
          const next = { ...prev }
          for (const names of results) {
            if (!names) continue
            for (const [id, name] of Object.entries(names)) {
              if (name) next[id] = name
            }
          }
          return next
        })
      } catch {
        /* keep existing names */
      }
    },
    [begin, isStale],
  )

  const fetchPickerFamilies = useCallback(async () => {
    const gen = begin()
    setPickerLoading(true)
    try {
      const data = await cachedFetch('/api/families?limit=20', { ttl: 30_000 })
      if (isStale(gen)) return
      const { items } = parseFamiliesListResponse<Family>(data)
      setPickerFamilies(items)
    } catch {
      if (!isStale(gen)) setPickerFamilies([])
    } finally {
      if (!isStale(gen)) setPickerLoading(false)
    }
  }, [begin, isStale])

  const filteredPickerFamilies = useMemo(() => {
    const q = debouncedPickerSearch.trim().toLowerCase()
    if (!q) return pickerFamilies
    return pickerFamilies.filter((f) => f.name.toLowerCase().includes(q))
  }, [pickerFamilies, debouncedPickerSearch])

  const fetchData = useCallback(async () => {
    const gen = begin()
    setError(false)
    try {
      const statementsRes = await fetch('/api/statements')
      if (isStale(gen)) return
      if (!statementsRes.ok) throw new Error()
      const statementsData = await statementsRes.json()
      if (isStale(gen)) return

      const statementsList: Statement[] = Array.isArray(statementsData)
        ? statementsData
        : Array.isArray(statementsData?.items)
          ? statementsData.items
          : []

      const now = new Date()
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

      const lastMonthStatements = statementsList.filter((stmt: Statement) => {
        const stmtDate = new Date(stmt.fromDate)
        return stmtDate >= lastMonth && stmtDate <= lastMonthEnd
      })
      const sortedStatements = [...lastMonthStatements].sort(
        (a: Statement, b: Statement) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      )
      setStatements(sortedStatements)
      void resolveFamilyNames(sortedStatements.map((s) => s.familyId))
    } catch {
      if (isStale(gen)) return
      setError(true)
      toast.error('Could not load statements.')
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [toast, begin, isStale, resolveFamilyNames])

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchData()
    }
    // Default email date range to last month.
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    setEmailFormData((prev) => ({
      ...prev,
      fromDate: lastMonth.toISOString().split('T')[0],
      toDate: lastMonthEnd.toISOString().split('T')[0],
    }))

    // Load saved email config (best-effort).
    // API returns 200 + `{ configured: false }` when no config exists yet
    // — only fill the form when there's a real email on file.
    fetch('/api/email-config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.configured !== false && data.email) {
          setEmailConfig(data)
          setEmailFormData((prev) => ({
            ...prev,
            email: data.email,
            fromName: data.fromName || 'Kasa Family Management',
          }))
        }
      })
      .catch(() => {})
  }, [fetchData])

  useEffect(() => {
    if (statementsHydrated && statements.length > 0) {
      void resolveFamilyNames(statements.map((s) => s.familyId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!showModal) {
      hasFetchedPickerFamiliesRef.current = false
      setPickerSearch('')
      setDebouncedPickerSearch('')
      return
    }
    if (hasFetchedPickerFamiliesRef.current) return
    hasFetchedPickerFamiliesRef.current = true
    void fetchPickerFamilies()
  }, [showModal, fetchPickerFamilies])

  useEffect(() => {
    if (!showModal) return
    if (pickerDebounceRef.current) clearTimeout(pickerDebounceRef.current)
    pickerDebounceRef.current = setTimeout(() => {
      setDebouncedPickerSearch(pickerSearch)
    }, 300)
    return () => {
      if (pickerDebounceRef.current) clearTimeout(pickerDebounceRef.current)
    }
  }, [showModal, pickerSearch])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      pollGenRef.current += 1
      hasFetchedRef.current = false
      hasFetchedPickerFamiliesRef.current = false
      setStatements([])
      setFamilyNameById({})
      setPickerFamilies([])
      setPickerSearch('')
      setDebouncedPickerSearch('')
      setStatementDetails({})
      setExpandedStatement(null)
      // Clear cross-tenant email config + UI state. Without this the
      // previous org's Gmail "from" address and any partially-typed
      // password would stay visible after switching orgs.
      setEmailConfig(null)
      setEmailFormData((prev) => ({
        ...prev,
        email: '',
        password: '',
        fromName: 'Kasa Family Management',
      }))
      setEmailResult(null)
      setSendingEmails(false)
      setGenerating(false)
      setAutoGenerating(false)
      setLoading(true)
      fetchData()
    }, [fetchData, invalidate]),
  )

  const fetchStatementDetails = async (statementId: string) => {
    if (statementDetails[statementId]) {
      setExpandedStatement(expandedStatement === statementId ? null : statementId)
      return
    }
    try {
      const res = await fetch(`/api/statements/${statementId}`)
      if (!res.ok) {
        toast.error('Could not load statement details.')
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data.transactions) {
        setStatementDetails((prev) => ({ ...prev, [statementId]: data.transactions }))
        setExpandedStatement(statementId)
      } else {
        toast.error('Could not load statement details.')
      }
    } catch {
      toast.error('Could not load statement details.')
    }
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    // Re-entrancy: bail if a generate is already in flight. Submit
    // buttons usually `disabled={generating}`, but Enter-key submits
    // and fast double-clicks can still slip through React's render
    // boundary.
    if (generating) return
    if (!formData.fromDate || !formData.toDate) {
      toast.error('Both from and to dates are required')
      return
    }
    const from = new Date(formData.fromDate)
    const to = new Date(formData.toDate)
    if (!isFiniteDate(from) || !isFiniteDate(to)) {
      toast.error('Invalid date range')
      return
    }
    if (from.getTime() > to.getTime()) {
      toast.error('From date must be on or before to date')
      return
    }
    setGenerating(true)
    try {
      const res = await fetch('/api/statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        setShowModal(false)
        setFormData({ familyId: '', fromDate: '', toDate: '' })
        fetchData()
        toast.success('Statement generated.')
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || 'Could not generate statement.')
      }
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const handlePrint = async (statement: Statement) => {
    const familyName = getFamilyName(statement.familyId)
    const transactions = statementDetails[statement._id] || []

    if (transactions.length === 0) {
      try {
        const res = await fetch(`/api/statements/${statement._id}`)
        if (!res.ok) {
          toast.error('Could not load statement for printing.')
        } else {
          const data = await res.json().catch(() => ({}))
          if (data.transactions) transactions.push(...data.transactions)
        }
      } catch {
        toast.error('Could not load statement for printing.')
      }
    }

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      const transactionsHTML =
        transactions.length > 0
          ? `
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
            ${transactions
              .map(
                (t: Transaction) => `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(new Date(t.date).toLocaleDateString())}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${t.type === 'payment' ? 'Payment' : t.type === 'withdrawal' ? 'Withdrawal' : t.type === 'cycle-charge' ? 'Annual Dues' : 'Event'}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(t.description)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; ${t.amount >= 0 ? 'color: green;' : 'color: red;'}">${t.amount >= 0 ? '+' : ''}${escapeHtml(formatMoney(t.amount))}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(t.notes || '-')}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      `
          : ''

      printWindow.document.write(`
        <html>
          <head>
            <title>Statement ${escapeHtml(statement.statementNumber)}</title>
            <style>
              @media print { @page { margin: 1cm; } body { margin: 0; } }
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
                  <td style="padding: 5px 0;"><strong>Family:</strong> ${escapeHtml(familyName === 'N/A' ? 'N/A' : familyName)}</td>
                  <td style="padding: 5px 0; text-align: right;"><strong>Period:</strong> ${escapeHtml(new Date(statement.fromDate).toLocaleDateString())} - ${escapeHtml(new Date(statement.toDate).toLocaleDateString())}</td>
                </tr>
              </table>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
              <tr><td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Opening Balance:</strong></td><td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;">${escapeHtml(formatMoney(statement.openingBalance))}</td></tr>
              <tr><td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Income:</strong></td><td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: green;">${escapeHtml(formatMoney(statement.income))}</td></tr>
              <tr><td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Withdrawals:</strong></td><td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${escapeHtml(formatMoney(statement.withdrawals))}</td></tr>
              ${(statement.cycleCharges || 0) > 0 ? `<tr><td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Annual Dues Charged:</strong></td><td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: orange;">${escapeHtml(formatMoney(statement.cycleCharges || 0))}</td></tr>` : ''}
              <tr><td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>Expenses:</strong></td><td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; color: red;">${escapeHtml(formatMoney(statement.expenses))}</td></tr>
              <tr style="background-color: #f0f0f0;"><td style="padding: 10px; font-weight: bold; font-size: 1.1em;">Closing Balance:</td><td style="padding: 10px; text-align: right; font-weight: bold; font-size: 1.1em;">${escapeHtml(formatMoney(statement.closingBalance))}</td></tr>
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
  }

  const handleSendEmails = async (e: React.FormEvent) => {
    e.preventDefault()
    // Re-entrancy guard — see handleGenerate. Re-clicking Send
    // would otherwise queue a second batch on top of the running one.
    if (sendingEmails) return
    setSendingEmails(true)
    setEmailResult(null)

    try {
      if (saveEmailConfig) {
        const saveRes = await fetch('/api/email-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailFormData.email,
            password: emailFormData.password,
            fromName: emailFormData.fromName,
          }),
        })
        if (!saveRes.ok) {
          const err = await saveRes.json().catch(() => ({}))
          throw new Error(err.error || 'Failed to save email configuration')
        }
        const savedConfig = await saveRes.json().catch(() => ({}))
        setEmailConfig(savedConfig)
      }

      const res = await fetch('/api/statements/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDate: emailFormData.fromDate,
          toDate: emailFormData.toDate,
        }),
      })
      if (!res.ok) {
        const enqueueResult = await res.json().catch(() => ({}))
        toast.error(enqueueResult.error || 'Failed to send emails.')
        return
      }
      const enqueueResult = await res.json().catch(() => ({}))

      // Empty path: when no families have email addresses, the API returns
      // 200 + {sent:0, failed:0} synchronously and there's nothing to poll.
      if (!enqueueResult.jobId) {
        setEmailResult({
          sent: enqueueResult.sent || 0,
          failed: enqueueResult.failed || 0,
          errors: enqueueResult.errors || [],
        })
        return
      }

      // Async path: the server enqueued a background job. Poll the status
      // endpoint every 2s until the job reports done.
      const jobId = enqueueResult.jobId as string
      const total = enqueueResult.totalFamilies as number
      toast.success(`Queued ${total} statement${total === 1 ? '' : 's'} — sending in background.`)

      const pollGen = ++pollGenRef.current
      const startedAt = Date.now()
      const TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
      let final: { sent: number; failed: number; errors: string[] } | null = null
      while (Date.now() - startedAt < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 2000))
        if (!mountedRef.current || pollGen !== pollGenRef.current) return
        try {
          const sres = await fetch(
            `/api/statements/send-emails/status?jobId=${encodeURIComponent(jobId)}`,
          )
          if (!mountedRef.current || pollGen !== pollGenRef.current) return
          if (!sres.ok) continue
          const status = await sres.json()
          if (status.done) {
            final = {
              sent: status.sent || 0,
              failed: status.failed || 0,
              errors: status.errors || [],
            }
            break
          }
        } catch {
          // transient — keep polling
        }
      }

      if (!mountedRef.current || pollGen !== pollGenRef.current) return

      if (!final) {
        toast.error('Email job is still running — check back later.')
        return
      }

      setEmailResult(final)
      if (final.sent > 0) {
        fetchData()
        toast.success(`Sent ${final.sent} statement${final.sent === 1 ? '' : 's'}.`)
      }
      if (saveEmailConfig) {
        setEmailFormData((prev) => ({ ...prev, password: '' }))
      }
    } catch (error: any) {
      if (mountedRef.current) toast.error(error.message || 'Failed to send emails.')
    } finally {
      if (mountedRef.current) setSendingEmails(false)
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 md:p-8 bg-app-subtle">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Statements"
          subtitle="View and generate financial statements."
          actions={
            <>
              <Button
                variant="secondary"
                leftIcon={<EnvelopeIcon className="h-5 w-5" />}
                onClick={() => setShowEmailModal(true)}
              >
                <span className="hidden sm:inline">Send via Email</span>
                <span className="sm:hidden">Email</span>
              </Button>
              <Button
                variant="secondary"
                leftIcon={<CalendarIcon className="h-5 w-5" />}
                loading={autoGenerating}
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Generate monthly batch',
                      message: 'Generate this month\u2019s statement for every family at once?',
                    })
                  ) {
                    setAutoGenerating(true)
                    try {
                      const res = await fetch('/api/statements/auto-generate', { method: 'POST' })
                      if (!res.ok) {
                        const result = await res.json().catch(() => ({}))
                        toast.error(result.error || 'Failed to generate statements.')
                        return
                      }
                      const result = await res.json().catch(() => ({}))
                      toast.success(`Successfully generated ${result.generated} statements.`)
                      fetchData()
                    } catch {
                      toast.error('Network error — please try again.')
                    } finally {
                      setAutoGenerating(false)
                    }
                  }
                }}
              >
                <span className="hidden sm:inline">Generate Monthly Batch</span>
                <span className="sm:hidden">Batch</span>
              </Button>
              <Button
                leftIcon={<PlusIcon className="h-5 w-5" />}
                onClick={() => setShowModal(true)}
              >
                Generate
              </Button>
            </>
          }
        />

        {/* Top-level switcher between the existing statements view and the
            new year-end tax-receipts workflow. Kept inline (not deep-linked)
            because receipts are a print-once-per-year flow — not worth a
            URL slot, and matches the rest of the page's modal-driven UX. */}
        <Card compact className="mb-6">
          <Tabs
            label="Statements sections"
            activeId={view}
            onChange={(id) => setView(id as 'statements' | 'receipts')}
            items={[
              {
                id: 'statements',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <DocumentTextIcon className="h-4 w-4" aria-hidden="true" /> Statements
                  </span>
                ),
              },
              {
                id: 'receipts',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <DocumentArrowDownIcon className="h-4 w-4" aria-hidden="true" /> Tax Receipts
                  </span>
                ),
              },
            ]}
          />
        </Card>

        {view === 'receipts' ? (
          <TaxReceiptsPanel />
        ) : (
          <Card noPadding>
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-fg">Last Month&apos;s Statements</h2>
              <p className="text-sm text-fg-muted">
                Showing statements from{' '}
                {new Date(
                  new Date().getFullYear(),
                  new Date().getMonth() - 1,
                  1,
                ).toLocaleDateString()}{' '}
                to{' '}
                {new Date(new Date().getFullYear(), new Date().getMonth(), 0).toLocaleDateString()}.
              </p>
            </div>

            {loading ? (
              <div className="p-6">
                <SkeletonRows count={5} />
              </div>
            ) : error ? (
              <div className="p-6">
                <EmptyState
                  icon={<ExclamationTriangleIcon />}
                  title="Couldn't load statements"
                  description="Check your connection and try again."
                  cta={{ label: 'Retry', onClick: () => fetchData() }}
                />
              </div>
            ) : (
              <div className="p-4 sm:p-6">
                <DataView<Statement>
                  tableId="statements"
                  rows={statements}
                  rowKey={(s) => s._id}
                  tableFrom="never"
                  globalSearch={{
                    placeholder: 'Search statement #, family…',
                    getValue: (s) => {
                      const name = getFamilyName(s.familyId)
                      return [s.statementNumber, name === 'N/A' ? '' : name]
                        .filter(Boolean)
                        .join(' ')
                    },
                  }}
                  pageSize={10}
                  columns={[
                    {
                      id: 'statementNumber',
                      header: 'Statement #',
                      headerText: 'Statement #',
                      cell: (s) => s.statementNumber,
                      filter: { type: 'text' },
                    },
                    {
                      id: 'family',
                      header: 'Family',
                      headerText: 'Family',
                      cell: (s) => getFamilyName(s.familyId),
                      exportValue: (s) => {
                        const name = getFamilyName(s.familyId)
                        return name === 'N/A' ? '' : name
                      },
                      filter: {
                        type: 'select',
                        getValue: (s) => {
                          const name = getFamilyName(s.familyId)
                          return name === 'N/A' ? '' : name
                        },
                      },
                    },
                    {
                      id: 'fromDate',
                      header: 'From',
                      headerText: 'From',
                      cell: (s) => formatLocaleDate(s.fromDate),
                      exportValue: (s) => (s.fromDate ? new Date(s.fromDate) : ''),
                      filter: { type: 'dateRange', getValue: (s) => s.fromDate || null },
                    },
                    {
                      id: 'toDate',
                      header: 'To',
                      headerText: 'To',
                      cell: (s) => formatLocaleDate(s.toDate),
                      exportValue: (s) => (s.toDate ? new Date(s.toDate) : ''),
                      filter: { type: 'dateRange', getValue: (s) => s.toDate || null },
                    },
                    {
                      id: 'openingBalance',
                      header: 'Opening',
                      headerText: 'Opening Balance',
                      // Desktop table previously rendered the raw number
                      // (e.g. `12.3456789` from float math); mobile cards
                      // used `formatMoney`. Same column should respect the
                      // org's currency formatter on both surfaces.
                      cell: (s) => formatMoney(Number(s.openingBalance ?? 0)),
                      exportValue: (s) => s.openingBalance ?? 0,
                      filter: { type: 'numberRange', getValue: (s) => s.openingBalance ?? 0 },
                    },
                    {
                      id: 'income',
                      header: 'Income',
                      headerText: 'Income',
                      cell: (s) => formatMoney(Number(s.income ?? 0)),
                      exportValue: (s) => s.income ?? 0,
                    },
                    {
                      id: 'withdrawals',
                      header: 'Withdrawals',
                      headerText: 'Withdrawals',
                      cell: (s) => formatMoney(Number(s.withdrawals ?? 0)),
                      exportValue: (s) => s.withdrawals ?? 0,
                    },
                    {
                      id: 'expenses',
                      header: 'Expenses',
                      headerText: 'Expenses',
                      cell: (s) => formatMoney(Number(s.expenses ?? 0)),
                      exportValue: (s) => s.expenses ?? 0,
                    },
                    {
                      id: 'closingBalance',
                      header: 'Closing',
                      headerText: 'Closing Balance',
                      cell: (s) => formatMoney(Number(s.closingBalance ?? 0)),
                      exportValue: (s) => s.closingBalance ?? 0,
                      filter: { type: 'numberRange', getValue: (s) => s.closingBalance ?? 0 },
                    },
                  ]}
                  mobileCard={(statement) => {
                    const familyName = getFamilyName(statement.familyId)
                    const familyId = statement.familyId
                    const isExpanded = expandedStatement === statement._id
                    const transactions = statementDetails[statement._id] || []
                    return (
                      <Card compact className="hover:bg-app-subtle transition-colors">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 flex-1 min-w-0">
                            <div>
                              <div className="text-xs text-fg-muted">Statement #</div>
                              <div className="font-medium text-fg truncate">
                                {statement.statementNumber}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-fg-muted">Family</div>
                              {familyName !== 'N/A' ? (
                                <Link
                                  href={`/families/${familyId}`}
                                  className="focus-ring font-medium text-accent hover:text-accent-hover hover:underline rounded"
                                >
                                  {familyName}
                                </Link>
                              ) : (
                                <div className="font-medium text-fg-muted">N/A</div>
                              )}
                            </div>
                            <div className="col-span-2 sm:col-span-1">
                              <div className="text-xs text-fg-muted">Period</div>
                              <div className="text-sm">
                                {new Date(statement.fromDate).toLocaleDateString()} —{' '}
                                {new Date(statement.toDate).toLocaleDateString()}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-fg-muted">Opening Balance</div>
                              <div className="font-medium">
                                {formatMoney(statement.openingBalance)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-fg-muted">Closing Balance</div>
                              <div className="font-bold text-base sm:text-lg text-fg">
                                {formatMoney(statement.closingBalance)}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1 lg:ml-4">
                            <button
                              onClick={() => fetchStatementDetails(statement._id)}
                              className="focus-ring inline-flex items-center gap-1 px-3 py-2 text-sm text-accent hover:text-accent-hover hover:bg-accent/10 rounded-lg"
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? (
                                <ChevronUpIcon className="h-5 w-5" aria-hidden="true" />
                              ) : (
                                <ChevronDownIcon className="h-5 w-5" aria-hidden="true" />
                              )}
                              {isExpanded ? 'Hide' : 'View'} Details
                            </button>
                            <button
                              onClick={() => handlePrint(statement)}
                              aria-label={`Print statement ${statement.statementNumber}`}
                              title="Print"
                              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-fg hover:bg-fg/5"
                            >
                              <PrinterIcon className="h-5 w-5" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => handlePrint(statement)}
                              aria-label={`Save statement ${statement.statementNumber} as PDF`}
                              title="Save as PDF"
                              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-green-700 hover:bg-green-50"
                            >
                              <DocumentArrowDownIcon className="h-5 w-5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-sm">
                          <div>
                            <span className="text-fg-muted">Income: </span>
                            <span className="font-medium text-green-700">
                              {formatMoney(statement.income)}
                            </span>
                          </div>
                          <div>
                            <span className="text-fg-muted">Withdrawals: </span>
                            <span className="font-medium text-orange-700">
                              {formatMoney(statement.withdrawals)}
                            </span>
                          </div>
                          <div>
                            <span className="text-fg-muted">Expenses: </span>
                            <span className="font-medium text-red-700">
                              {formatMoney(statement.expenses)}
                            </span>
                          </div>
                        </div>

                        {isExpanded && transactions.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-border animate-ui-fade">
                            <h3 className="font-semibold mb-4 text-fg">Transaction Details</h3>
                            <DataView
                              tableId="statement-transactions"
                              rows={transactions}
                              columns={statementTxColumns}
                              rowKey={(_t, i) => String(i)}
                              exportFileName={`statement-${statement.statementNumber || statement._id}-transactions`}
                              pageSize={10}
                              globalSearch={{ placeholder: 'Search…' }}
                              mobileCard={(t) => (
                                <div className="surface-card p-3 text-sm">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="text-fg">{t.description}</div>
                                    <div
                                      className={`font-medium tabular ${
                                        t.amount >= 0
                                          ? 'text-green-700 dark:text-green-400'
                                          : 'text-red-700 dark:text-red-400'
                                      }`}
                                    >
                                      {formatMoney(t.amount)}
                                    </div>
                                  </div>
                                  <div className="mt-1 flex justify-between text-xs text-fg-muted">
                                    <span>{t.type}</span>
                                    <span className="tabular">
                                      {new Date(t.date).toLocaleDateString()}
                                    </span>
                                  </div>
                                </div>
                              )}
                            />
                          </div>
                        )}
                      </Card>
                    )
                  }}
                  empty={
                    <EmptyState
                      icon={<DocumentTextIcon className="h-10 w-10" />}
                      title="No statements for last month"
                      description="Generate monthly statements for all your families in one click, or create a single statement for a specific family."
                      cta={{ label: 'Generate Statement', onClick: () => setShowModal(true) }}
                      secondaryCta={{
                        label: 'Generate Monthly Batch',
                        onClick: async () => {
                          setAutoGenerating(true)
                          try {
                            const res = await fetch('/api/statements/auto-generate', {
                              method: 'POST',
                            })
                            if (!res.ok) {
                              const result = await res.json().catch(() => ({}))
                              toast.error(result.error || 'Failed to generate statements.')
                              return
                            }
                            const result = await res.json().catch(() => ({}))
                            toast.success(`Successfully generated ${result.generated} statements.`)
                            fetchData()
                          } catch {
                            toast.error('Network error.')
                          } finally {
                            setAutoGenerating(false)
                          }
                        },
                      }}
                    />
                  }
                />
              </div>
            )}
          </Card>
        )}

        {/* Generate Single Statement */}
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title="Generate Statement"
          maxWidth="max-w-md"
        >
          <form onSubmit={handleGenerate} className="space-y-4" noValidate>
            <Input
              label="Search families"
              type="search"
              placeholder="Type to filter…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
            <Select
              label="Family"
              required
              value={formData.familyId}
              onChange={(e) => setFormData({ ...formData, familyId: e.target.value })}
              disabled={pickerLoading}
            >
              <option value="">{pickerLoading ? 'Loading families…' : 'Select a family'}</option>
              {filteredPickerFamilies.map((family) => (
                <option key={family._id} value={family._id}>
                  {family.name}
                </option>
              ))}
            </Select>
            <Input
              label="From Date"
              type="date"
              required
              value={formData.fromDate}
              onChange={(e) => setFormData({ ...formData, fromDate: e.target.value })}
            />
            <Input
              label="To Date"
              type="date"
              required
              value={formData.toDate}
              onChange={(e) => setFormData({ ...formData, toDate: e.target.value })}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={generating}>
                Generate
              </Button>
            </div>
          </form>
        </Modal>

        {/* Send Email Modal */}
        <Modal
          open={showEmailModal}
          onClose={() => {
            setShowEmailModal(false)
            setEmailResult(null)
          }}
          title="Send Statements via Email"
          description="Send PDF statements to all families with email addresses for the selected date range."
          maxWidth="max-w-md"
        >
          {emailResult && (
            <div
              className={`mb-4 p-4 rounded-lg ${
                emailResult.failed > 0
                  ? 'bg-yellow-50 border border-yellow-200'
                  : 'bg-green-50 border border-green-200'
              }`}
            >
              <p
                className={`font-semibold ${emailResult.failed > 0 ? 'text-yellow-800' : 'text-green-800'}`}
              >
                Sent: {emailResult.sent} · Failed: {emailResult.failed}
              </p>
              {emailResult.errors.length > 0 && (
                <div className="mt-2 text-sm text-yellow-700">
                  <p className="font-semibold">Errors:</p>
                  <ul className="list-disc list-inside mt-1">
                    {emailResult.errors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSendEmails} className="space-y-4" noValidate>
            {!emailConfig?.email ? (
              <>
                <Input
                  label="Gmail Address"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="your-email@gmail.com"
                  hint="Gmail account to send from."
                  value={emailFormData.email}
                  onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
                />
                <Input
                  label="Gmail App Password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="16-character app password"
                  value={emailFormData.password}
                  onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
                />
                <p className="text-xs text-fg-muted -mt-2">
                  Generate an app password from{' '}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Google Account Settings
                  </a>
                  .
                </p>
                <Input
                  label="From Name"
                  type="text"
                  value={emailFormData.fromName}
                  onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
                />
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={saveEmailConfig}
                    onChange={(e) => setSaveEmailConfig(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Save email configuration (one-time setup).
                </label>
              </>
            ) : (
              <>
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    <strong>✓ Email configuration saved:</strong> {emailConfig.email}
                  </p>
                  <p className="text-xs text-green-700 mt-1">
                    Your email settings are stored and will be used automatically.
                  </p>
                </div>
                <details className="border border-border rounded-lg p-3">
                  <summary className="cursor-pointer text-sm font-medium text-fg">
                    Update email configuration (optional)
                  </summary>
                  <div className="mt-3 space-y-3">
                    <Input
                      label="Gmail Address"
                      type="email"
                      autoComplete="email"
                      value={emailFormData.email}
                      onChange={(e) =>
                        setEmailFormData({ ...emailFormData, email: e.target.value })
                      }
                    />
                    <Input
                      label="Gmail App Password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Leave empty to keep current password"
                      value={emailFormData.password}
                      onChange={(e) =>
                        setEmailFormData({ ...emailFormData, password: e.target.value })
                      }
                    />
                    <Input
                      label="From Name"
                      type="text"
                      value={emailFormData.fromName}
                      onChange={(e) =>
                        setEmailFormData({ ...emailFormData, fromName: e.target.value })
                      }
                    />
                    <label className="flex items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={saveEmailConfig}
                        onChange={(e) => setSaveEmailConfig(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Update saved configuration
                    </label>
                  </div>
                </details>
              </>
            )}
            <Input
              label="Statement Period — From Date"
              type="date"
              required
              value={emailFormData.fromDate}
              onChange={(e) => setEmailFormData({ ...emailFormData, fromDate: e.target.value })}
            />
            <Input
              label="Statement Period — To Date"
              type="date"
              required
              value={emailFormData.toDate}
              onChange={(e) => setEmailFormData({ ...emailFormData, toDate: e.target.value })}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowEmailModal(false)
                  setEmailResult(null)
                }}
                disabled={sendingEmails}
              >
                Cancel
              </Button>
              <Button type="submit" loading={sendingEmails} variant="primary">
                Send Emails
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </main>
  )
}
