'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import type React from 'react'
import { PrinterIcon, TagIcon } from '@heroicons/react/24/outline'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Button, EmptyState, Input } from '@/app/components/ui'
import { escapeHtml } from '@/lib/html-escape'
import {
  parseAgeInput,
  resolveAudience,
  type FamilyShape,
  type LabelRow,
  type MailLabelFilters,
  type MaritalFilter,
  type MemberShape,
  type RecipientToggles,
} from '@/lib/client/mail-label-audience'
import { cachedFetch } from '@/lib/client-cache'

/**
 * Mail Labels — Avery 5160 (3×10 grid, 30 labels/sheet, US Letter).
 *
 * No backend writes; the print path generates HTML in a new window
 * (mirroring the existing Kevittel print flow in SettingsView).
 *
 * Filters:
 *   - Payment plan (multi-select)
 *   - Balance: all / negative only (uses /api/families/balances)
 *   - Has address (default ON; excludes families with empty street)
 *   - Search by name
 *
 * Plus a "Print test sheet" button that prints empty boxes so admins
 * can verify alignment on a real sheet before wasting label stock.
 */

interface PlanShape {
  _id: string
  name: string
}

interface Props {
  families: FamilyShape[]
  plans: PlanShape[]
  filters: MailLabelFilters
  setFilters: React.Dispatch<React.SetStateAction<MailLabelFilters>>
}

// Avery 5160 exact dimensions in inches. Encoded as CSS literals so
// browsers won't drift the grid when zooming the print preview.
const AVERY_5160 = {
  pageMarginTop: '0.5in',
  pageMarginSide: '0.1875in',
  labelWidth: '2.625in',
  labelHeight: '1in',
  hGap: '0.125in',
  cols: 3,
  rows: 10,
}

const RECIPIENT_OPTIONS: Array<{ key: keyof RecipientToggles; label: string }> = [
  { key: 'household', label: 'Household' },
  { key: 'husband', label: 'Husband' },
  { key: 'wife', label: 'Wife' },
  { key: 'sons', label: 'Sons' },
  { key: 'daughters', label: 'Daughters' },
]

const MARITAL_OPTIONS: Array<{ value: MaritalFilter; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'unmarried', label: 'Unmarried only' },
  { value: 'married', label: 'Married only' },
]

/** Presets only pre-fill the controls below, so they stay adjustable afterwards. */
const PRESETS: Array<{ id: string; label: string; apply: Partial<MailLabelFilters> }> = [
  {
    id: 'ladies',
    label: 'Ladies',
    apply: {
      recipients: { household: false, husband: false, wife: true, sons: false, daughters: false },
      marital: 'any',
      minAge: null,
      maxAge: null,
    },
  },
  {
    id: 'bucherim',
    label: 'Bucherim',
    apply: {
      recipients: { household: false, husband: false, wife: false, sons: true, daughters: false },
      marital: 'unmarried',
      minAge: null,
      maxAge: null,
    },
  },
  {
    id: 'kids',
    label: 'Kids',
    apply: {
      recipients: { household: false, husband: false, wife: false, sons: true, daughters: true },
      marital: 'any',
      minAge: null,
      maxAge: null,
    },
  },
]

function buildLabelHTML(rows: LabelRow[]): string {
  // Pad the array up to a full sheet so the grid renders consistently.
  const perSheet = AVERY_5160.cols * AVERY_5160.rows
  const padded = rows.slice()
  while (padded.length % perSheet !== 0) {
    padded.push({ name: '', street: '', cityState: '' })
  }
  const cells = padded
    .map(
      (r) => `
        <div class="label">
          ${r.name ? `<div class="ln name">${escapeHtml(r.name)}</div>` : ''}
          ${r.street ? `<div class="ln">${escapeHtml(r.street)}</div>` : ''}
          ${r.cityState ? `<div class="ln">${escapeHtml(r.cityState)}</div>` : ''}
        </div>`,
    )
    .join('')

  return `<!doctype html>
<html>
<head>
<title>Mail Labels</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
  body {
    padding: ${AVERY_5160.pageMarginTop} ${AVERY_5160.pageMarginSide};
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${AVERY_5160.cols}, ${AVERY_5160.labelWidth});
    grid-auto-rows: ${AVERY_5160.labelHeight};
    column-gap: ${AVERY_5160.hGap};
    row-gap: 0;
  }
  .label {
    width: ${AVERY_5160.labelWidth};
    height: ${AVERY_5160.labelHeight};
    padding: 0.1in 0.15in;
    overflow: hidden;
    font-size: 10pt;
    line-height: 1.2;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .ln { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-weight: 600; }
  @media screen {
    body { background: #f3f4f6; }
    .label { background: #fff; outline: 1px dashed #cbd5e1; }
  }
</style>
</head>
<body>
  <div class="sheet">${cells}</div>
</body>
</html>`
}

function buildTestSheetHTML(): string {
  // Same grid, but every cell rendered as an empty outlined box so you
  // can hold the printed sheet against a real Avery 5160 to check
  // alignment. Useful on printers that apply non-zero default margins.
  const perSheet = AVERY_5160.cols * AVERY_5160.rows
  const cells = Array.from({ length: perSheet })
    .map((_, i) => `<div class="label"><div class="ln name">${i + 1}</div></div>`)
    .join('')
  return `<!doctype html>
<html>
<head>
<title>Label alignment test</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
  body { padding: ${AVERY_5160.pageMarginTop} ${AVERY_5160.pageMarginSide}; }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${AVERY_5160.cols}, ${AVERY_5160.labelWidth});
    grid-auto-rows: ${AVERY_5160.labelHeight};
    column-gap: ${AVERY_5160.hGap};
    row-gap: 0;
  }
  .label {
    width: ${AVERY_5160.labelWidth};
    height: ${AVERY_5160.labelHeight};
    outline: 1px solid #000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9pt;
    color: #6b7280;
  }
</style>
</head>
<body>
  <div class="sheet">${cells}</div>
</body>
</html>`
}

export default function MailLabelsPanel({ families, plans, filters, setFilters }: Props) {
  // Lazy-fetch balances only when the user actually flips the filter
  // to "negative" — otherwise the bulk call never runs.
  const [balanceMap, setBalanceMap] = useState<Map<string, number> | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const balanceFetchGenRef = useRef(0)

  // Members are only needed for Sons / Daughters, so households-only users
  // never pay for this request.
  const [membersByFamily, setMembersByFamily] = useState<Record<string, MemberShape[]>>({})
  const [membersLoading, setMembersLoading] = useState(false)
  const membersFetchGenRef = useRef(0)
  const hasFetchedMembersRef = useRef(false)

  const needMembers = filters.recipients.sons || filters.recipients.daughters

  useEffect(() => {
    if (!needMembers || hasFetchedMembersRef.current) return
    hasFetchedMembersRef.current = true
    const gen = ++membersFetchGenRef.current
    setMembersLoading(true)
    ;(async () => {
      try {
        const data = await cachedFetch<{ byFamily: Record<string, MemberShape[]> }>(
          '/api/family-members/all',
          { ttl: 30_000 },
        )
        if (gen !== membersFetchGenRef.current) return
        setMembersByFamily(data?.byFamily || {})
      } catch {
        // Best-effort: the preview simply shows no member rows.
      } finally {
        if (gen === membersFetchGenRef.current) setMembersLoading(false)
      }
    })()
  }, [needMembers])

  useEffect(() => {
    if (filters.balance !== 'negative' || balanceMap) return
    const gen = ++balanceFetchGenRef.current
    setBalancesLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/families/balances')
        if (gen !== balanceFetchGenRef.current) return
        if (!res.ok) return
        const data = await res.json().catch(() => [])
        if (gen !== balanceFetchGenRef.current) return
        const m = new Map<string, number>()
        for (const row of data || []) m.set(String(row.familyId), Number(row.balance || 0))
        setBalanceMap(m)
      } finally {
        if (gen === balanceFetchGenRef.current) setBalancesLoading(false)
      }
    })()
  }, [filters.balance, balanceMap])

  useOrgChanged(
    useCallback(() => {
      balanceFetchGenRef.current += 1
      setBalanceMap(null)
      membersFetchGenRef.current += 1
      hasFetchedMembersRef.current = false
      setMembersByFamily({})
    }, []),
  )

  // Family-level filters run first; person expansion happens only inside the
  // families that survive them.
  const filteredFamilies = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    return families.filter((f) => {
      const streetLine = (f.street || f.address || '').trim()
      if (filters.requireAddress && !streetLine) return false
      if (filters.planIds.length > 0) {
        const pid = f.paymentPlanId ? String(f.paymentPlanId) : ''
        if (!filters.planIds.includes(pid)) return false
      }
      if (filters.balance === 'negative') {
        // While balances are still loading, hide everything so we don't
        // momentarily print a full-org sheet by mistake.
        if (!balanceMap) return false
        const bal = balanceMap.get(String(f._id))
        if (bal === undefined || bal >= 0) return false
      }
      if (search) {
        const hay =
          `${f.name || ''} ${f.street || ''} ${f.address || ''} ${f.city || ''} ${f.state || ''} ${f.zip || ''}`.toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })
  }, [families, filters, balanceMap])

  const audience = useMemo(
    () => resolveAudience(filteredFamilies, membersByFamily, filters, new Date()),
    [filteredFamilies, membersByFamily, filters],
  )

  const previewRows = useMemo(() => audience.rows.slice(0, 12), [audience.rows])

  const handlePrint = () => {
    if (audience.rows.length === 0) {
      window.alert('No labels match the current filters.')
      return
    }
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(buildLabelHTML(audience.rows))
    w.document.close()
    w.focus()
    w.print()
  }

  const handleTestSheet = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(buildTestSheetHTML())
    w.document.close()
    w.focus()
    w.print()
  }

  const togglePlan = (planId: string) => {
    setFilters((prev) => {
      const has = prev.planIds.includes(planId)
      return {
        ...prev,
        planIds: has ? prev.planIds.filter((p) => p !== planId) : [...prev.planIds, planId],
      }
    })
  }

  return (
    <SettingsPanel
      icon={<TagIcon />}
      title="Mail Labels"
      description='Avery 5160 (30 labels per sheet, 1" × 2.625").'
      actions={
        <>
          <Button variant="secondary" onClick={handleTestSheet}>
            Print test sheet
          </Button>
          <Button leftIcon={<PrinterIcon className="h-4 w-4" />} onClick={handlePrint}>
            Print labels
          </Button>
        </>
      }
    >
      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Input
          label="Search by name or address"
          placeholder="Smith / Main St…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">Balance filter</label>
          <div className="flex gap-2">
            {(['all', 'negative'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, balance: opt }))}
                className={`focus-ring px-3 py-2 text-sm rounded-md border transition-colors ${
                  filters.balance === opt
                    ? 'bg-accent text-accent-fg border-accent'
                    : 'bg-surface text-fg border-border hover:bg-fg/5'
                }`}
              >
                {opt === 'all' ? 'All families' : 'Negative balance only'}
              </button>
            ))}
          </div>
          {filters.balance === 'negative' && balancesLoading && (
            <p className="text-xs text-fg-muted mt-1">Loading balances…</p>
          )}
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={filters.requireAddress}
              onChange={(e) => setFilters((f) => ({ ...f, requireAddress: e.target.checked }))}
              className="h-4 w-4 rounded border-border text-accent focus-ring"
            />
            Require street address (skip families with no mailing address)
          </label>
        </div>
      </div>
      {plans.length > 0 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-fg mb-1.5">
            Payment plans
            {filters.planIds.length > 0 && (
              <button
                type="button"
                className="ml-2 text-xs text-accent hover:underline"
                onClick={() => setFilters((f) => ({ ...f, planIds: [] }))}
              >
                Clear
              </button>
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => {
              const on = filters.planIds.includes(p._id)
              return (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => togglePlan(p._id)}
                  className={`focus-ring px-3 py-1.5 text-xs rounded-full border transition-colors ${
                    on
                      ? 'bg-accent text-accent-fg border-accent'
                      : 'bg-surface text-fg border-border hover:bg-fg/5'
                  }`}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
          {filters.planIds.length === 0 && (
            <p className="text-xs text-fg-muted mt-1">No plans selected = all plans.</p>
          )}
        </div>
      )}
      {/* Recipients — who inside each matching family gets a label */};
      <div className="mb-6">
        <label className="block text-sm font-medium text-fg mb-1.5">Recipients</label>
        <div className="flex flex-wrap gap-4">
          {RECIPIENT_OPTIONS.map(({ key, label }) => (
            <label
              key={key}
              className="inline-flex items-center gap-2 text-sm text-fg cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.recipients[key]}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    recipients: { ...f.recipients, [key]: e.target.checked },
                  }))
                }
                className="h-4 w-4 rounded border-border text-accent focus-ring"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs text-fg-muted mt-1">
          Household prints one label per family addressed to the family name. Everyone else prints
          one label per person, all sharing the household address.
        </p>
      </div>
      {/* Presets — shortcuts that pre-fill the controls above and below */};
      <div className="mb-6">
        <label className="block text-sm font-medium text-fg mb-1.5">Presets</label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, ...preset.apply }))}
              className="focus-ring px-3 py-1.5 text-xs rounded-full border border-border bg-surface text-fg hover:bg-fg/5 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      {/* Child-only filters — meaningless unless Sons or Daughters is selected */};
      <div
        className={`grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 ${needMembers ? '' : 'opacity-50'}`}
      >
        <div>
          <label className="block text-sm font-medium text-fg mb-1.5">Marital status</label>
          <div className="flex flex-wrap gap-2">
            {MARITAL_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                disabled={!needMembers}
                onClick={() => setFilters((f) => ({ ...f, marital: value }))}
                className={`focus-ring px-3 py-2 text-sm rounded-md border transition-colors disabled:cursor-not-allowed ${
                  filters.marital === value
                    ? 'bg-accent text-accent-fg border-accent'
                    : 'bg-surface text-fg border-border hover:bg-fg/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-muted mt-1">
            A bochur or unmarried girl is a child with no wedding date. Married children usually
            become their own family, so reach them with Household instead.
          </p>
        </div>
        <Input
          label="Minimum age"
          type="number"
          min={0}
          placeholder="Any"
          hint="Applies to sons and daughters."
          disabled={!needMembers}
          value={filters.minAge === null ? '' : String(filters.minAge)}
          onChange={(e) => setFilters((f) => ({ ...f, minAge: parseAgeInput(e.target.value) }))}
        />
        <Input
          label="Maximum age"
          type="number"
          min={0}
          placeholder="Any"
          hint="Both ages are inclusive."
          disabled={!needMembers}
          value={filters.maxAge === null ? '' : String(filters.maxAge)}
          onChange={(e) => setFilters((f) => ({ ...f, maxAge: parseAgeInput(e.target.value) }))}
        />
      </div>
      {/* Preview */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold text-fg">
            Preview ({audience.rows.length} {audience.rows.length === 1 ? 'label' : 'labels'})
          </h3>
          {audience.rows.length > previewRows.length && (
            <span className="text-xs text-fg-muted">Showing first {previewRows.length}.</span>
          )}
        </div>
        {membersLoading && <p className="text-xs text-fg-muted mb-2">Loading family members…</p>}
        {audience.skippedNoBirthDate > 0 && (
          <p className="text-xs text-fg-muted mb-2">
            {audience.skippedNoBirthDate} {audience.skippedNoBirthDate === 1 ? 'member' : 'members'}{' '}
            skipped — no birth date on file.
          </p>
        )}
        {audience.rows.length === 0 ? (
          <EmptyState
            title="No labels match the current filters"
            description="Adjust filters above or clear them to see all families with mailing addresses."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {previewRows.map((row, i) => (
              <div
                key={i}
                className="border border-dashed border-border rounded-md p-3 text-sm bg-app-subtle/40"
              >
                <div className="font-semibold text-fg truncate">{row.name || '—'}</div>
                <div className="text-fg-muted truncate">{row.street || ''}</div>
                <div className="text-fg-muted truncate">{row.cityState || ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsPanel>
  )
}
