'use client'

import { useEffect, useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ChevronUpDownIcon, PlusIcon, BuildingOffice2Icon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { cachedFetch, invalidate as invalidateUrl, clearCache } from '@/lib/client-cache'
import { useToast } from './Toast'
import OrgLogo from './OrgLogo'
import { useOrgRole } from '@/lib/client/useOrgRole'

interface Org {
  id: string
  name: string
  slug: string
  role: string
}

const ORGS_URL = '/api/organizations'

function invalidateOrgCache() {
  invalidateUrl(ORGS_URL)
}

async function loadOrgs(force = false): Promise<{ organizations: Org[]; activeOrgId: string | null }> {
  try {
    const data = await cachedFetch<any>(ORGS_URL, { ttl: 60_000, bypass: force })
    return {
      organizations: data.organizations || [],
      activeOrgId: data.activeOrgId ?? null,
    }
  } catch {
    return { organizations: [], activeOrgId: null }
  }
}

export default function OrgSwitcher() {
  const router = useRouter()
  const { update: updateSession } = useSession()
  const toast = useToast()
  const { isAdmin } = useOrgRole()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  const load = async (force = false) => {
    try {
      const data = await loadOrgs(force)
      setOrgs(data.organizations)
      setActiveId(data.activeOrgId)
    } catch {}
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowCreate(false)
      }
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const active = orgs.find((o) => o.id === activeId) || orgs[0]

  const switchTo = async (id: string) => {
    if (id === activeId || switching) return
    setSwitching(true)
    try {
      const res = await fetch('/api/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeOrgId: id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || 'Could not switch workspace.')
        return
      }
      // 1. Drop every cached client response — they were scoped to the old org.
      clearCache()
      // 1b. Tell the service worker (if installed) to drop its tenant-scoped
      //     API cache too. Without this the SWR layer in the SW would
      //     briefly serve the previous org's families/payments/etc. to
      //     the new org on first paint after a switch.
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_ORG_CACHES' })
      }
      // 2. Optimistic UI: reflect the new active org before the session refetch
      //    settles, so the switcher shows the right name immediately.
      setActiveId(id)
      // 3. Force NextAuth to re-read the JWT (active org id lives on the token).
      try {
        await updateSession()
      } catch {
        // updateSession can throw if the user is signed out; tolerate it.
      }
      // 4. Re-render server components against the new org context.
      router.refresh()
      // 5. Tell client-side context providers (currency, i18n,
      //    branding) to refetch — the active-org id lives on the JWT
      //    but our providers only re-run when their dependency changes,
      //    so without an explicit nudge they keep the prior org's
      //    currency/locale until the next hard navigation.
      try {
        window.dispatchEvent(new CustomEvent('kasa:org-changed', { detail: { orgId: id } }))
      } catch {
        // CustomEvent is in every modern browser we ship to; the catch
        // is just defence against pathological polyfilled environments.
      }
      const newOrg = orgs.find((o) => o.id === id)
      toast.success(`Switched to ${newOrg?.name || 'workspace'}.`)
      setOpen(false)
    } catch {
      toast.error('Network error switching workspaces.')
    } finally {
      setSwitching(false)
    }
  }

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newName.trim().length < 2) return
    const res = await fetch('/api/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error || 'Could not create organization.')
      return
    }
    const created = await res.json().catch(() => ({}))
    setNewName('')
    setShowCreate(false)
    invalidateOrgCache()
    await load(true)
    if (created?.id) await switchTo(created.id)
  }

  if (orgs.length === 0) return null


  // When the user has only one org the dropdown is just visual noise —
  // we collapse to a compact static label, but still let them open the
  // menu (via "More" button) to create a new org or manage members.
  const isSolo = orgs.length === 1

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`focus-ring w-full bg-app-subtle rounded-md border border-border flex items-center gap-2 hover:bg-fg/5 transition-colors text-left ${
          isSolo ? 'px-2.5 py-1.5' : 'px-2.5 py-2'
        }`}
        title={active?.name}
      >
        <OrgLogo size={20} fallbackChar={active?.name?.[0]} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-fg truncate">
            {switching ? 'Switching workspace…' : active?.name || 'Select organization'}
          </p>
          {!isSolo && active && !switching && (
            <p className="text-[11px] text-fg-muted capitalize">{active.role}</p>
          )}
        </div>
        {switching ? <InlineSpinner /> : <ChevronUpDownIcon className="h-4 w-4 text-fg-subtle shrink-0" aria-hidden="true" />}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-surface border border-border rounded-md shadow-popover z-50 overflow-hidden">
          <div className="max-h-72 overflow-y-auto py-1">
            {orgs.map((o) => {
              const isActive = o.id === activeId
              return (
                <button
                  key={o.id}
                  onClick={() => switchTo(o.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-fg/5 ${
                    isActive ? 'bg-accent/10' : ''
                  }`}
                >
                  <BuildingOffice2Icon className="h-4 w-4 text-fg-subtle shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg truncate">{o.name}</p>
                    <p className="text-[11px] text-fg-muted capitalize">{o.role}</p>
                  </div>
                  {isActive && (
                    <span className="text-[11px] font-medium text-accent">Active</span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="border-t border-border p-2 space-y-1">
            {!showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full px-2 py-1.5 text-sm text-accent hover:bg-accent/10 rounded flex items-center gap-2"
              >
                <PlusIcon className="h-4 w-4" />
                New organization
              </button>
            ) : (
              <form onSubmit={createOrg} className="px-1 space-y-2">
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Organization name"
                  className="w-full text-sm bg-surface text-fg border border-border rounded px-2 py-1 focus:ring-2 focus:ring-accent outline-none"
                />
                <div className="flex gap-1">
                  <button
                    type="submit"
                    className="flex-1 text-xs bg-accent text-accent-fg px-2 py-1 rounded hover:bg-accent-hover"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setNewName('') }}
                    className="flex-1 text-xs bg-fg/5 text-fg px-2 py-1 rounded hover:bg-fg/10"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {isAdmin && (
              <Link
                href="/settings?tab=members"
                onClick={() => setOpen(false)}
                className="block px-2 py-1.5 text-sm text-fg-muted hover:bg-fg/5 hover:text-fg rounded"
              >
                Manage members
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InlineSpinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin text-fg-muted shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
