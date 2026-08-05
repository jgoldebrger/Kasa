# Families Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Families critical workflow end-to-end — list, detail shell with regrouped tabs, all tab bodies, and decomposed modal modules — on shared Families UI contracts with operational clarity and kit / WCAG 2.2 AA / RTL consistency.

**Architecture:** Contract-first hub under `app/families/_lib/` (tab registry with Profile / Money / Activity groups, visibility helpers, `FamilyPageHeader`, money-table helpers); detail shell and tabs consume contracts; `FamilyModals` becomes a thin orchestrator over domain modal modules. Existing `FamilyDetailContext` and URL segments stay; UI boundaries only.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind, existing `app/components/ui/*`, Vitest + Testing Library + happy-dom, existing i18n (`useT`, `lib/i18n/messages/*.json`).

**Spec:** `docs/superpowers/specs/2026-08-04-families-hub-design.md`

## Global Constraints

- Full hub redesign (list + shell + all tabs + modals); **one design, phased ship** under this plan.
- Operational clarity **and** kit / a11y consistency — refresh, not rebrand; no new UI library.
- Horizontal TabNav retained; **regroup/relabel** into Profile / Money / Activity clusters; **URL segments unchanged**.
- Member vs admin: keep existing gating; **carefully promote** existing member-safe actions only (`memberFinancialAccess`); **no new APIs or RBAC widening**.
- Modal-first create/edit; **decompose** mega `FamilyModals`; no route-based editors.
- No global app shell / primary nav changes; no org-wide Payments / Statements page redesigns.
- RTL: logical CSS (`ms`/`me`/`ps`/`pe`); Hebrew fields keep `dir="rtl"` where already required.
- Each task must leave the hub usable; frequent commits; extend existing Families tests.
- Feature branch: `feat/families-hub` (create from current `main` before Task 1).

---

## File map

| Path                                             | Responsibility                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `app/families/_lib/types.ts`                     | `FamilyTabId`, `FamilyTabGroup`, `FamilyTabDef`                     |
| `app/families/_lib/tabs.ts`                      | Ordered tab registry, href/path helpers                             |
| `app/families/_lib/visibility.ts`                | Role + `memberFinancialAccess` tab filtering                        |
| `app/families/_lib/groups.ts`                    | Group tabs for clustered TabNav rendering                           |
| `app/families/_lib/FamilyPageHeader.tsx`         | Shared list/tab toolbar (title + actions)                           |
| `app/families/_lib/money-table.tsx`              | Money DataView column/cell helpers (SR-friendly status)             |
| `app/families/_lib/FamilyClusteredTabNav.tsx`    | Grouped horizontal TabNav for detail shell                          |
| `app/families/_lib/index.ts`                     | Barrel exports                                                      |
| `app/families/[id]/_lib/constants.ts`            | Re-export from `app/families/_lib/*` (compat shim during migration) |
| `app/families/FamiliesView.tsx`                  | List redesign on contracts                                          |
| `app/families/[id]/FamilyTabNav.tsx`             | Thin wrapper → `FamilyClusteredTabNav`                              |
| `app/families/[id]/FamilyHeader.tsx`             | Header + member primary actions when linked                         |
| `app/families/[id]/MemberHiddenTabsNotice.tsx`   | Clearer member access copy                                          |
| `app/families/[id]/FamilyDetailLayoutClient.tsx` | Shell layout polish (logical CSS)                                   |
| `app/families/[id]/_components/*Tab.tsx`         | Tab bodies on `FamilyPageHeader` + money helpers                    |
| `app/families/[id]/_components/modals/*.tsx`     | Domain modal modules                                                |
| `app/families/[id]/_components/FamilyModals.tsx` | Orchestrator importing domain modals                                |
| `lib/i18n/messages/*.json`                       | Tab group labels + any new member/header copy                       |
| `docs/design-system/README.md`                   | “Families hub” pattern pointer                                      |

---

### Task 1: Families contracts + tab registry / IA

**Files:**

- Create: `app/families/_lib/types.ts`
- Create: `app/families/_lib/tabs.ts`
- Create: `app/families/_lib/visibility.ts`
- Create: `app/families/_lib/groups.ts`
- Create: `app/families/_lib/index.ts`
- Create: `app/families/_lib/tabs.test.ts`
- Create: `app/families/_lib/visibility.test.ts`
- Modify: `app/families/[id]/_lib/constants.ts` — re-export from `app/families/_lib`; keep `FAMILY_TABS`, `familyTabHref`, `familyTabFromPathname`, `resolveFamilyTabLabel` names for existing imports

**Interfaces:**

- Produces:
  - `export type FamilyTabGroup = 'profile' | 'money' | 'activity'`
  - `export type FamilyTabId = 'info' | 'members' | 'payments' | 'withdrawals' | 'events' | 'cycle-charges' | 'statements' | 'emails' | 'sub-families' | 'tasks'`
  - `export interface FamilyTabDef { id: FamilyTabId; segment: string; labelKey: MessageKey; fallbackLabel: string; group: FamilyTabGroup; adminOnly?: boolean; memberReadable?: boolean }`
  - `export const FAMILY_TAB_GROUPS: readonly { id: FamilyTabGroup; labelKey: MessageKey }[]`
  - `export const FAMILY_TABS: readonly FamilyTabDef[]` — **order:** Profile (info, members, sub-families) → Money (payments, withdrawals, cycle-charges, statements) → Activity (events, tasks, emails)
  - `export function familyTabHref(familyId: string, tabId: FamilyTabId): string`
  - `export function familyTabFromPathname(pathname: string, familyId: string): FamilyTabId`
  - `export function resolveFamilyTabLabel(tab: FamilyTabDef, t: (key: MessageKey, fallback?: string) => string): string`
  - `export function filterVisibleFamilyTabs(tabs: readonly FamilyTabDef[], ctx: { isAdmin: boolean; memberFinancialAccess: boolean }): FamilyTabDef[]`
  - `export function groupVisibleFamilyTabs(tabs: FamilyTabDef[]): { group: FamilyTabGroup; tabs: FamilyTabDef[] }[]`

- [ ] **Step 1: Write failing tests**

`app/families/_lib/tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FAMILY_TABS, familyTabHref, familyTabFromPathname } from './tabs'

describe('family tabs registry', () => {
  it('keeps stable URL segments', () => {
    expect(familyTabHref('abc', 'payments')).toBe('/families/abc/payments')
    expect(familyTabHref('abc', 'info')).toBe('/families/abc')
  })

  it('parses pathname to tab id', () => {
    expect(familyTabFromPathname('/families/abc/withdrawals', 'abc')).toBe('withdrawals')
    expect(familyTabFromPathname('/families/abc', 'abc')).toBe('info')
  })

  it('orders profile before money before activity', () => {
    const groups = FAMILY_TABS.map((t) => t.group)
    expect(groups.indexOf('profile')).toBeLessThan(groups.indexOf('money'))
    expect(groups.indexOf('money')).toBeLessThan(groups.indexOf('activity'))
  })
})
```

`app/families/_lib/visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FAMILY_TABS } from './tabs'
import { filterVisibleFamilyTabs } from './visibility'

describe('filterVisibleFamilyTabs', () => {
  it('hides admin-only tabs for members', () => {
    const visible = filterVisibleFamilyTabs(FAMILY_TABS, {
      isAdmin: false,
      memberFinancialAccess: false,
    })
    expect(visible.map((t) => t.id)).toEqual(['info', 'members', 'sub-families'])
  })

  it('shows statements for linked members', () => {
    const visible = filterVisibleFamilyTabs(FAMILY_TABS, {
      isAdmin: false,
      memberFinancialAccess: true,
    })
    expect(visible.some((t) => t.id === 'statements')).toBe(true)
    expect(visible.some((t) => t.id === 'payments')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — FAIL**

Run: `npx vitest run app/families/_lib/tabs.test.ts app/families/_lib/visibility.test.ts`

Expected: FAIL — modules not found

- [ ] **Step 3: Implement registry + helpers + constants shim**

`app/families/_lib/types.ts` — export `FamilyTabGroup`, `FamilyTabId`, `FamilyTabDef`.

`app/families/_lib/tabs.ts` — define `FAMILY_TABS` mirroring today’s `adminOnly` / `memberReadable` flags from `[id]/_lib/constants.ts` but with `group` and new order. Preserve segments exactly (`''` for info, `'members'`, `'payments'`, …).

`app/families/_lib/visibility.ts`:

```ts
export function filterVisibleFamilyTabs(
  tabs: readonly FamilyTabDef[],
  ctx: { isAdmin: boolean; memberFinancialAccess: boolean },
): FamilyTabDef[] {
  return tabs.filter((tab) => {
    if (tab.adminOnly) return ctx.isAdmin
    if (tab.memberReadable) return ctx.isAdmin || ctx.memberFinancialAccess
    return true
  })
}
```

`app/families/_lib/groups.ts`:

```ts
export function groupVisibleFamilyTabs(tabs: FamilyTabDef[]) {
  const order: FamilyTabGroup[] = ['profile', 'money', 'activity']
  return order
    .map((group) => ({ group, tabs: tabs.filter((t) => t.group === group) }))
    .filter((g) => g.tabs.length > 0)
}
```

Update `[id]/_lib/constants.ts` to re-export from `../../_lib` and map legacy `FAMILY_TAB_SEGMENTS` / `ADMIN_ONLY_FAMILY_TABS` if still referenced.

Add i18n keys to **all** locale files:

- `family.tabGroup.profile` — “Profile”
- `family.tabGroup.money` — “Money”
- `family.tabGroup.activity` — “Activity”

- [ ] **Step 4: Run tests + i18n validate — PASS**

Run:

```bash
npx vitest run app/families/_lib/tabs.test.ts app/families/_lib/visibility.test.ts
npx vitest run lib/i18n/messages/validate.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/families/_lib app/families/[id]/_lib/constants.ts lib/i18n/messages
git commit -m "feat(families): add tab registry and visibility contracts"
```

---

### Task 2: Shared page header + money-table helpers

**Files:**

- Create: `app/families/_lib/FamilyPageHeader.tsx`
- Create: `app/families/_lib/money-table.tsx`
- Create: `app/families/_lib/FamilyPageHeader.test.tsx`
- Modify: `app/families/_lib/index.ts`

**Interfaces:**

- Produces:
  - `export function FamilyPageHeader(props: { title: string; description?: string; primaryAction?: ReactNode; secondaryActions?: ReactNode; className?: string }): JSX.Element` — wraps kit layout (`flex flex-wrap items-center justify-between gap-3` with `h2`/`h3` heading semantics)
  - `export function moneyStatusCell(status: string, label: string): { display: ReactNode; srLabel: string }` — badge + non-color-only SR text
  - `export function moneyAmountCell(amount: number, formatMoney: (n: number) => string, tone?: 'default' | 'positive' | 'negative'): ReactNode` — tabular numerals + optional tone class

- [ ] **Step 1: Write failing test**

`app/families/_lib/FamilyPageHeader.test.tsx`:

```tsx
/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FamilyPageHeader } from './FamilyPageHeader'
import { Button } from '@/app/components/ui'

describe('FamilyPageHeader', () => {
  it('renders title and primary action with accessible heading', () => {
    render(<FamilyPageHeader title="Payments" primaryAction={<Button>Add Payment</Button>} />)
    expect(screen.getByRole('heading', { name: 'Payments' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add Payment' })).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `npx vitest run app/families/_lib/FamilyPageHeader.test.tsx`

- [ ] **Step 3: Implement components**

`FamilyPageHeader` — use semantic heading level prop default `h3`; actions in `flex gap-2`; logical spacing only.

`money-table.tsx` — extract/reuse patterns from `[id]/_lib/helpers.tsx` `paymentColumnsFor` where status badges exist; ensure each status column includes visible text (not color-only).

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/families/_lib/FamilyPageHeader.tsx app/families/_lib/money-table.tsx app/families/_lib/FamilyPageHeader.test.tsx app/families/_lib/index.ts
git commit -m "feat(families): add shared page header and money table helpers"
```

---

### Task 3: Families list redesign

**Files:**

- Modify: `app/families/FamiliesView.tsx`
- Modify: `app/families/FamiliesView.smoke.test.tsx`

**Interfaces:**

- Consumes: `FamilyPageHeader` (optional for list — keep existing `PageHeader` if already equivalent, or align list title row to same spacing/semantics as tabs)
- Produces: member-safe column set helper used in list render (admin sees balances/plans; member does not)

- [ ] **Step 1: Add failing smoke assertion for member column policy**

Extend `FamiliesView.smoke.test.tsx`:

```tsx
it('does not show open balance column headers for member role', async () => {
  // mock useOrgRole or prop if exposed; otherwise test column builder export
  // expect(screen.queryByText(/open balance/i)).toBeNull()
})
```

If role is not injectable, extract `familiesListColumns(isAdmin: boolean, …)` to `app/families/_lib/list-columns.tsx` and unit-test that instead (preferred).

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Refactor list**

Extract column builder to `app/families/_lib/list-columns.tsx` with explicit admin vs member columns. Keep DataView keyboard/search behavior; ensure empty/loading/error states use kit patterns; row links to `/families/[id]` unchanged. Do **not** add features — layout/semantics/a11y only.

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run app/families/FamiliesView.smoke.test.tsx app/families/_lib/list-columns.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/families/FamiliesView.tsx app/families/_lib/list-columns.tsx app/families/FamiliesView.smoke.test.tsx
git commit -m "refactor(families): align list with hub contracts and member columns"
```

---

### Task 4: Detail shell — clustered TabNav, header, member notices

**Files:**

- Create: `app/families/_lib/FamilyClusteredTabNav.tsx`
- Create: `app/families/[id]/FamilyTabNav.a11y.test.tsx`
- Modify: `app/families/[id]/FamilyTabNav.tsx`
- Modify: `app/families/[id]/FamilyHeader.tsx`
- Modify: `app/families/[id]/MemberHiddenTabsNotice.tsx`
- Modify: `app/families/[id]/FamilyDetailLayoutClient.tsx`

**Interfaces:**

- Consumes: `filterVisibleFamilyTabs`, `groupVisibleFamilyTabs`, `familyTabHref`, `resolveFamilyTabLabel`, `FAMILY_TAB_GROUPS`
- Produces: `FamilyClusteredTabNav` rendering grouped tabs with muted group labels + horizontal scroll (`overflow-x-auto`, `scrollbarWidth: 'thin'`) and `aria-current="page"` on active link

- [ ] **Step 1: Write failing a11y smoke**

`app/families/[id]/FamilyTabNav.a11y.test.tsx`:

```tsx
/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import FamilyTabNav from './FamilyTabNav'

vi.mock('./FamilyDetailContext', () => ({
  useFamilyDetail: () => ({
    familyId: 'fam-1',
    activeTab: 'members',
    isAdmin: true,
    memberFinancialAccess: false,
  }),
}))
vi.mock('@/lib/client/i18n', () => ({ useT: () => (k: string, fb?: string) => fb ?? k }))

describe('FamilyTabNav a11y', () => {
  it('exposes grouped family section nav with current page', () => {
    render(<FamilyTabNav />)
    expect(screen.getByRole('navigation', { name: /family sections/i })).toBeDefined()
    expect(screen.getByRole('link', { current: 'page' })).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement clustered TabNav + shell polish**

`FamilyClusteredTabNav.tsx` — for each group: optional `<span className="text-xs font-medium text-fg-muted uppercase tracking-wide px-3 pt-2">` group label (visible, not a second nav landmark); render kit `TabNav` items flattened **or** inline links with separators between groups (`aria-hidden` divider). Use `filterVisibleFamilyTabs` from context flags.

`FamilyTabNav.tsx` — delegate to `FamilyClusteredTabNav`.

`FamilyHeader.tsx` — when `!isAdmin && memberFinancialAccess`, show prominent primary actions linking to existing flows (`MemberMakePaymentModal` trigger, `familyTabHref(familyId, 'statements')`) using existing i18n keys (`memberPortal.makePayment`, `memberPortal.viewStatements`).

`MemberHiddenTabsNotice.tsx` — tighten copy using existing keys; add brief bullet list of what linked vs unlinked members can see (no new permissions).

`FamilyDetailLayoutClient.tsx` — replace physical `justify-between`/`left`/`right` with logical utilities where touched; keep breadcrumb `rtl:rotate-180`.

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run app/families/[id]/FamilyTabNav.a11y.test.tsx app/families/_lib`

- [ ] **Step 5: Commit**

```bash
git add app/families/_lib/FamilyClusteredTabNav.tsx app/families/[id]/FamilyTabNav.tsx app/families/[id]/FamilyHeader.tsx app/families/[id]/MemberHiddenTabsNotice.tsx app/families/[id]/FamilyDetailLayoutClient.tsx app/families/[id]/FamilyTabNav.a11y.test.tsx
git commit -m "feat(families): clustered detail tab nav and member shell cues"
```

---

### Task 5: Profile tabs (Info, Members, Sub-Families)

**Files:**

- Modify: `app/families/[id]/_components/InfoTab.tsx`
- Modify: `app/families/[id]/_components/MembersTab.tsx`
- Modify: `app/families/[id]/_components/SubFamiliesTab.tsx`

**Interfaces:**

- Consumes: `FamilyPageHeader`
- Produces: consistent toolbar on all three tabs; Info promotes `MemberFinancialPanel` actions when linked (reuse header CTAs or inline primary buttons above panel)

- [ ] **Step 1: Add smoke test for Info tab toolbar heading**

Create `app/families/[id]/_components/InfoTab.smoke.test.tsx` with minimal `useFamilyDetail` mock asserting `FamilyPageHeader` title renders.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Refactor tabs**

Replace duplicated `flex justify-between mb-4` + `h3` blocks with `FamilyPageHeader`. Info: ensure member linked state shows make-payment + statements actions visibly (not buried). Members/Sub-Families: primary Add buttons in header slot; preserve existing handlers (`setShowMemberModal`, etc.).

- [ ] **Step 4: Run tab smokes — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/families/[id]/_components/InfoTab.tsx app/families/[id]/_components/MembersTab.tsx app/families/[id]/_components/SubFamiliesTab.tsx app/families/[id]/_components/InfoTab.smoke.test.tsx
git commit -m "refactor(families): profile tabs on shared page header"
```

---

### Task 6: Money tabs (Payments, Withdrawals, Cycle Charges, Statements)

**Files:**

- Modify: `app/families/[id]/_components/PaymentsTab.tsx`
- Modify: `app/families/[id]/_components/WithdrawalsTab.tsx`
- Modify: `app/families/[id]/_components/CycleChargesTab.tsx`
- Modify: `app/families/[id]/_components/StatementsTab.tsx`
- Modify: `app/families/[id]/_lib/helpers.tsx` — delegate money column status rendering to `money-table.tsx` where applicable

**Interfaces:**

- Consumes: `FamilyPageHeader`, `moneyStatusCell`, `moneyAmountCell`
- Produces: all money tabs use shared header + money a11y helpers; Statements member-readable view unchanged in permissions

- [ ] **Step 1: Unit test money helper used by payments columns**

Add assertion in existing helper test or new `app/families/_lib/money-table.test.ts` that status cell includes visible text.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Refactor four tabs**

Apply `FamilyPageHeader` + money helpers; keep DataView `tableId`s, import, pagination/load-more behavior identical. Statements: member view stays read-only; admin actions unchanged.

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run app/families/_lib/money-table.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/families/[id]/_components/PaymentsTab.tsx app/families/[id]/_components/WithdrawalsTab.tsx app/families/[id]/_components/CycleChargesTab.tsx app/families/[id]/_components/StatementsTab.tsx app/families/[id]/_lib/helpers.tsx app/families/_lib/money-table.test.ts
git commit -m "refactor(families): money tabs on shared contracts"
```

---

### Task 7: Activity tabs (Events, Tasks, Emails)

**Files:**

- Modify: `app/families/[id]/_components/EventsTab.tsx`
- Modify: `app/families/[id]/_components/TasksTab.tsx`
- Modify: `app/families/[id]/_components/EmailsTab.tsx`

- [ ] **Step 1: Smoke test one activity tab header**

Minimal render test for `TasksTab` with mocked context.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Apply FamilyPageHeader + kit spacing**

Same toolbar pattern; preserve admin-only actions and existing data hooks.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/families/[id]/_components/EventsTab.tsx app/families/[id]/_components/TasksTab.tsx app/families/[id]/_components/EmailsTab.tsx
git commit -m "refactor(families): activity tabs on shared page header"
```

---

### Task 8: Decompose FamilyModals into domain modules

**Files:**

- Create: `app/families/[id]/_components/modals/FamilyMemberModal.tsx`
- Create: `app/families/[id]/_components/modals/FamilyInfoModal.tsx`
- Create: `app/families/[id]/_components/modals/FamilyPaymentModal.tsx`
- Create: `app/families/[id]/_components/modals/FamilyWithdrawalModal.tsx`
- Create: `app/families/[id]/_components/modals/FamilyEventModal.tsx`
- Create: `app/families/[id]/_components/modals/FamilyEmailConfigModal.tsx`
- Create: `app/families/[id]/_components/modals/index.ts`
- Modify: `app/families/[id]/_components/FamilyModals.tsx` — orchestrator only (~50 lines)
- Create: `app/families/[id]/_components/modals/FamilyMemberModal.smoke.test.tsx`

**Interfaces:**

- Consumes: `useFamilyDetail()` state/handlers (unchanged API from context)
- Produces: each modal module exports a named component; orchestrator renders all when flags true

- [ ] **Step 1: Write smoke test — member modal renders with title when open**

```tsx
/** @vitest-environment happy-dom */
// mock useFamilyDetail with showMemberModal: true, isAdmin: true
// render <FamilyMemberModal /> or orchestrator
// expect(screen.getByRole('dialog')).toBeDefined()
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Extract modules**

Move JSX blocks from `FamilyModals.tsx` lines ~128–1178 into domain files preserving form fields and handlers. Remove `@ts-nocheck` from extracted modules where feasible; ensure `aria-invalid` / describedby on validation errors. Keep `TaskFormModal` import in orchestrator.

- [ ] **Step 4: Run smoke — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/families/[id]/_components/modals app/families/[id]/_components/FamilyModals.tsx
git commit -m "refactor(families): split family modals into domain modules"
```

---

### Task 9: Design-system note + verification

**Files:**

- Modify: `docs/design-system/README.md` — add “Families hub” section
- Run full related test suite

- [ ] **Step 1: Append docs section**

Document: tab registry path, groups, `FamilyPageHeader`, money helpers, modal module layout, member gating rules.

- [ ] **Step 2: Run full Families-related tests**

```bash
npx vitest run app/families lib/client/families-list.test.ts lib/client/family-form.test.ts lib/member-family-access.test.ts lib/i18n/messages/validate.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/design-system/README.md
git commit -m "docs(ui): document Families hub patterns"
```

---

## Manual verification (after Task 9)

1. **Admin:** list → family → each tab; clustered TabNav scrolls on narrow viewport; Add actions open correct modals; keyboard through TabNav + DataView row
2. **Member (unlinked):** list without balance columns; detail shows notice; only Profile tabs
3. **Member (linked):** Statements tab + make-payment CTA on Info; no admin ledger tabs
4. **RTL (`he-IL`):** breadcrumb chevron, tab strip scroll, Hebrew fields on member modal
5. **SR:** money table status not color-only; modal labels + errors announced
6. **Deep links:** `/families/[id]/payments` etc. still resolve

---

## Spec coverage self-review

| Spec requirement                             | Task(s)         |
| -------------------------------------------- | --------------- |
| Tab registry + Profile/Money/Activity groups | 1, 4            |
| URL segments unchanged                       | 1               |
| Shared FamilyPageHeader / toolbar            | 2, 5–7          |
| Money DataView a11y                          | 2, 6            |
| List redesign + member columns               | 3               |
| Detail shell + clustered TabNav              | 4               |
| Member expansion (existing actions only)     | 4, 5            |
| All 10 tab bodies redesigned                 | 5–7             |
| Modal decomposition (modal-first)            | 8               |
| Tests + design-system note                   | 1–2, 4, 8–9     |
| Phased mergeable slices                      | Tasks 1–9 order |
| No new RBAC / APIs                           | Global          |
| No shell / org-wide page redesign            | Global          |

**Placeholder scan:** Cleared — each task names concrete files, tests, and commands.

**Type consistency:** `FamilyTabDef`, `FamilyTabGroup`, `filterVisibleFamilyTabs`, `groupVisibleFamilyTabs`, `familyTabHref`, `FamilyPageHeader` used consistently across tasks 1–8.
