'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
import { fetchFamilyLedgerPage } from '@/lib/client/family-ledger-fetch'
import type { FamilyTabId } from './constants'
import type { FamilyDetails } from './helpers'

export const LEDGER_TABS = new Set<FamilyTabId>([
  'payments',
  'withdrawals',
  'events',
  'cycle-charges',
  'members',
])

export type LedgerDataField = 'payments' | 'withdrawals' | 'lifecycleEvents' | 'cycleCharges'

export const LEDGER_TAB_CONFIG: Partial<
  Record<FamilyTabId, { url: (id: string) => string; field: LedgerDataField }>
> = {
  payments: { url: (id) => `/api/families/${id}/payments`, field: 'payments' },
  withdrawals: { url: (id) => `/api/families/${id}/withdrawals`, field: 'withdrawals' },
  events: { url: (id) => `/api/families/${id}/lifecycle-events`, field: 'lifecycleEvents' },
  'cycle-charges': { url: (id) => `/api/families/${id}/cycle-charges`, field: 'cycleCharges' },
  members: { url: (id) => `/api/families/${id}/payments`, field: 'payments' },
}

export const EMPTY_LEDGER_CURSORS: Record<LedgerDataField, string | null> = {
  payments: null,
  withdrawals: null,
  lifecycleEvents: null,
  cycleCharges: null,
}

export interface UseFamilyLedgerOptions {
  familyId: string
  isAdmin: boolean
  data: FamilyDetails | null
  setData: React.Dispatch<React.SetStateAction<FamilyDetails | null>>
  isFamilyFetchStale: (gen: number) => boolean
  currentFamilyFetchGen: () => number
  toast: { error: (msg: string) => void }
}

export function useFamilyLedger({
  familyId,
  isAdmin,
  data,
  setData,
  isFamilyFetchStale,
  currentFamilyFetchGen,
  toast,
}: UseFamilyLedgerOptions) {
  const [loadingLedgerTab, setLoadingLedgerTab] = useState<FamilyTabId | null>(null)
  const [loadingMoreLedgerTab, setLoadingMoreLedgerTab] = useState<FamilyTabId | null>(null)
  const [ledgerNextCursor, setLedgerNextCursor] =
    useState<Record<LedgerDataField, string | null>>(EMPTY_LEDGER_CURSORS)
  const loadedLedgerTabsRef = useRef<Set<string>>(new Set())

  const fetchLedgerForTab = useCallback(
    async (tab: FamilyTabId, sharedGen?: number) => {
      if (!familyId || !isAdmin) return

      const config = LEDGER_TAB_CONFIG[tab]
      if (!config) return

      const gen = sharedGen ?? currentFamilyFetchGen()
      setLoadingLedgerTab(tab)
      try {
        const page = await fetchFamilyLedgerPage(config.url(familyId))
        if (isFamilyFetchStale(gen)) return
        setLedgerNextCursor((prev) => ({ ...prev, [config.field]: page.nextCursor }))
        setData((prev) =>
          prev ? { ...prev, [config.field]: page.items } : prev,
        )
      } catch (error) {
        if (isFamilyFetchStale(gen)) return
        console.error(`Error fetching ${tab} ledger:`, error)
      } finally {
        if (!isFamilyFetchStale(gen)) setLoadingLedgerTab(null)
      }
    },
    [familyId, isAdmin, currentFamilyFetchGen, isFamilyFetchStale, setData],
  )

  const loadMoreLedgerForTab = useCallback(
    async (tab: FamilyTabId) => {
      if (!familyId || !isAdmin) return

      const config = LEDGER_TAB_CONFIG[tab]
      if (!config) return

      const cursor = ledgerNextCursor[config.field]
      if (!cursor || loadingMoreLedgerTab) return

      setLoadingMoreLedgerTab(tab)
      try {
        const page = await fetchFamilyLedgerPage(config.url(familyId), { cursor })
        setLedgerNextCursor((prev) => ({ ...prev, [config.field]: page.nextCursor }))
        setData((prev) =>
          prev
            ? { ...prev, [config.field]: [...(prev[config.field] || []), ...page.items] }
            : prev,
        )
      } catch (error) {
        console.error(`Error loading more ${tab} ledger:`, error)
        toast.error('Could not load more.')
      } finally {
        setLoadingMoreLedgerTab(null)
      }
    },
    [familyId, isAdmin, ledgerNextCursor, loadingMoreLedgerTab, setData, toast],
  )

  const ledgerHasMore = useMemo(
    () => ({
      payments: !!ledgerNextCursor.payments,
      withdrawals: !!ledgerNextCursor.withdrawals,
      events: !!ledgerNextCursor.lifecycleEvents,
      'cycle-charges': !!ledgerNextCursor.cycleCharges,
    }),
    [ledgerNextCursor],
  )

  const resetLedger = useCallback(() => {
    loadedLedgerTabsRef.current.clear()
    setLedgerNextCursor(EMPTY_LEDGER_CURSORS)
  }, [])

  const refreshLedgerTab = useCallback(
    async (tab: FamilyTabId, gen: number) => {
      if (!isAdmin || !LEDGER_TABS.has(tab)) return
      loadedLedgerTabsRef.current.delete(tab)
      loadedLedgerTabsRef.current.add(tab)
      await fetchLedgerForTab(tab, gen)
    },
    [isAdmin, fetchLedgerForTab],
  )

  return {
    loadingLedgerTab,
    loadingMoreLedgerTab,
    ledgerNextCursor,
    loadedLedgerTabsRef,
    fetchLedgerForTab,
    loadMoreLedgerForTab,
    ledgerHasMore,
    resetLedger,
    refreshLedgerTab,
  }
}
