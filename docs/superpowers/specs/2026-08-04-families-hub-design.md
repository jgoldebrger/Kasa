# Families Hub — Design Spec

**Date:** 2026-08-04  
**Status:** Approved for planning  
**Scope:** Third sub-project of the UI / UX / accessibility redesign (after design-system foundation and app shell & navigation)

## Context

Kasa’s Families area is the daily treasurer path: list → family detail → tabbed subviews → create/edit modals. Today that surface is heavy (`FamiliesView`, `FamilyModals`, large detail context) with a flat horizontal `TabNav`, duplicated tab chrome, and uneven kit/a11y/RTL application. The design-system foundation and app shell are in place; this pass redesigns the **Families critical workflow** end-to-end.

## Goals

- **Full hub redesign:** list, detail shell, all tab bodies, and family modals
- **Operational clarity + kit/a11y consistency** — denser/clearer ops flows and WCAG 2.2 AA / RTL alignment with `ui/*`
- Keep **horizontal tabs**, but **regroup and relabel** into Profile / Money / Activity clusters
- **Careful member expansion** — surface existing member-safe actions (e.g. make-payment when financially linked); no new permissions
- **Decompose** the mega `FamilyModals` into domain modal modules; remain **modal-first**
- **One design, phased ship** — single spec; ordered mergeable implementation slices

## Non-goals

- Global app shell / primary nav changes
- Org-wide Payments, Statements, Collections, or Communications redesign (family-scoped tabs only; deep links to global routes stay as-is)
- New APIs or RBAC widening
- Route-based editors / abandoning modals for a different navigation model
- Visual rebrand or new UI library
- Marketing / auth public pages

## Decisions

| Topic           | Choice                                                      |
| --------------- | ----------------------------------------------------------- |
| Workflow        | Families (list → detail hub)                                |
| Breadth         | Full hub (list + shell + all tabs + modals)                 |
| Delivery        | One design; phased ship under one plan                      |
| UX goal         | Operational clarity **and** kit / a11y consistency          |
| Detail IA       | Horizontal TabNav; regroup/relabel (not local side nav)     |
| Member vs admin | Keep gating; carefully promote existing member-safe actions |
| Create / edit   | Modal-first; decompose mega modals into domain modules      |
| Approach        | Contract-first hub + phased surface rewrite                 |

## Architecture

### Shared Families contracts

Introduce shared contracts under `app/families/_lib/` (colocate with the route tree; extract to `lib/` only if a non-families consumer appears):

- **Tab registry:** `id`, path segment / href helper, i18n keys, `adminOnly` / `memberReadable`, **group** (`profile` | `money` | `activity`)
- **`FamilyPageHeader` / toolbar pattern:** title, primary action, secondary actions — used by list and every tab
- **Money-table helpers** on DataView (amount/status presentation, SR-friendly cells; status not color-only)
- **Modal controller pattern:** shared open/close + focus/error announcement; **domain modules** own form bodies

### Detail tab IA

Horizontal `TabNav` retained. Visual **group separators / muted group labels** (clusters), not a second nav level.

| Group    | Tabs (order)                                        | Visibility                                                     |
| -------- | --------------------------------------------------- | -------------------------------------------------------------- |
| Profile  | Info · Members · Sub-Families                       | Role-filtered as today (generally all roles)                   |
| Money    | Payments · Withdrawals · Cycle Charges · Statements | Admin for ledger tabs; Statements `memberReadable` when linked |
| Activity | Events · Tasks · Emails                             | Admin-only (existing gating)                                   |

**URL stability:** path segments stay unchanged (`/families/[id]`, `.../members`, `.../payments`, etc.). Only labels, order, and grouping change.

### List

Entry hub remains `/families`: DataView + search/filters; admin create/bulk; member-safe columns; row activation opens detail.

### Data flow

Existing family detail provider/context retained. Clearer UI boundaries: shell vs tab vs modal. No API contract change required for this redesign.

### Modal decomposition

Replace the single mega `FamilyModals` surface with domain modules (illustrative): family edit, members, payments, withdrawals, events, cycle-charges, and other existing modal flows — still opened as kit Modals from list/header/tabs.

## Behavior

### List

- Keyboard-complete DataView where the kit supports it; clear empty / loading / error
- Admin create + bulk actions remain obvious; destructive confirms use kit Modal patterns
- Members: strip privileged columns (e.g. open balances); clear path into linked family

### Detail shell

- Header: identity, key status when permitted, admin primary actions with accessible names
- TabNav: clustered groups; focus order; `aria-current="page"`; usable overflow on small screens (no clipped unreachable tabs)
- Non-admins hitting admin tab URLs: keep redirect-to-Info; improve `MemberHiddenTabsNotice` clarity

### Member expansion

- When `memberFinancialAccess`: Statements tab plus existing make-payment / financial panel promoted as obvious primary actions on Info (and Statements)
- Copy distinguishes read-only vs actionable states
- Do not invent new capabilities

### Tab bodies

- Shared toolbar: title + one primary Add/action when applicable
- Money tabs: DataView money a11y contracts
- Custom tabs (Info, Emails, Tasks, Statements): same spacing, headings, form contracts as kit
- RTL: logical CSS; Hebrew field `dir` where already required; layout flips correctly

### Modals

- Kit Modal contracts: focus trap, restore, Escape, labelled dialogs
- Domain modules share error announcement (`aria-invalid` / `aria-describedby`)
- No silent failures

## Phased delivery

Implementation plan will sequence mergeable slices:

1. Contracts + tab registry / IA
2. List
3. Detail shell (header + TabNav + notices)
4. Profile tabs (Info, Members, Sub-Families)
5. Money tabs (Payments, Withdrawals, Cycle Charges, Statements)
6. Activity tabs (Events, Tasks, Emails)
7. Modal domain decomposition (may overlap after shell if dependencies allow; finish against contracts)
8. Docs + test polish

Each phase must leave the hub usable.

## Testing

**Automated (per phase):** Vitest for tab registry (groups, hrefs, role filtering); list/shell smokes; practical modal open/focus where valuable. Extend existing Families tests.

**Manual QA:** keyboard TabNav overflow; screen reader on one money table + one form modal; RTL (`he-IL`); member vs admin gating; linked-member Statements / make-payment path.

## Risks & mitigations

| Risk                        | Mitigation                                              |
| --------------------------- | ------------------------------------------------------- |
| Scope across ~10 surfaces   | Hard phase gates; no mid-pass product features          |
| Mega-file regressions       | Contracts first; shared toolbar; domain modal split     |
| Bookmark / deep-link breaks | Stable URL segments                                     |
| Permission mistakes         | UI mirrors existing RBAC / `memberFinancialAccess` only |
| Inconsistent mid-hub state  | Land contracts + shell early                            |

## Deliverables

1. Families UI contracts + regrouped tab registry
2. Redesigned list on contracts
3. Redesigned detail shell (header, clustered TabNav, member notices/actions)
4. Redesigned bodies for all ten tabs
5. Domain-split family modal modules
6. Vitest + manual QA notes
7. Short hub pattern note in `docs/design-system/`
8. This spec under `docs/superpowers/specs/`

## Handoff

After this hub ships, subsequent critical workflows (org-wide Payments, Statements, etc.) each get their own brainstorm → spec → plan. Accessibility continues as part of those rebuilds, not a separate endless project.
