'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { Bars3Icon } from '@heroicons/react/24/outline'
import OrgLogo from './OrgLogo'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

const GlobalSearch = dynamic(() => import('./GlobalSearch'), { ssr: false })
const NotificationsBell = dynamic(() => import('./NotificationsBell'), { ssr: false })

/**
 * Map a route prefix to an i18n key shown in the mobile top bar.
 * Page titles inside the content use PageHeader (hidden on mobile) so
 * this bar is the sole visible heading on small screens.
 */
const PATH_TITLE_KEYS: { match: RegExp; key: MessageKey }[] = [
  { match: /^\/$/, key: 'nav.dashboard' },
  { match: /^\/families/, key: 'nav.families' },
  { match: /^\/payments/, key: 'nav.payments' },
  { match: /^\/tasks/, key: 'nav.tasks' },
  { match: /^\/calendar/, key: 'nav.calendar' },
  { match: /^\/calculations/, key: 'nav.calculations' },
  { match: /^\/events/, key: 'nav.events' },
  { match: /^\/projections/, key: 'nav.projections' },
  { match: /^\/lifecycle-event-types/, key: 'settings.eventTypes' },
  { match: /^\/reports/, key: 'nav.reports' },
  { match: /^\/statements/, key: 'nav.statements' },
  { match: /^\/settings\/members/, key: 'nav.members' },
  { match: /^\/settings/, key: 'nav.settings' },
  { match: /^\/account/, key: 'nav.account' },
  { match: /^\/admin/, key: 'nav.admin' },
]

function titleKeyForPath(path: string | null): MessageKey {
  if (!path) return 'nav.brand'
  const hit = PATH_TITLE_KEYS.find((p) => p.match.test(path))
  return hit?.key ?? 'nav.brand'
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
  const t = useT()
  const title = t(titleKeyForPath(pathname))

  return (
    <header
      className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border bg-surface px-3 md:hidden"
      role="banner"
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t('nav.openMenu')}
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
