/**
 * GET   /api/user/preferences — return the signed-in user's UI preferences.
 * PATCH /api/user/preferences — shallow-merge a partial preferences object.
 *
 * Currently stores per-table column visibility (`tableColumns`), but the shape
 * is intentionally extensible so we can add things like default sort order,
 * sidebar collapse state, etc. later without another migration.
 *
 * Validation is conservative:
 *   - `tableId` and `columnId` are constrained to slug-like strings (1-128 chars,
 *     [A-Za-z0-9._:-]) so we can never write arbitrary keys into the user doc.
 *   - Values must be booleans.
 *   - Whole document is capped at 64 tables × 64 columns each so a malicious
 *     client can't balloon the user document.
 */

import { z } from 'zod'
import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import { User } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const MAX_TABLES = 64
const MAX_COLUMNS_PER_TABLE = 64

const columnMap = z
  .record(z.string().regex(ID_PATTERN), z.boolean())
  .refine((v) => Object.keys(v).length <= MAX_COLUMNS_PER_TABLE, {
    message: `Too many columns (max ${MAX_COLUMNS_PER_TABLE} per table)`,
  })

const tableColumnsMap = z
  .record(z.string().regex(ID_PATTERN), columnMap)
  .refine((v) => Object.keys(v).length <= MAX_TABLES, {
    message: `Too many tables (max ${MAX_TABLES})`,
  })

const columnOrderList = z
  .array(z.string().regex(ID_PATTERN))
  .max(MAX_COLUMNS_PER_TABLE, `Too many columns (max ${MAX_COLUMNS_PER_TABLE} per table)`)

const tableColumnOrderMap = z
  .record(z.string().regex(ID_PATTERN), columnOrderList)
  .refine((v) => Object.keys(v).length <= MAX_TABLES, {
    message: `Too many tables (max ${MAX_TABLES})`,
  })

const patchBody = z.object({
  tableColumns: tableColumnsMap.optional(),
  tableColumnOrder: tableColumnOrderMap.optional(),
})

interface PreferencesShape {
  tableColumns: Record<string, Record<string, boolean>>
  tableColumnOrder: Record<string, string[]>
}

function normalize(raw: unknown): PreferencesShape {
  const p = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >

  // tableColumns
  const rawCols = p.tableColumns
  const tableColumns: Record<string, Record<string, boolean>> = {}
  if (rawCols && typeof rawCols === 'object' && !Array.isArray(rawCols)) {
    for (const [tableId, cols] of Object.entries(rawCols as Record<string, unknown>)) {
      if (!ID_PATTERN.test(tableId)) continue
      if (!cols || typeof cols !== 'object' || Array.isArray(cols)) continue
      const out: Record<string, boolean> = {}
      for (const [colId, visible] of Object.entries(cols as Record<string, unknown>)) {
        if (!ID_PATTERN.test(colId)) continue
        out[colId] = !!visible
      }
      tableColumns[tableId] = out
    }
  }

  // tableColumnOrder
  const rawOrder = p.tableColumnOrder
  const tableColumnOrder: Record<string, string[]> = {}
  if (rawOrder && typeof rawOrder === 'object' && !Array.isArray(rawOrder)) {
    for (const [tableId, ids] of Object.entries(rawOrder as Record<string, unknown>)) {
      if (!ID_PATTERN.test(tableId)) continue
      if (!Array.isArray(ids)) continue
      const seen = new Set<string>()
      const out: string[] = []
      for (const id of ids) {
        if (typeof id !== 'string' || !ID_PATTERN.test(id)) continue
        if (seen.has(id)) continue
        seen.add(id)
        out.push(id)
        if (out.length >= MAX_COLUMNS_PER_TABLE) break
      }
      tableColumnOrder[tableId] = out
    }
  }

  return { tableColumns, tableColumnOrder }
}

export const GET = handler({
  auth: 'session',
  name: 'GET /api/user/preferences',
  fn: async ({ session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'user-preferences-get',
      { limit: 120, windowMs: 60_000 },
      session!.user.id,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const user = await User.findById(session!.user.id).select('preferences').lean<any>()
    const prefs = normalize(user?.preferences)
    const res = NextResponse.json(prefs)
    res.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=300')
    return res
  },
})

export const PATCH = handler({
  auth: 'session',
  body: patchBody,
  name: 'PATCH /api/user/preferences',
  fn: async ({ session, body, request }) => {
    const verdict = await checkRateLimit(
      request,
      'user-preferences-update',
      { limit: 30, windowMs: 15 * 60_000 },
      session!.user.id,
    )
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const update: Record<string, unknown> = {}

    // Both fields shallow-merge per-table so writing `{ families: {...} }`
    // touches only the families entry. Read the current doc once and apply
    // both partial updates against it.
    if (body.tableColumns || body.tableColumnOrder) {
      const user = await User.findById(session!.user.id).select('preferences').lean<any>()
      const current = normalize(user?.preferences)

      if (body.tableColumns) {
        const merged: Record<string, Record<string, boolean>> = { ...current.tableColumns }
        for (const [tableId, cols] of Object.entries(body.tableColumns)) {
          merged[tableId] = { ...cols }
        }
        update['preferences.tableColumns'] = merged
      }

      if (body.tableColumnOrder) {
        const merged: Record<string, string[]> = { ...current.tableColumnOrder }
        for (const [tableId, ids] of Object.entries(body.tableColumnOrder)) {
          merged[tableId] = [...ids]
        }
        update['preferences.tableColumnOrder'] = merged
      }
    }

    if (Object.keys(update).length === 0) {
      return { status: 400, data: { error: 'Nothing to update.' } }
    }

    const updated = await User.findByIdAndUpdate(
      session!.user.id,
      { $set: update },
      { new: true },
    )
      .select('preferences')
      .lean<any>()

    return { data: normalize(updated?.preferences) }
  },
})
