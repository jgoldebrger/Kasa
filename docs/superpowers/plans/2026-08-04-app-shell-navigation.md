# App Shell & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded sidebar IA with a config-driven, collapsible primary nav that promotes Payments / Communications / Settings destinations, expands member-useful links carefully, and removes redundant section TabNavs.

**Architecture:** Pure helpers and a declarative nav tree in `lib/nav/*`; `Sidebar` (desktop + mobile drawer) renders collapsible sections from filtered config; Settings deep links use `/settings?tab=<id>` (existing pattern); shortcuts and skip-link consume the same config / i18n.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind, existing `useOrgRole` / `useT` / Heroicons, Vitest + Testing Library + happy-dom.

**Spec:** `docs/superpowers/specs/2026-08-04-app-shell-navigation-design.md`

## Global Constraints

- Meaningful IA change; keep sidebar + mobile drawer (not a rebrand / not top-nav).
- Promote Payments, Comms, Settings into sidebar; slim/remove redundant TabNavs.
- Collapsible sections: persist open/closed; auto-expand section for current route.
- Member expansion only where existing RBAC already allows; privileged Settings stay admin/owner.
- Do not change server permission APIs — shell visibility only.
- Preserve existing hrefs (including `/settings?tab=…`) so bookmarks keep working.
- No new UI libraries; use foundation tokens / `focus-ring` / logical CSS.
- No drive-by page content redesigns.
- Feature branch: `feat/app-shell-navigation` (already created).

---

## File map

| Path                                                   | Responsibility                                                |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `lib/nav/types.ts`                                     | Shared nav types                                              |
| `lib/nav/match.ts`                                     | Most-specific active href match (path + optional `tab` query) |
| `lib/nav/roles.ts`                                     | Filter tree by `member` / `admin` / `platformAdmin`           |
| `lib/nav/collapse.ts`                                  | localStorage read/write + ensure section open for pathname    |
| `lib/nav/config.ts`                                    | Declarative primary nav tree (icons as component refs)        |
| `lib/nav/shortcuts.ts`                                 | Shortcut entries derived from config                          |
| `lib/nav/index.ts`                                     | Barrel exports                                                |
| `app/components/Sidebar.tsx`                           | Render config; collapsible sections; role filter              |
| `app/components/AppShell.tsx`                          | Skip-link i18n; drawer focus restore polish                   |
| `app/globals.css`                                      | Skip-link logical position                                    |
| `app/components/KeyboardShortcuts.tsx`                 | Bindings from `lib/nav/shortcuts`                             |
| `app/payments/_components/PaymentsNav.tsx`             | Delete or reduce to null export after call sites removed      |
| `app/communications/_components/CommunicationsNav.tsx` | Same                                                          |
| `app/components/settings/SettingsNav.tsx`              | Stop using as primary chrome; keep types export if needed     |
| `app/settings/SettingsView.tsx`                        | Layout without side SettingsNav                               |
| `lib/i18n/messages/*.json`                             | New nav/shortcut/skip keys (all locales)                      |
| `docs/design-system/README.md`                         | Short “Shell IA” pointer                                      |

---

### Task 1: Nav types + active match + role filter

**Files:**

- Create: `lib/nav/types.ts`
- Create: `lib/nav/match.ts`
- Create: `lib/nav/roles.ts`
- Create: `lib/nav/match.test.ts`
- Create: `lib/nav/roles.test.ts`

**Interfaces:**

- Produces:
  - `export type NavRole = 'member' | 'admin' | 'platformAdmin'`
  - `export interface NavItem { id: string; href: string; labelKey: string; icon?: string; roles: NavRole[]; shortcut?: string; children?: NavItem[]; settingsTab?: string }`
  - `export interface NavSection { id: string; labelKey: string | null; items: NavItem[] }`
  - `export function isNavItemActive(pathname: string, search: string, item: Pick<NavItem, 'href' | 'settingsTab'>): boolean`
  - `export function findActiveNavItem(pathname: string, search: string, sections: NavSection[]): NavItem | null` — most specific matching item (longest path, then tab match)
  - `export function filterNavSections(sections: NavSection[], ctx: { isAdmin: boolean; isPlatformAdmin: boolean }): NavSection[]` — member sees items with `roles` including `member`; admin sees `member`+`admin`; platformAdmin footer handled separately (not in this filter)

- [ ] **Step 1: Write failing tests**

`lib/nav/match.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isNavItemActive, findActiveNavItem } from './match'
import type { NavSection } from './types'

const sections: NavSection[] = [
  {
    id: 'money',
    labelKey: 'nav.section.money',
    items: [
      { id: 'payments', href: '/payments', labelKey: 'nav.payments', roles: ['admin'] },
      {
        id: 'disputes',
        href: '/payments/disputes',
        labelKey: 'payments.nav.disputes',
        roles: ['admin'],
      },
      {
        id: 'settings-email',
        href: '/settings',
        labelKey: 'settings.email',
        roles: ['admin'],
        settingsTab: 'email',
      },
      {
        id: 'settings-members',
        href: '/settings',
        labelKey: 'settings.nav.members',
        roles: ['admin'],
        settingsTab: 'members',
      },
    ],
  },
]

describe('nav match', () => {
  it('prefers the longer path for disputes', () => {
    const active = findActiveNavItem('/payments/disputes', '', sections)
    expect(active?.id).toBe('disputes')
  })

  it('matches settings tab query', () => {
    expect(
      isNavItemActive('/settings', '?tab=members', {
        href: '/settings',
        settingsTab: 'members',
      }),
    ).toBe(true)
    expect(
      isNavItemActive('/settings', '', {
        href: '/settings',
        settingsTab: 'email',
      }),
    ).toBe(true)
  })
})
```

`lib/nav/roles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterNavSections } from './roles'
import type { NavSection } from './types'

const sections: NavSection[] = [
  {
    id: 'people',
    labelKey: 'nav.section.people',
    items: [
      { id: 'families', href: '/families', labelKey: 'nav.families', roles: ['member', 'admin'] },
      { id: 'events', href: '/events', labelKey: 'nav.events', roles: ['admin'] },
    ],
  },
]

describe('filterNavSections', () => {
  it('hides admin-only items from members', () => {
    const out = filterNavSections(sections, { isAdmin: false, isPlatformAdmin: false })
    expect(out[0].items.map((i) => i.id)).toEqual(['families'])
  })

  it('shows admin items to admins', () => {
    const out = filterNavSections(sections, { isAdmin: true, isPlatformAdmin: false })
    expect(out[0].items.map((i) => i.id)).toEqual(['families', 'events'])
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run lib/nav/match.test.ts lib/nav/roles.test.ts`

- [ ] **Step 3: Implement types, match, roles**

`lib/nav/types.ts` — as Interfaces above (`labelKey: string` for now; cast to `MessageKey` at UI boundary).

`lib/nav/match.ts`:

```ts
import type { NavItem, NavSection } from './types'

function pathOnly(href: string): string {
  return href.split('?')[0] || href
}

export function isNavItemActive(
  pathname: string,
  search: string,
  item: Pick<NavItem, 'href' | 'settingsTab'>,
): boolean {
  const base = pathOnly(item.href)
  if (item.settingsTab) {
    if (pathname !== '/settings' && !pathname.startsWith('/settings/')) return false
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    const tab = params.get('tab')
    if (item.settingsTab === 'email') return !tab || tab === 'email'
    return tab === item.settingsTab
  }
  if (base === '/') return pathname === '/'
  if (pathname === base) return true
  return pathname.startsWith(`${base}/`)
}

export function findActiveNavItem(
  pathname: string,
  search: string,
  sections: NavSection[],
): NavItem | null {
  const flat: NavItem[] = []
  for (const s of sections) {
    for (const item of s.items) {
      flat.push(item)
      if (item.children) flat.push(...item.children)
    }
  }
  const matches = flat.filter((i) => isNavItemActive(pathname, search, i))
  if (matches.length === 0) return null
  matches.sort((a, b) => {
    const pl = pathOnly(b.href).length - pathOnly(a.href).length
    if (pl !== 0) return pl
    return (b.settingsTab?.length ?? 0) - (a.settingsTab?.length ?? 0)
  })
  return matches[0]
}
```

`lib/nav/roles.ts`:

```ts
import type { NavItem, NavSection } from './types'

function allowed(item: NavItem, isAdmin: boolean): boolean {
  if (isAdmin) return item.roles.includes('admin') || item.roles.includes('member')
  return item.roles.includes('member')
}

export function filterNavSections(
  sections: NavSection[],
  ctx: { isAdmin: boolean; isPlatformAdmin: boolean },
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => allowed(item, ctx.isAdmin))
        .map((item) =>
          item.children
            ? {
                ...item,
                children: item.children.filter((c) => allowed(c, ctx.isAdmin)),
              }
            : item,
        ),
    }))
    .filter((section) => section.items.length > 0)
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/nav/
git commit -m "feat(nav): add match and role-filter helpers"
```

---

### Task 2: Collapse persistence helpers

**Files:**

- Create: `lib/nav/collapse.ts`
- Create: `lib/nav/collapse.test.ts`

**Interfaces:**

- Consumes: `NavSection`, `findActiveNavItem` / section lookup
- Produces:
  - `export const NAV_COLLAPSE_STORAGE_KEY = 'kasa-nav-open-sections'`
  - `export function readOpenSections(storage?: Storage): string[]`
  - `export function writeOpenSections(ids: string[], storage?: Storage): void`
  - `export function ensureSectionOpen(openIds: string[], sectionId: string): string[]`
  - `export function sectionIdForPath(pathname: string, search: string, sections: NavSection[]): string | null`

- [ ] **Step 1: Write failing tests**

```ts
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readOpenSections,
  writeOpenSections,
  ensureSectionOpen,
  sectionIdForPath,
  NAV_COLLAPSE_STORAGE_KEY,
} from './collapse'
import type { NavSection } from './types'

const sections: NavSection[] = [
  {
    id: 'money',
    labelKey: 'nav.section.money',
    items: [{ id: 'payments', href: '/payments', labelKey: 'nav.payments', roles: ['admin'] }],
  },
]

describe('nav collapse', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips open section ids', () => {
    writeOpenSections(['money', 'people'])
    expect(readOpenSections()).toEqual(['money', 'people'])
    expect(localStorage.getItem(NAV_COLLAPSE_STORAGE_KEY)).toBeTruthy()
  })

  it('ensures section open without duplicates', () => {
    expect(ensureSectionOpen(['people'], 'money').sort()).toEqual(['money', 'people'])
    expect(ensureSectionOpen(['money'], 'money')).toEqual(['money'])
  })

  it('resolves section for pathname', () => {
    expect(sectionIdForPath('/payments', '', sections)).toBe('money')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run lib/nav/collapse.test.ts`

- [ ] **Step 3: Implement `collapse.ts`**

Use `findActiveNavItem` from `./match` then find parent section id; for nested children, parent section still owns the item. Guard `typeof window` / missing `localStorage` (return `[]` / no-op).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/nav/collapse.ts lib/nav/collapse.test.ts
git commit -m "feat(nav): add collapsible section persistence helpers"
```

---

### Task 3: Declarative nav config + i18n keys

**Files:**

- Create: `lib/nav/config.ts`
- Create: `lib/nav/index.ts`
- Create: `lib/nav/config.test.ts` (assert required hrefs exist; member filter shape)
- Modify: all `lib/i18n/messages/*.json` for new keys

**Interfaces:**

- Produces: `export const PRIMARY_NAV_SECTIONS: NavSection[]` (without React icon nodes — store `iconName: string` on items; Sidebar maps names → Heroicons)
- Extend `NavItem` with `iconName?: string` in types if not already

**Member expansion (locked for this plan):** After checking existing page gates, default member-visible primary items are: Dashboard (`/`), Families (`/families`), Help (`/help`). Do **not** add Statements/Payments for members unless a focused RBAC check in this task proves the page is already member-accessible — document the check result in the commit body. Prefer staying conservative.

**Settings children:** Flat list under Settings section (not infinite nesting): each item `href: '/settings'`, `settingsTab: '<id>'`, matching `SettingsNav` ids (`email`, `branding`, `members`, …). Privileged tabs: `roles: ['admin']` only (owners are `isAdmin` today). Non-privileged settings tabs that admins see: also `roles: ['admin']` (members never get Settings).

**Money / Comms items:** Include `/payments`, `/payments/disputes`, `/collections`, `/calculations`, `/projections`, `/statements`, and communications routes from `CommunicationsNav` LINKS — all `roles: ['admin']` except member set above.

- [ ] **Step 1: Write config shape test**

```ts
import { describe, it, expect } from 'vitest'
import { PRIMARY_NAV_SECTIONS } from './config'
import { filterNavSections } from './roles'

describe('PRIMARY_NAV_SECTIONS', () => {
  it('includes disputes and settings members tab', () => {
    const hrefs = PRIMARY_NAV_SECTIONS.flatMap((s) =>
      s.items.map((i) => i.href + (i.settingsTab ?? '')),
    )
    expect(hrefs.some((h) => h.includes('/payments/disputes'))).toBe(true)
    expect(PRIMARY_NAV_SECTIONS.some((s) => s.items.some((i) => i.settingsTab === 'members'))).toBe(
      true,
    )
  })

  it('member tree is only dashboard families help', () => {
    const out = filterNavSections(PRIMARY_NAV_SECTIONS, {
      isAdmin: false,
      isPlatformAdmin: false,
    })
    const ids = out.flatMap((s) => s.items.map((i) => i.id)).sort()
    expect(ids).toEqual(['dashboard', 'families', 'help'].sort())
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `config.ts` + locale keys**

Add keys to **`en-US.json` and `he-IL.json` at minimum** (validate.test.ts requires he-IL to include every en-US key). Mirror into other locale files if the project’s CI expects full parity; otherwise follow existing “fallback to en-US” convention for non-he locales.

- `nav.section.overview`, `nav.section.settings` (replace/retire `nav.section.system` if unused)
- `nav.skipToContent`: "Skip to main content"
- `nav.memberLimited`: "Member — limited access"
- `nav.disputes` or reuse `payments.nav.disputes`
- Comms child keys: reuse `communications.nav.*`
- Shortcut keys as needed: `shortcuts.goSettings`, `shortcuts.goCommunications`, etc.

`lib/nav/index.ts` re-exports types + helpers + `PRIMARY_NAV_SECTIONS`.

- [ ] **Step 4: Run config test + `npx vitest run lib/i18n/messages/validate.test.ts` — PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/nav/ lib/i18n/messages/
git commit -m "feat(nav): add primary nav config and locale keys"
```

---

### Task 4: Sidebar collapsible rewrite

**Files:**

- Modify: `app/components/Sidebar.tsx`
- Create: `app/components/Sidebar.a11y.test.tsx`
- Modify: `app/components/MobileTopBar.tsx` only if title map needs new paths (disputes, comms children)

**Interfaces:**

- Consumes: `PRIMARY_NAV_SECTIONS`, `filterNavSections`, collapse helpers, `findActiveNavItem`, `useOrgRole`, `useT`, `usePathname`, `useSearchParams`

- [ ] **Step 1: Write Sidebar a11y test**

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/payments',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/client/OrgRoleContext', () => ({
  useOrgRole: () => ({ role: 'admin', isAdmin: true, loading: false }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => key,
}))

// Mock session/org switcher deps as needed so Sidebar mounts — follow patterns from existing Sidebar tests if any; otherwise mock child-heavy imports.

describe('Sidebar a11y', () => {
  beforeEach(() => localStorage.clear())

  it('marks money section expanded on /payments and toggles aria-expanded', async () => {
    // Import Sidebar after mocks
    const Sidebar = (await import('./Sidebar')).default
    render(<Sidebar />)
    const moneyToggle = screen.getByRole('button', { name: /nav.section.money/i })
    expect(moneyToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(moneyToggle)
    expect(moneyToggle).toHaveAttribute('aria-expanded', 'false')
  })
})
```

Adapt mocks until Sidebar renders (OrgSwitcher, ThemeToggle, etc. — mock modules that fetch).

- [ ] **Step 2: Run — expect FAIL / incomplete**

- [ ] **Step 3: Rewrite Sidebar nav body**

- Replace `allNavSections` with `filterNavSections(PRIMARY_NAV_SECTIONS, …)`
- Map `iconName` → Heroicon component dictionary in Sidebar
- Section label button toggles open set; persist via `writeOpenSections`
- On pathname/search change: `ensureSectionOpen(…, sectionIdForPath(…))`
- Links: `href={item.settingsTab ? `/settings?tab=${item.settingsTab}` : item.href}` (email tab may omit query)
- Active: `findActiveNavItem` → `aria-current="page"` on that link only
- Keep OrgSwitcher, search, footer account/platform admin; use `t('nav.memberLimited')` for member footer cue
- Platform admin footer: keep links; i18n any remaining hardcoded strings

- [ ] **Step 4: Run Sidebar a11y + related smokes — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/components/Sidebar.tsx app/components/Sidebar.a11y.test.tsx app/components/MobileTopBar.tsx
git commit -m "feat(shell): render collapsible sidebar from nav config"
```

---

### Task 5: AppShell skip-link + drawer a11y

**Files:**

- Modify: `app/components/AppShell.tsx`
- Modify: `app/globals.css` (`.skip-link` `left` → `inset-inline-start`)
- Create: `app/components/AppShell.smoke.test.tsx` if missing — fullscreen bypass + skip-link key

**Interfaces:**

- Consumes: `useT` → `nav.skipToContent`
- Produces: focus return to hamburger when drawer closes via Escape (store trigger ref from MobileTopBar via callback or document.getElementById)

- [ ] **Step 1: Failing test for skip-link text using t()**

Render AppShell with i18n mock returning `nav.skipToContent` → expect that text in the skip link (not hardcoded English only). Fullscreen path still bypasses chrome.

- [ ] **Step 2: Run — FAIL if still hardcoded**

- [ ] **Step 3: Implement**

```tsx
const t = useT()
// ...
<a href="#main-content" className="skip-link">
  {t('nav.skipToContent')}
</a>
```

CSS:

```css
.skip-link {
  /* ... */
  inset-inline-start: 8px;
  /* remove physical left: 8px */
}
```

Wire `menuButtonRef` / `id="mobile-nav-trigger"` on MobileTopBar hamburger; on Escape close, `document.getElementById('mobile-nav-trigger')?.focus()`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add app/components/AppShell.tsx app/components/MobileTopBar.tsx app/globals.css app/components/AppShell.smoke.test.tsx
git commit -m "fix(shell): i18n skip-link and drawer focus restore"
```

---

### Task 6: Remove redundant Payments / Communications TabNavs

**Files:**

- Modify: every file importing `PaymentsNav` or `CommunicationsNav` — remove the component JSX
- Delete or gut: `app/payments/_components/PaymentsNav.tsx`, `app/communications/_components/CommunicationsNav.tsx`

**Interfaces:**

- Consumes: sidebar now owns those hrefs
- Produces: pages keep the same routes; only chrome removed

- [ ] **Step 1: Grep and list call sites**

Run: `rg "PaymentsNav|CommunicationsNav" -g "*.tsx"`

- [ ] **Step 2: Write a tiny regression test** (optional file `app/payments/PaymentsView.nav.test.tsx`) that renders PaymentsView with heavy mocks and asserts `payments.nav.all` TabNav label is absent — only if cheap; otherwise rely on grep + manual. Prefer: unit test file that imports PaymentsView source string… **No.** Instead add to an existing smoke: after removal, smoke still passes.

- [ ] **Step 3: Remove imports/usages; delete nav components**

- [ ] **Step 4: Run payments/communications smokes — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/payments app/communications
git commit -m "refactor(nav): remove Payments and Communications TabNav chrome"
```

---

### Task 7: SettingsView without SettingsNav chrome

**Files:**

- Modify: `app/settings/SettingsView.tsx` — remove `SettingsNav` from layout; keep `?tab=` URL sync and panel switching
- Modify: `app/components/settings/SettingsNav.tsx` — keep exporting `SettingsTabId` type (move type to `lib/nav/settings-tabs.ts` if cleaner); delete UI or leave unused file deleted
- Create: `lib/nav/settings-tabs.ts` with `SETTINGS_TAB_IDS` const + type for SettingsView validation

**Interfaces:**

- Produces: `export const SETTINGS_TAB_IDS = […] as const` / `export type SettingsTabId = typeof SETTINGS_TAB_IDS[number]`

- [ ] **Step 1: Failing test — SettingsView does not render settings.nav.ariaLabel**

Mock SettingsView deps; assert `queryByRole('navigation', { name: … })` null for settings side nav. If too heavy, assert SettingsNav is no longer imported via a lightweight eslint-free check in a test that reads the SettingsView file… Prefer behavioral mock render.

- [ ] **Step 2: FAIL**

- [ ] \*\*Step 3: Implement layout without SettingsNav; move `SettingsTabId` to `lib/nav/settings-tabs.ts`; update imports; delete `SettingsNav.tsx` if unused

- [ ] **Step 4: Settings smokes / typecheck — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/settings app/components/settings lib/nav/settings-tabs.ts
git commit -m "refactor(settings): rely on sidebar for settings destinations"
```

---

### Task 8: Keyboard shortcuts from nav config

**Files:**

- Create: `lib/nav/shortcuts.ts`
- Create: `lib/nav/shortcuts.test.ts`
- Modify: `app/components/KeyboardShortcuts.tsx`
- Modify: `app/components/KeyboardShortcuts.smoke.test.tsx` as needed
- Locale keys for any new shortcut labels

**Interfaces:**

- Produces: `export function getNavShortcutHelpItems(): { keys: string; labelKey: string; href?: string }[]`
- Keep global `?`, `/`, `Ctrl+K` as shell-level entries merged in KeyboardShortcuts

Existing: `g f` families, `g p` payments, `g e` events, `g t` tasks. Add from config `shortcut` fields: e.g. `g s` → `/settings`, `g c` → `/communications` (document letters in config to avoid collisions).

- [ ] **Step 1: Test shortcuts list includes g f and g p from config**

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement shortcut map + wire KeyboardShortcuts navigation to `router.push(href)` using the same map; help modal maps `getNavShortcutHelpItems()` + search/help entries**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/nav/shortcuts.ts lib/nav/shortcuts.test.ts app/components/KeyboardShortcuts.tsx lib/i18n/messages
git commit -m "feat(nav): drive keyboard shortcuts from nav config"
```

---

### Task 9: Design-system note + kit verification

**Files:**

- Modify: `docs/design-system/README.md` — add “App shell IA” section pointing at the nav config and collapse behavior
- Run full related tests

- [ ] **Step 1: Append docs section** (no test required)

- [ ] **Step 2: Run**

```bash
npx vitest run lib/nav app/components/Sidebar.a11y.test.tsx app/components/AppShell.smoke.test.tsx app/components/KeyboardShortcuts.smoke.test.tsx
npx vitest run lib/i18n/messages/validate.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/design-system/README.md
git commit -m "docs(ui): document app shell navigation IA"
```

---

## Manual verification (after Task 9)

1. Admin: collapsible Money/Comms/Settings; Disputes + settings tabs from sidebar
2. Member: only Dashboard / Families / Help (+ footer cue)
3. Mobile drawer Escape restores focus to hamburger
4. RTL skip-link / sidebar; light/dark
5. `g f` / `g p` / new shortcuts; `?` help lists them

---

## Spec coverage self-review

| Spec requirement                    | Task(s)                     |
| ----------------------------------- | --------------------------- |
| Config-driven nav                   | 1–3                         |
| Collapsible + persist + auto-expand | 2, 4                        |
| Promote Payments/Comms/Settings     | 3, 4, 6, 7                  |
| Member expansion careful            | 3 (conservative member set) |
| Slim/remove TabNavs                 | 6, 7                        |
| Skip-link i18n + logical CSS        | 5                           |
| Shortcuts from config               | 8                           |
| Tests + design-system note          | 1–2, 4–5, 8–9               |
| No page workflow redesign           | Global                      |

**Placeholder scan:** Cleared — member Statements expansion deferred unless RBAC proves access (explicit conservative rule in Task 3).

**Type consistency:** `NavItem` / `NavSection` / `settingsTab` / `filterNavSections` / collapse helpers named consistently across tasks.
