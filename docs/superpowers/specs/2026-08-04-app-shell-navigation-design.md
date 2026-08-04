# App Shell & Navigation — Design Spec

**Date:** 2026-08-04  
**Status:** Approved for planning  
**Scope:** Second sub-project of the UI / UX / accessibility redesign (after design-system foundation)

## Context

Kasa’s chrome today is `AppShell` + `Sidebar` (desktop) / mobile drawer + `MobileTopBar`, with secondary `TabNav`s for Payments and Communications and a searchable Settings side nav. The design-system foundation hardened `ui/*`. This pass redesigns **information architecture and shell behavior**, not page workflows.

## Goals

- Meaningful IA change while remaining **sidebar-based** (refresh chrome, not a rebrand)
- **Promote** Payments, Communications, and Settings destinations into the primary sidebar; **slim or remove** redundant section TabNavs
- **Full IA pass** — regroup/relabel overview → people → money → comms → insights → settings → help
- **Expand member-useful** destinations carefully without exposing privileged Settings/Admin
- **Collapsible** sidebar sections: persist open/closed; auto-expand the section for the current route
- Config-driven nav shared by Sidebar, mobile drawer, and keyboard shortcuts
- Shell a11y / RTL / i18n aligned with the foundation (skip-link i18n, logical CSS, focus, drawer trap)

## Non-goals

- Page-level workflow redesigns (families, dues, statements content, etc.)
- Marketing / auth fullscreen routes (remain shell bypass)
- New UI libraries or visual rebrand
- Changing server-side permission APIs — only what the shell **shows**, derived from existing RBAC
- Platform-admin product redesign (footer tier tidy/i18n only)

## Decisions

| Topic         | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Feel          | Meaningful IA change; keep sidebar + mobile drawer           |
| Secondary nav | Promote destinations into sidebar; slim/remove TabNavs       |
| IA breadth    | Full pass (Payments, Comms, Settings sections + regrouping)  |
| Member nav    | Expand useful destinations carefully; privileged stays admin |
| Section UI    | Collapsible; persist state; auto-expand current              |
| Delivery      | Nav config module + Sidebar rewrite (Approach 1)             |

## Architecture

### Nav config

Introduce a central module (e.g. `lib/nav/config.ts` + helpers):

- Sections: `id`, `labelKey`, `items[]`
- Items: `id`, `href`, `labelKey`, `icon`, `roles` (`member` | `admin` | `platformAdmin`), optional `shortcut`, optional nested children for Settings-style groups
- Helpers: filter by role; **most-specific href** active match; collapse persist/read; section-for-pathname

`Sidebar`, mobile drawer, and `KeyboardShortcuts` consume this config — no duplicated href lists.

### Proposed primary tree

Labels via i18n. Structure:

| Section        | Items                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview       | Dashboard                                                                                                                                   |
| People         | Families; Events, Calendar, Tasks _(admin)_                                                                                                 |
| Money          | Payments, Disputes; Collections; Calculations; Projections; Statements _(member visibility only where existing route guards already allow)_ |
| Communications | Main, Templates, Scheduled, Jobs, Analytics, Automations _(admin)_                                                                          |
| Insights       | Reports _(admin)_                                                                                                                           |
| Settings       | Nested children mirroring today’s Settings sections/tabs _(admin / privileged as today)_                                                    |
| Help           | Help                                                                                                                                        |

Exact member-visible Money/People items must be derived from current RBAC at implementation time — UI must not grant access the API denies.

### Collapsible behavior

- Section headers are `<button>` with `aria-expanded` / `aria-controls`
- Open section IDs persisted (`localStorage`; prefer user/org-scoped key when available)
- On route change, force-open the section that owns the active item
- Keyboard: move among visible links; Enter/Space toggles section

### TabNav / Settings nav

- Remove or reduce to zero `PaymentsNav` and `CommunicationsNav` when sidebar covers the same hrefs
- Default: remove Settings in-page searchable side nav; rely on sidebar nesting + existing settings routes
- If Settings nesting proves too deep in implementation, an optional in-page filter may be retained — prefer removal first

### Shell layout

Keep `AppShell` structure:

- Skip-link → `MobileTopBar` → desktop sidebar / mobile drawer → `#main-content` + banners
- Desktop: fixed sidebar; content offset with logical `ms-*`
- Mobile: hamburger drawer; same nav tree; Escape / backdrop / route change closes; focus trap; restore focus to hamburger
- Fullscreen bypass unchanged (login, signup, welcome, pricing, legal, etc.)

### Platform admin

Footer cluster remains a separate tier; tidy labels and i18n only.

## Member expansion rules

- Privileged Settings and admin-only operations stay admin-gated
- Members keep Dashboard, Families, Help at minimum
- Additional member items only when existing page/API access already exists
- Optional footer cue for limited (member) access

## Accessibility, i18n, RTL

- Skip-link text via `t()`; position with logical CSS (`inset-inline-start`)
- All nav labels via message keys
- Foundation tokens, `.focus-ring`, touch targets on shell controls
- Active item: `aria-current="page"`
- Drawer: `role="dialog"`, `aria-modal`, labelled controls on hamburger (`aria-expanded` / `aria-controls`)

## Keyboard shortcuts

- Remap `g`+letter (and related) sequences to match the new IA
- `?` help modal lists bindings generated from nav config (single source of truth)

## Validation

**Automated**

- Unit: role filtering; active-match; collapse persist/auto-expand helpers
- Component: Sidebar expand/collapse, `aria-expanded`, mobile Escape, auto-expand on current route
- Smoke: AppShell bypass for auth/marketing routes
- Update KeyboardShortcuts tests for remapped sequences

**Manual**

- Admin, member, and platform-admin trees
- Desktop + mobile drawer
- RTL (`he` / `yi`) and light/dark
- Keyboard-only nav; SR spot-check on collapsible sections

## Rollout

1. Nav config + helpers
2. Sidebar / AppShell / MobileTopBar wiring
3. Remove redundant TabNavs + Settings side nav
4. Shortcuts + i18n/skip-link

Prefer a dedicated feature branch. No drive-by page content redesigns.

## Deliverables

1. Nav config module + helpers
2. Updated shell components (collapsible IA)
3. Slimmed/removed redundant section TabNavs / Settings side nav
4. Shortcuts + skip-link i18n/RTL fixes
5. Tests + short design-system note pointing at shell IA
6. This design spec

## Success criteria

- Secondary destinations reachable from the primary sidebar without TabNav hunting
- Members see useful destinations without privileged Settings
- Collapsible sections persist and auto-expand for the current route
- Keyboard, screen-reader, and RTL paths work on shell chrome
- Visual look stays familiar (IA change, not rebrand)

## Risks

- Settings nesting depth may crowd the sidebar — mitigate with collapse defaults and clear hierarchy
- Member expansion must track real RBAC or links will 403
- Removing TabNavs may break deep links/bookmarks that relied on in-page tabs — preserve hrefs

## Follow-on (separate specs)

1. Critical workflows one-by-one
2. Ongoing a11y as those surfaces are rebuilt
