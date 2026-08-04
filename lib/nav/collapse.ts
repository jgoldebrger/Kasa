import { findActiveNavItem } from './match'
import type { NavSection } from './types'

export const NAV_COLLAPSE_STORAGE_KEY = 'kasa-nav-open-sections'

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readOpenSections(storage?: Storage): string[] {
  const store = resolveStorage(storage)
  if (!store) return []
  try {
    const raw = store.getItem(NAV_COLLAPSE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function writeOpenSections(ids: string[], storage?: Storage): void {
  const store = resolveStorage(storage)
  if (!store) return
  try {
    store.setItem(NAV_COLLAPSE_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // no-op when storage is unavailable
  }
}

export function ensureSectionOpen(openIds: string[], sectionId: string): string[] {
  if (openIds.includes(sectionId)) return openIds
  return [...openIds, sectionId]
}

function findSectionForItem(sections: NavSection[], itemId: string): string | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.id === itemId) return section.id
      if (item.children?.some((child) => child.id === itemId)) return section.id
    }
  }
  return null
}

export function sectionIdForPath(
  pathname: string,
  search: string,
  sections: NavSection[],
): string | null {
  const active = findActiveNavItem(pathname, search, sections)
  if (!active) return null
  return findSectionForItem(sections, active.id)
}
