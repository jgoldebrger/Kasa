'use client'

/**
 * useColumnVisibility — per-table column show/hide state AND column order,
 * persisted **per user** on the server so preferences follow the user across
 * devices.
 *
 * Architecture:
 *   1. First render returns the column defaults (SSR-safe).
 *   2. On mount, hydrate from the in-memory snapshot (filled on the
 *      first call by `GET /api/user/preferences`). Falls back to a
 *      localStorage mirror if the network/auth is unavailable.
 *   3. Each toggle / reorder updates local state immediately, mirrors to
 *      localStorage, and debounces a `PATCH /api/user/preferences` so
 *      rapid changes become a single network write.
 *
 * The localStorage mirror (keys: `kasa.cols.{tableId}` for visibility,
 * `kasa.colorder.{tableId}` for order) is kept for two reasons:
 *   - Instant restore on reload without waiting for the network.
 *   - Offline / signed-out fallback so the picker still feels responsive.
 *
 * The hook always enforces at least one visible column.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface ColumnDef {
  id: string
  defaultHidden?: boolean
  /** Columns flagged `exportOnly` never appear in the picker. */
  exportOnly?: boolean
}

export interface ColumnVisibilityApi {
  /** Map of columnId → visible. Stable identity per change. */
  visibility: Record<string, boolean>
  isVisible: (id: string) => boolean
  setVisible: (id: string, visible: boolean) => void
  showAll: () => void
  reset: () => void
  /** Count of columns currently visible (used to prevent hiding the last one). */
  visibleCount: number
  /**
   * Ordered list of column ids (every id in `columns` appears exactly once).
   * Columns the user has manually re-ordered come first in their saved order;
   * any newly-added columns that weren't in the saved order get appended in
   * their natural declaration order.
   */
  order: string[]
  /** Persist a new ordering. Unknown ids are ignored, missing ids are appended. */
  setOrder: (next: string[]) => void
  /** Move one column from index `from` to index `to` in the current order. */
  moveColumn: (from: number, to: number) => void
}

const KEY_PREFIX = 'kasa.cols.'
const ORDER_KEY_PREFIX = 'kasa.colorder.'
const URL = '/api/user/preferences'
const DEBOUNCE_MS = 500

function defaultMap(columns: ColumnDef[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const c of columns) {
    if (c.exportOnly) continue
    out[c.id] = !c.defaultHidden
  }
  return out
}

/* ───────────────────────── localStorage mirror ────────────────────────── */

function readStored(tableId: string | undefined): Record<string, boolean> | null {
  if (!tableId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + tableId)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>
    }
  } catch {
    // ignore corrupt entries
  }
  return null
}

function writeStored(tableId: string | undefined, vis: Record<string, boolean>) {
  if (!tableId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY_PREFIX + tableId, JSON.stringify(vis))
  } catch {
    // ignore quota errors
  }
}

function readStoredOrder(tableId: string | undefined): string[] | null {
  if (!tableId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ORDER_KEY_PREFIX + tableId)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed as string[]
    }
  } catch {
    // ignore corrupt entries
  }
  return null
}

function writeStoredOrder(tableId: string | undefined, ids: string[]) {
  if (!tableId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ORDER_KEY_PREFIX + tableId, JSON.stringify(ids))
  } catch {
    // ignore quota errors
  }
}

/* ───────────────────────── server-side prefs cache ─────────────────────── */
//
// We deliberately don't use the generic `cachedFetch` here because we need
// fine-grained control over the snapshot lifecycle (multiple tables on the
// same page share the snapshot, and a successful PATCH must update it so
// other tables on the page see the change).

interface Snapshot {
  visibility: Record<string, Record<string, boolean>>
  order: Record<string, string[]>
}

let snapshot: Snapshot | null = null
let snapshotPromise: Promise<Snapshot> | null = null
let snapshotLoadFailed = false

// Wipe the snapshot whenever the rest of the client-side caches are dropped
// (sign-out / org switch). Registered once per tab.
if (typeof window !== 'undefined') {
  window.addEventListener('kasa:client-cache-cleared', () => {
    snapshot = null
    snapshotPromise = null
    snapshotLoadFailed = false
  })
}

async function loadSnapshot(): Promise<Snapshot> {
  if (snapshot) return snapshot
  if (snapshotPromise) return snapshotPromise
  snapshotPromise = (async () => {
    try {
      const res = await fetch(URL, { credentials: 'same-origin' })
      if (!res.ok) {
        snapshotLoadFailed = true
        snapshot = { visibility: {}, order: {} }
        return snapshot
      }
      const data = (await res.json().catch(() => ({}))) as {
        tableColumns?: Record<string, Record<string, boolean>>
        tableColumnOrder?: Record<string, string[]>
      }
      snapshot = {
        visibility:
          data?.tableColumns && typeof data.tableColumns === 'object' ? data.tableColumns : {},
        order:
          data?.tableColumnOrder && typeof data.tableColumnOrder === 'object'
            ? data.tableColumnOrder
            : {},
      }
      return snapshot
    } catch {
      snapshotLoadFailed = true
      snapshot = { visibility: {}, order: {} }
      return snapshot
    } finally {
      snapshotPromise = null
    }
  })()
  return snapshotPromise
}

interface PartialPatch {
  visibility?: Record<string, boolean>
  order?: string[]
}

async function persistToServer(tableId: string, patch: PartialPatch) {
  if (snapshotLoadFailed) return // skip server writes when unauthenticated/offline
  if (!patch.visibility && !patch.order) return
  try {
    const body: Record<string, unknown> = {}
    if (patch.visibility) body.tableColumns = { [tableId]: patch.visibility }
    if (patch.order) body.tableColumnOrder = { [tableId]: patch.order }
    const res = await fetch(URL, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        tableColumns?: Record<string, Record<string, boolean>>
        tableColumnOrder?: Record<string, string[]>
      }
      if (!snapshot) snapshot = { visibility: {}, order: {} }
      if (data?.tableColumns && typeof data.tableColumns === 'object') {
        snapshot.visibility = data.tableColumns
      } else if (patch.visibility) {
        snapshot.visibility[tableId] = patch.visibility
      }
      if (data?.tableColumnOrder && typeof data.tableColumnOrder === 'object') {
        snapshot.order = data.tableColumnOrder
      } else if (patch.order) {
        snapshot.order[tableId] = patch.order
      }
    } else if (res.status === 401) {
      // signed out — fall back to localStorage only from now on
      snapshotLoadFailed = true
    }
  } catch {
    // network error — keep local state; next mount will retry from server
  }
}

/* ───────────────────────────── the hook ─────────────────────────────── */

/**
 * Reconcile a stored order against the column declaration. The output:
 *   - keeps stored ids that still exist in the declaration, in their saved order
 *   - appends any new columns (not yet in the saved order) in declaration order
 *   - drops any stored id the declaration no longer knows about
 */
function reconcileOrder(stored: string[] | null | undefined, declared: string[]): string[] {
  if (!stored || stored.length === 0) return declared.slice()
  const declaredSet = new Set(declared)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of stored) {
    if (declaredSet.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  for (const id of declared) {
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

export function useColumnVisibility(
  tableId: string | undefined,
  columns: ColumnDef[],
): ColumnVisibilityApi {
  const defaults = useMemo(() => defaultMap(columns), [columns])
  const declaredOrder = useMemo(
    () => columns.filter((c) => !c.exportOnly).map((c) => c.id),
    [columns],
  )

  const [visibility, setVisibility] = useState<Record<string, boolean>>(defaults)
  const [order, setOrderState] = useState<string[]>(declaredOrder)

  const hydrated = useRef(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingVis = useRef<Record<string, boolean> | null>(null)
  const pendingOrder = useRef<string[] | null>(null)

  const applyStored = useCallback(
    (stored: Record<string, boolean> | null | undefined) => {
      if (!stored) return
      setVisibility((prev) => {
        const next: Record<string, boolean> = { ...prev }
        for (const id of Object.keys(prev)) {
          if (Object.prototype.hasOwnProperty.call(stored, id)) {
            next[id] = !!stored[id]
          }
        }
        if (!Object.values(next).some(Boolean) && Object.keys(next).length > 0) {
          next[Object.keys(next)[0]] = true
        }
        return next
      })
    },
    [],
  )

  const applyStoredOrder = useCallback(
    (stored: string[] | null | undefined) => {
      if (!stored || stored.length === 0) return
      setOrderState((prev) => {
        const reconciled = reconcileOrder(stored, declaredOrder)
        // Only update if changed (avoid render churn).
        if (
          reconciled.length === prev.length &&
          reconciled.every((id, i) => id === prev[i])
        ) {
          return prev
        }
        return reconciled
      })
    },
    [declaredOrder],
  )

  // Hydrate from localStorage first (instant), then the server (authoritative).
  useEffect(() => {
    if (hydrated.current || !tableId) return
    hydrated.current = true

    applyStored(readStored(tableId))
    applyStoredOrder(readStoredOrder(tableId))

    void loadSnapshot().then((all) => {
      const visFromServer = all?.visibility?.[tableId]
      const orderFromServer = all?.order?.[tableId]
      if (visFromServer && typeof visFromServer === 'object') {
        applyStored(visFromServer)
        writeStored(tableId, visFromServer)
      }
      if (Array.isArray(orderFromServer)) {
        applyStoredOrder(orderFromServer)
        writeStoredOrder(tableId, orderFromServer)
      }
    })
  }, [tableId, applyStored, applyStoredOrder])

  // Re-sync when the column set itself changes (new columns added/removed).
  useEffect(() => {
    setVisibility((prev) => {
      let changed = false
      const next: Record<string, boolean> = { ...prev }
      for (const id of Object.keys(defaults)) {
        if (!(id in next)) {
          next[id] = defaults[id]
          changed = true
        }
      }
      for (const id of Object.keys(next)) {
        if (!(id in defaults)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
    // Reconcile order when columns change too.
    setOrderState((prev) => reconcileOrder(prev, declaredOrder))
  }, [defaults, declaredOrder])

  const flushPending = useCallback(() => {
    if (!tableId) return
    const patch: PartialPatch = {}
    if (pendingVis.current) patch.visibility = pendingVis.current
    if (pendingOrder.current) patch.order = pendingOrder.current
    if (patch.visibility || patch.order) {
      void persistToServer(tableId, patch)
      pendingVis.current = null
      pendingOrder.current = null
    }
  }, [tableId])

  // Flush any pending write on unmount so a quick change right before
  // navigating away is not lost.
  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
      flushPending()
    }
  }, [flushPending])

  const scheduleFlush = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(flushPending, DEBOUNCE_MS)
  }, [flushPending])

  const persistVis = useCallback(
    (next: Record<string, boolean>) => {
      writeStored(tableId, next)
      if (!tableId) return
      pendingVis.current = next
      scheduleFlush()
    },
    [tableId, scheduleFlush],
  )

  const persistOrder = useCallback(
    (next: string[]) => {
      writeStoredOrder(tableId, next)
      if (!tableId) return
      pendingOrder.current = next
      scheduleFlush()
    },
    [tableId, scheduleFlush],
  )

  const setVisible = useCallback(
    (id: string, visible: boolean) => {
      setVisibility((prev) => {
        if (prev[id] === visible) return prev
        const next = { ...prev, [id]: visible }
        const remaining = Object.values(next).filter(Boolean).length
        if (remaining === 0) return prev // never hide the last column
        persistVis(next)
        return next
      })
    },
    [persistVis],
  )

  const showAll = useCallback(() => {
    setVisibility(() => {
      const next: Record<string, boolean> = {}
      for (const id of Object.keys(defaults)) next[id] = true
      persistVis(next)
      return next
    })
  }, [defaults, persistVis])

  const reset = useCallback(() => {
    if (tableId && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(KEY_PREFIX + tableId)
        window.localStorage.removeItem(ORDER_KEY_PREFIX + tableId)
      } catch {
        // ignore
      }
    }
    setVisibility(defaults)
    setOrderState(declaredOrder)
    if (tableId) {
      pendingVis.current = defaults
      pendingOrder.current = declaredOrder
      scheduleFlush()
    }
  }, [tableId, defaults, declaredOrder, scheduleFlush])

  const setOrder = useCallback(
    (next: string[]) => {
      setOrderState((prev) => {
        const reconciled = reconcileOrder(next, declaredOrder)
        if (
          reconciled.length === prev.length &&
          reconciled.every((id, i) => id === prev[i])
        ) {
          return prev
        }
        persistOrder(reconciled)
        return reconciled
      })
    },
    [declaredOrder, persistOrder],
  )

  const moveColumn = useCallback(
    (from: number, to: number) => {
      setOrderState((prev) => {
        if (
          from < 0 ||
          from >= prev.length ||
          to < 0 ||
          to >= prev.length ||
          from === to
        ) {
          return prev
        }
        const next = prev.slice()
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        persistOrder(next)
        return next
      })
    },
    [persistOrder],
  )

  const isVisible = useCallback((id: string) => visibility[id] !== false, [visibility])
  const visibleCount = useMemo(
    () => Object.values(visibility).filter(Boolean).length,
    [visibility],
  )

  return {
    visibility,
    isVisible,
    setVisible,
    showAll,
    reset,
    visibleCount,
    order,
    setOrder,
    moveColumn,
  }
}

