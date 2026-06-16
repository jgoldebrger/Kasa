'use client'

import { usePathname } from 'next/navigation'
import { Bars3Icon } from '@heroicons/react/24/outline'
import OrgLogo from './OrgLogo'
import GlobalSearch from './GlobalSearch'
import NotificationsBell from './NotificationsBell'

/**
 * Map a route prefix to a friendly title shown in the mobile top bar.
 * Kept in this file (not a context) to avoid the prop-drilling tax —
 * 99% of pages don't need a custom title, and the ones that do can
 * still render their own heading inside the page.
 */
const PATH_TITLES: { match: RegExp; title: string }[] = [
  { match: /^\/$/, title: 'Dashboard' },
  { match: /^\/families/, title: 'Families' },
  { match: /^\/payments/, title: 'Payments' },
  { match: /^\/tasks/, title: 'Tasks' },
  { match: /^\/calculations/, title: 'Calculations' },
  { match: /^\/events/, title: 'Events' },
  { match: /^\/projections/, title: 'Dues calc' },
  { match: /^\/lifecycle-event-types/, title: 'Event Types' },
  { match: /^\/reports/, title: 'Reports' },
  { match: /^\/statements/, title: 'Statements' },
  { match: /^\/settings\/members/, title: 'Members' },
  { match: /^\/settings/, title: 'Settings' },
  { match: /^\/admin/, title: 'Admin' },
]

function titleForPath(path: string | null): string {
  if (!path) return 'Kasa'
  const hit = PATH_TITLES.find((p) => p.match.test(path))
  return hit?.title || 'Kasa'
}

interface MobileTopBarProps {
  onOpenMenu: () => void
  menuOpen: boolean
}

/**
 * Sticky top bar shown only on `<md` screens. Contains the hamburger
 * (which opens the Sidebar drawer), the Kasa wordmark on the left, and
 * the current page title centered.
 */
export default function MobileTopBar({ onOpenMenu, menuOpen }: MobileTopBarProps) {
  const pathname = usePathname()
  const title = titleForPath(pathname)

  return (
    <header
      className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border bg-surface px-3 md:hidden"
      role="banner"
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation menu"
        aria-controls="primary-sidebar"
        aria-expanded={menuOpen}
        className="focus-ring inline-flex min-h-[var(--touch-target)] min-w-[var(--touch-target)] items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
      >
        <Bars3Icon className="h-6 w-6" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <OrgLogo size={24} />
        <h1 className="truncate text-sm font-semibold text-fg">{title}</h1>
      </div>

      <div className="flex shrink-0 items-center">
        <GlobalSearch variant="icon" mobileFullscreen />
        {/* Dropdown opens downward from the top bar (sidebar footer opens upward). */}
        <div className="[&_div.bottom-full]:bottom-auto [&_div.bottom-full]:top-full [&_div.bottom-full]:mb-0 [&_div.bottom-full]:mt-2 [&>div>button]:min-h-[var(--touch-target)] [&>div>button]:min-w-[var(--touch-target)]">
          <NotificationsBell />
        </div>
      </div>
    </header>
  )
}
