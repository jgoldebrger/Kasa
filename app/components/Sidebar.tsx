'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import OrgSwitcher from './OrgSwitcher'
import OrgLogo from './OrgLogo'
import ThemeToggle from './ThemeToggle'
import { useT } from '@/lib/client/i18n'
import { clearCache } from '@/lib/client-cache'
import { useOrgBranding } from '@/lib/client/useOrgBranding'
import { useOrgRole } from '@/lib/client/useOrgRole'
import LegalFooterLinks from './legal/LegalFooterLinks'
import {
  UserGroupIcon,
  CalculatorIcon,
  DocumentTextIcon,
  ChartBarIcon,
  ChartBarSquareIcon,
  CalendarIcon,
  CogIcon,
  PresentationChartBarIcon,
  CurrencyDollarIcon,
  ClipboardDocumentListIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'

const GlobalSearch = dynamic(() => import('./GlobalSearch'), { ssr: false })
const NotificationsBell = dynamic(() => import('./NotificationsBell'), { ssr: false })

interface SidebarProps {
  onClose?: () => void
}

export default function Sidebar({ onClose }: SidebarProps = {}) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user as
    | { name?: string | null; email?: string | null; isPlatformAdmin?: boolean }
    | undefined
  const { branding } = useOrgBranding()
  const { isAdmin } = useOrgRole()
  const t = useT()

  const navItems = [
    { href: '/', label: t('nav.dashboard'), icon: ChartBarIcon },
    { href: '/families', label: t('nav.families'), icon: UserGroupIcon },
    { href: '/payments', label: t('nav.payments'), icon: CurrencyDollarIcon, adminOnly: true },
    { href: '/tasks', label: t('nav.tasks'), icon: ClipboardDocumentListIcon, adminOnly: true },
    { href: '/calculations', label: t('nav.calculations'), icon: CalculatorIcon, adminOnly: true },
    { href: '/events', label: t('nav.events'), icon: CalendarIcon, adminOnly: true },
    { href: '/projections', label: t('nav.projections'), icon: ChartBarSquareIcon, adminOnly: true },
    { href: '/reports', label: t('nav.reports'), icon: PresentationChartBarIcon, adminOnly: true },
    { href: '/statements', label: t('nav.statements'), icon: DocumentTextIcon, adminOnly: true },
    { href: '/settings', label: t('nav.settings'), icon: CogIcon, adminOnly: true },
  ].filter((item) => !('adminOnly' in item && item.adminOnly) || isAdmin)

  return (
    <aside
      className="h-full w-64 bg-surface border-e border-border flex flex-col"
      aria-label={t('nav.primary')}
    >
      <div className="px-5 h-16 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <OrgLogo size={32} fallbackChar={branding.name?.[0] || 'K'} />
          <div className="leading-tight min-w-0">
            <h1 className="text-sm font-semibold text-fg truncate">
              {branding.name || 'Kasa'}
            </h1>
            <p className="text-[11px] text-fg-muted truncate">{t('nav.tagline')}</p>
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
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {user && (
        <div className="px-3 pt-3">
          <OrgSwitcher />
        </div>
      )}

      {user && (
        <div className="px-3 pt-2">
          <GlobalSearch />
        </div>
      )}

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href))
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={item.href !== pathname}
              onClick={onClose}
              aria-current={isActive ? 'page' : undefined}
              className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-accent/10 text-accent font-semibold before:absolute before:start-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-accent before:rounded-e'
                  : 'text-fg-muted font-medium hover:bg-fg/5 hover:text-fg'
              }`}
            >
              <Icon
                className={`h-[18px] w-[18px] shrink-0 ${
                  isActive ? 'text-accent' : 'text-fg-subtle'
                }`}
                aria-hidden="true"
              />
              <span className="truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t border-border space-y-2 shrink-0">
        {user && !isAdmin && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-app-subtle text-xs font-medium text-muted-on-subtle"
            aria-label="Organization role"
          >
            <UserCircleIcon className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span>Member — view only</span>
          </div>
        )}
        {user?.isPlatformAdmin && (
          <Link
            href="/admin/invite-requests"
            onClick={onClose}
            className={`focus-ring relative flex items-center gap-2.5 px-3 py-2 min-h-[var(--touch-target)] md:min-h-0 md:h-9 rounded-md text-sm font-medium transition-colors ${
              pathname?.startsWith('/admin')
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
            }`}
            title={t('nav.platformAdmin')}
          >
            <ShieldCheckIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            <span className="truncate">{t('nav.inviteRequests')}</span>
          </Link>
        )}
        {user && (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-md border border-border bg-app-subtle">
            <Link
              href="/account"
              onClick={onClose}
              className="focus-ring flex items-center gap-2.5 flex-1 min-w-0 rounded-md -m-0.5 p-0.5 hover:bg-fg/5"
              title={t('nav.account')}
            >
              <div className="w-8 h-8 rounded-md bg-accent text-accent-fg flex items-center justify-center text-xs font-semibold shrink-0">
                {user.name?.[0]?.toUpperCase() || <UserCircleIcon className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-fg truncate">{user.name}</p>
                <p className="text-[11px] text-fg-muted truncate">{user.email}</p>
              </div>
            </Link>
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
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg transition-colors"
            >
              <ArrowRightOnRectangleIcon className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        )}
        <LegalFooterLinks layout="stacked" className="px-1 pt-1 text-xs" />
      </div>
    </aside>
  )
}
