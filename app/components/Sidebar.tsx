'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import OrgSwitcher from './OrgSwitcher'
import OrgLogo from './OrgLogo'
import ThemeToggle from './ThemeToggle'
import { useT } from '@/lib/client/i18n'
import { clearCache } from '@/lib/client-cache'
import { useOrgBranding } from '@/lib/client/useOrgBranding'
import { useOrgRole } from '@/lib/client/useOrgRole'
import {
  fetchSupportModeStatus,
  useSupportModeChanged,
  type SupportModeDetail,
} from '@/lib/client/support-mode'
import LegalFooterLinks from './legal/LegalFooterLinks'
import { Badge } from '@/app/components/ui'
import type { MessageKey } from '@/lib/i18n/load-locale'
import {
  PRIMARY_NAV_SECTIONS,
  filterNavSections,
  findActiveNavItem,
  readOpenSections,
  writeOpenSections,
  ensureSectionOpen,
  sectionIdForPath,
  type NavItem,
} from '@/lib/nav'
import {
  ArrowDownTrayIcon,
  ArrowRightOnRectangleIcon,
  BanknotesIcon,
  BoltIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChartBarIcon,
  ChartBarSquareIcon,
  ChevronDownIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  CurrencyDollarIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  IdentificationIcon,
  PhotoIcon,
  PresentationChartBarIcon,
  PresentationChartLineIcon,
  QueueListIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
  UserCircleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'

const GlobalSearch = dynamic(() => import('./GlobalSearch'), { ssr: false })
const NotificationsBell = dynamic(() => import('./NotificationsBell'), { ssr: false })

const SIDEBAR_FOOTER_STORAGE_KEY = 'kasa-sidebar-footer-open'

/** Maps `NavItem.iconName` (declared in lib/nav/config.ts) to its Heroicon component. */
const NAV_ICONS: Record<string, typeof ChartBarIcon> = {
  ArrowDownTrayIcon,
  BanknotesIcon,
  BoltIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChartBarIcon,
  ChartBarSquareIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  CurrencyDollarIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  IdentificationIcon,
  PhotoIcon,
  PresentationChartBarIcon,
  PresentationChartLineIcon,
  QueueListIcon,
  QuestionMarkCircleIcon,
  TagIcon,
  TrashIcon,
  UserGroupIcon,
}

function iconForNavItem(item: NavItem): typeof ChartBarIcon {
  return (item.iconName && NAV_ICONS[item.iconName]) || QuestionMarkCircleIcon
}

/** Settings deep links use `/settings?tab=<id>`; the email tab is the
 * SettingsView default, so its link omits the query entirely. */
function hrefForNavItem(item: NavItem): string {
  if (!item.settingsTab) return item.href
  return item.settingsTab === 'email' ? item.href : `${item.href}?tab=${item.settingsTab}`
}

interface SidebarProps {
  onClose?: () => void
}

export default function Sidebar({ onClose }: SidebarProps = {}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = useMemo(() => {
    const qs = searchParams?.toString()
    return qs ? `?${qs}` : ''
  }, [searchParams])
  const { data: session } = useSession()
  const user = session?.user as
    | { name?: string | null; email?: string | null; isPlatformAdmin?: boolean }
    | undefined
  const { branding } = useOrgBranding()
  const { isAdmin } = useOrgRole()
  const t = useT()
  const [supportMode, setSupportMode] = useState<SupportModeDetail>({ active: false })

  useSupportModeChanged(
    useCallback((detail) => {
      setSupportMode(detail)
    }, []),
  )

  useEffect(() => {
    if (!user?.isPlatformAdmin) {
      setSupportMode({ active: false })
      return
    }
    void fetchSupportModeStatus().then(setSupportMode)
  }, [user?.isPlatformAdmin])

  const navSections = useMemo(
    () =>
      filterNavSections(PRIMARY_NAV_SECTIONS, {
        isAdmin,
        isPlatformAdmin: Boolean(user?.isPlatformAdmin),
      }),
    [isAdmin, user?.isPlatformAdmin],
  )

  const activeItem = useMemo(
    () => findActiveNavItem(pathname ?? '', search, navSections),
    [pathname, search, navSections],
  )

  // Start empty (no localStorage read during render) to avoid SSR/client
  // hydration mismatches; hydrate persisted + route-derived open sections
  // in the effect below, after mount.
  const [openSectionIds, setOpenSectionIds] = useState<string[]>([])

  useEffect(() => {
    const stored = readOpenSections()
    const activeSectionId = sectionIdForPath(pathname ?? '', search, navSections)
    const next = activeSectionId ? ensureSectionOpen(stored, activeSectionId) : stored
    setOpenSectionIds(next)
    if (next !== stored) writeOpenSections(next)
  }, [pathname, search, navSections])

  const toggleSection = useCallback((sectionId: string) => {
    setOpenSectionIds((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId]
      writeOpenSections(next)
      return next
    })
  }, [])

  // Footer (admin links + account + legal) starts collapsed; hydrate from
  // localStorage after mount to avoid SSR/client mismatch.
  const [footerOpen, setFooterOpen] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_FOOTER_STORAGE_KEY)
      if (stored === '0') setFooterOpen(false)
      if (stored === '1') setFooterOpen(true)
    } catch {
      /* ignore private-mode / blocked storage */
    }
  }, [])

  const toggleFooter = useCallback(() => {
    setFooterOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_FOOTER_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return (
    <aside
      className="h-full w-64 min-w-0 overflow-x-hidden bg-surface border-e border-border flex flex-col"
      aria-label={t('nav.primary')}
    >
      <div className="px-5 h-16 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <OrgLogo size={32} fallbackChar={branding.name?.[0] || 'K'} />
          <div className="leading-tight min-w-0">
            <h1 className="font-technical text-xs font-semibold text-fg truncate">
              {branding.name || 'Kasa'}
            </h1>
            <p className="font-technical text-[10px] text-fg-muted truncate">{t('nav.tagline')}</p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('nav.closeMenu')}
            className="focus-ring -me-1 inline-flex min-h-[var(--touch-target)] min-w-[var(--touch-target)] items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {user && (
        <div
          className={`px-3 pt-3 ${
            supportMode.active
              ? supportMode.readOnly
                ? 'border-s-2 border-amber-400/60'
                : 'border-s-2 border-amber-500'
              : ''
          }`}
        >
          <OrgSwitcher />
          {supportMode.active && user.isPlatformAdmin && (
            <div className="mt-2 px-1">
              <Badge
                variant={supportMode.readOnly ? 'muted' : 'warning'}
                className="text-[10px] uppercase tracking-wide"
              >
                {supportMode.readOnly
                  ? t('admin.supportMode.sidebarBadgeReadOnly')
                  : t('admin.supportMode.sidebarBadge')}
              </Badge>
            </div>
          )}
        </div>
      )}

      {user && (
        <div className="min-w-0 px-3 pt-2">
          <GlobalSearch />
        </div>
      )}

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto" aria-label={t('nav.primary')}>
        {navSections.map((section) => {
          const isOpen = openSectionIds.includes(section.id)
          const sectionLabel = section.labelKey ? t(section.labelKey as MessageKey) : null
          const panelId = `nav-section-${section.id}`

          return (
            <div key={section.id} className="space-y-0.5">
              {sectionLabel && (
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="focus-ring flex w-full items-center justify-between gap-2 rounded-none px-3 py-1.5 font-technical text-[10px] text-fg-muted hover:text-fg"
                >
                  <span className="truncate">{sectionLabel}</span>
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                    aria-hidden="true"
                  />
                </button>
              )}
              <div id={panelId} hidden={!isOpen} className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = activeItem?.id === item.id
                  const Icon = iconForNavItem(item)
                  const href = hrefForNavItem(item)

                  return (
                    <Link
                      key={item.id}
                      href={href}
                      prefetch={href !== pathname}
                      onClick={onClose}
                      aria-current={isActive ? 'page' : undefined}
                      className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-none font-technical text-[10px] transition-colors ${
                        isActive
                          ? 'bg-accent text-accent-fg font-semibold'
                          : 'text-fg-muted font-medium hover:bg-fg/5 hover:text-fg'
                      }`}
                    >
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 ${
                          isActive ? 'text-accent-fg' : 'text-fg-subtle'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{t(item.labelKey as MessageKey)}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-border">
        <button
          type="button"
          onClick={toggleFooter}
          aria-expanded={footerOpen}
          aria-controls="sidebar-footer-panel"
          className="focus-ring flex w-full items-center justify-between gap-2 px-3 py-2 font-technical text-[10px] text-fg-muted hover:bg-fg/5 hover:text-fg"
        >
          <span className="truncate">{t('nav.sidebarFooter')}</span>
          <ChevronDownIcon
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${footerOpen ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
        </button>
        <div id="sidebar-footer-panel" hidden={!footerOpen} className="space-y-2 px-3 pb-3">
          {user && !isAdmin && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-none border border-border bg-app-subtle text-xs font-medium text-muted-on-subtle"
              aria-label="Organization role"
            >
              <UserCircleIcon className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span>{t('nav.memberLimited')}</span>
            </div>
          )}
          {user?.isPlatformAdmin && (
            <>
              <Link
                href="/admin"
                onClick={onClose}
                className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-none font-technical text-[10px] font-medium transition-colors ${
                  pathname === '/admin'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
                }`}
                title={t('nav.platformAdmin')}
              >
                <ShieldCheckIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span className="truncate">{t('nav.admin')}</span>
              </Link>
              <Link
                href="/admin/organizations"
                onClick={onClose}
                className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-none font-technical text-[10px] font-medium transition-colors ${
                  pathname?.startsWith('/admin/organizations')
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
                }`}
                title={t('nav.platformAdmin')}
              >
                <ShieldCheckIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span className="truncate">{t('nav.organizations')}</span>
              </Link>
              <Link
                href="/admin/onboarding"
                onClick={onClose}
                className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-none font-technical text-[10px] font-medium transition-colors ${
                  pathname?.startsWith('/admin/onboarding')
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
                }`}
                title={t('nav.platformAdmin')}
              >
                <ShieldCheckIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span className="truncate">Onboarding</span>
              </Link>
              <Link
                href="/admin/support-audit"
                onClick={onClose}
                className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-none font-technical text-[10px] font-medium transition-colors ${
                  pathname?.startsWith('/admin/support-audit')
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
                }`}
                title={t('nav.platformAdmin')}
              >
                <ShieldCheckIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span className="truncate">Support audit</span>
              </Link>
              <Link
                href="/admin/jobs"
                onClick={onClose}
                className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-none font-technical text-[10px] font-medium transition-colors ${
                  pathname?.startsWith('/admin/jobs')
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
                }`}
                title={t('nav.platformAdmin')}
              >
                <ShieldCheckIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span className="truncate">Job health</span>
              </Link>
              <Link
                href="/admin/invite-requests"
                onClick={onClose}
                className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-none font-technical text-[10px] font-medium transition-colors ${
                  pathname?.startsWith('/admin/invite-requests')
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
                }`}
                title={t('nav.platformAdmin')}
              >
                <ShieldCheckIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span className="truncate">{t('nav.inviteRequests')}</span>
              </Link>
            </>
          )}
          {user && (
            <div className="flex min-w-0 items-center gap-2 rounded-none border border-border bg-app-subtle px-2 py-2">
              <Link
                href="/account"
                onClick={onClose}
                className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-none p-0.5 hover:bg-fg/5"
                title={t('nav.account')}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-accent text-xs font-semibold text-accent-fg">
                  {user.name?.[0]?.toUpperCase() || <UserCircleIcon className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg">{user.name}</p>
                  <p className="truncate text-[11px] text-fg-muted">{user.email}</p>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-0.5">
                <NotificationsBell />
                <ThemeToggle />
                <button
                  onClick={() => {
                    clearCache()
                    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
                      navigator.serviceWorker.controller.postMessage({
                        type: 'CLEAR_ORG_CACHES',
                      })
                    }
                    signOut({ callbackUrl: '/login' })
                  }}
                  aria-label={t('nav.signOut')}
                  title={t('nav.signOut')}
                  className="focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg"
                >
                  <ArrowRightOnRectangleIcon className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          <LegalFooterLinks layout="stacked" className="px-1 pt-1 text-xs" />
        </div>
      </div>
    </aside>
  )
}
