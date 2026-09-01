# Design System Foundation — Design Spec

**Date:** 2026-08-04  
**Status:** Approved for planning  
**Scope:** First sub-project of the broader UI / UX / accessibility redesign

## Context

Kasa is a multi-tenant family financial SaaS (Next.js App Router, TypeScript, Tailwind, existing custom `app/components/ui/*`). The long-term goal is a full UI, UX, and accessibility redesign. That work is too large for one spec and is sequenced as:

1. **Design system foundation** (this spec) — tokens, component contracts, a11y baselines, RTL
2. App shell & navigation
3. Critical workflows one-by-one
4. Ongoing a11y as surfaces are rebuilt

This foundation hardens the existing kit. It does not rebrand the product or redesign pages.

## Goals

- Systematize design tokens and component behavior on top of the current look
- Meet **WCAG 2.2 AA**, with stronger screen-reader support for dense money tables and forms
- Bake in **RTL** (`dir`-aware components, logical CSS, mirrored directional icons)
- Evolve **every** component under `app/components/ui/` to the new standard

## Non-goals

- Visual rebrand or new brand identity
- New UI libraries (Radix, shadcn, MUI, etc.)
- App shell / navigation redesign
- Page-level workflow redesigns (dues, statements, etc.)
- Dedicated marketing/public-page redesign (pages that already use `ui/*` get free upgrades only)
- Building a Storybook product (unless one already exists to hang notes on)
- Blocking CI gate with axe unless already wired (optional stretch only)

## Decisions

| Topic              | Choice                                                      |
| ------------------ | ----------------------------------------------------------- |
| Feel / brand       | Refresh, not rebrand — keep look familiar                   |
| A11y bar           | WCAG 2.2 AA + extra SR support for dense money tables/forms |
| Component strategy | Evolve `app/components/ui/*` in place                       |
| Foundation “done”  | Full `ui/*` pass                                            |
| RTL                | First-class — logical properties, `dir`-aware components    |
| Delivery approach  | Contract-first, primitives → composites → DataView last     |

## Architecture

Three layers inside the current stack:

### 1. Tokens

Keep existing CSS custom properties (`--c-*`, spacing, radius, shadow) and Tailwind semantic mappings (`fg`, `surface`, `accent`, `danger`, `success`, `warning`, etc.), including existing `class`-based dark mode (`ThemeToggle` + layout bootstrap).

**Token policy:**

- Kit components use semantic tokens only
- Raw Tailwind palette colors (`green-600`, `amber-50`, …) inside the kit are allowed only when they map to named status semantics (`success` / `warning` / `danger`) or are promoted into tokens during this pass
- Light and dark contrast are both in scope for the kit

### 2. Contracts

A shared standard (short in-repo notes + optional thin helpers) covering:

- Labeling and control association
- Errors / help text
- Focus visibility
- Keyboard behavior
- Live-region patterns where dynamic feedback matters
- `prefers-reduced-motion` for non-essential animation
- RTL via logical properties and `dir`-aware icons

Pages consume components; they do not reinvent these behaviors.

### 3. Components

Evolve every component under `app/components/ui/` (including those not re-exported from `index.ts`) in dependency order:

1. **Primitives:** Button, ButtonLink, Input, Select, Textarea, Badge, Skeleton, Card, EmptyState, PageHeader, Alert
2. **Overlays / chrome:** Modal, Tooltip, ActionMenu, Tabs, TabNav, ImportMenu, ExportMenu, ImportModal
3. **Capstone (DataView ecosystem):** DataView, FilterPopover, FilterChips, ColumnPicker (plus related filter types already exported from the kit)

**RTL rules:** Prefer `ms` / `me` / `ps` / `pe` / `start` / `end` over left/right. Directional Heroicons flip or swap under `dir="rtl"`. No separate RTL fork of components.

## Component contracts

### Forms (Input, Select, Textarea, and wrapping composites)

- Visible label always, or `aria-label` only when a visible label would be redundant and that exception is intentional
- `id` + `htmlFor` association; `aria-describedby` for help and error text
- Errors associated in the accessibility tree; `aria-invalid` when invalid; do not rely on color alone
- Disabled vs read-only distinguished in UI and semantics

### Actions (Button, ButtonLink, ActionMenu items)

- Icon-only controls require accessible names
- Loading / busy states expose appropriate busy/disabled semantics
- Destructive actions use clear labeling (confirmations stay within existing product patterns)

### Overlays (Modal, Tooltip, ActionMenu)

- **Modal:** focus trap, initial focus, restore focus on close, `Escape` closes, backdrop-click policy explicit and consistent
- **Tooltip:** not the only channel for essential information; keyboard users can reach the same meaning
- **Menus:** arrow-key navigation and `Escape`; typeahead is out of v1 unless already present

### Navigation chrome (Tabs, TabNav)

- Correct roles / `aria-selected` / keyboard model (arrows or documented tab order)

### Feedback (Alert, EmptyState, Badge)

- Status alerts use appropriate roles / `aria-live` when content is dynamic
- Badges are not the sole carrier of critical status for screen-reader users when paired with money or state

### DataView ecosystem (AA+)

Applies to DataView and its kit companions (FilterPopover, FilterChips, ColumnPicker):

- Sortable headers announce sort state
- Filters / toolbar / column picker: labels, clear-filter affordances, practical result-count or change announcements via live region
- Row actions reachable by keyboard
- Empty / loading / error states use EmptyState / Skeleton patterns
- Dense numeric columns use tabular numerals; header/cell clarity for screen readers (`scope` / headers as needed)

## Validation

Fit existing tooling (Vitest, Testing Library, Playwright, existing `ui/*` smoke tests):

- Extend smokes for labels/associations, Modal/ActionMenu keyboard open/close, basic ARIA on Tabs and DataView sort headers; add smokes where missing
- Manual checklist per component: keyboard-only path, VoiceOver or NVDA spot-check on forms + DataView, LTR and one RTL locale (`he` or `yi`), light + dark contrast
- Optional stretch (not required for “done”): `@axe-core` in smokes / CI later

## Rollout

- One coherent standard; avoid a long-lived half-migrated kit
- Prefer small PRs by layer (primitives → overlays → DataView), each leaving the kit compilable and tests green
- Change call sites only when a component API must tighten for a11y (e.g. requiring `label`); no drive-by page redesigns
- DataView lands last with extra smoke coverage and a manual screen-reader pass
- Token cleanup may touch status colors inside the kit; keep visual diffs intentional and small

## Deliverables

1. Updated `app/components/ui/*` meeting the contracts (full kit pass)
2. Short in-repo design-system notes: token policy, component contract checklist, RTL/dark notes
3. Expanded / updated Vitest smokes for the kit
4. This design spec

## Success criteria

- Every `ui/*` export meets the contracts
- Semantic tokens used consistently inside the kit (no ad-hoc palette drift)
- Keyboard and screen-reader paths work for forms and DataView
- LTR and RTL (`dir`) behave correctly
- Light and dark themes remain usable with required contrast
- Visual look stays familiar (refresh, not rebrand)

## Risks

- DataView is the largest regression surface
- Tightening form APIs may require limited call-site updates
- Status-color token promotion can create noisy diffs if not scoped to the kit

## Follow-on roadmap (separate specs)

1. App shell & navigation
2. Critical workflows one-by-one
3. Ongoing a11y on rebuilt surfaces
