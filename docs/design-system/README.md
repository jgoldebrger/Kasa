# Kasa Design System

In-repo notes for the `app/components/ui/*` kit. Full spec: [Design System Foundation](../superpowers/specs/2026-08-04-design-system-foundation-design.md).

## Token policy

- Kit components use **semantic tokens only** (`fg`, `surface`, `accent`, `success`, `warning`, `danger`, spacing, radius, shadow).
- Raw Tailwind palette colors (`green-600`, `amber-50`, …) are forbidden inside the kit; promote needed colors to named semantic tokens.
- Light and dark contrast are both in scope.
- Status tokens include soft surfaces: `success-soft`, `warning-soft`, `danger-soft`, and `danger-fg` for destructive button text.

## Component contracts

### Forms (Input, Select, Textarea)

- Visible label always, or intentional `aria-label` when redundant.
- `id` + `htmlFor`; `aria-describedby` for help and errors.
- `aria-invalid` when invalid; do not rely on color alone.
- Distinguish disabled vs read-only in UI and semantics.

### Actions (Button, ButtonLink, ActionMenu)

- Icon-only controls require accessible names.
- Loading / busy states expose appropriate busy/disabled semantics.
- Destructive actions use clear labeling.

### Overlays (Modal, Tooltip, ActionMenu)

- **Modal:** focus trap, initial focus, restore focus on close, `Escape` closes.
- **Tooltip:** not the only channel for essential information.
- **Menus:** arrow-key navigation and `Escape`.

### Navigation (Tabs, TabNav)

- Correct roles, `aria-selected`, and keyboard model.

### Feedback (Alert, EmptyState, Badge)

- Dynamic status alerts use appropriate roles / `aria-live`.
- Badges are not the sole carrier of critical status for screen-reader users.

### DataView ecosystem

- Sortable headers announce sort state.
- Filters / toolbar: labels, clear-filter affordances, live-region announcements where practical.
- Row actions reachable by keyboard.
- Empty / loading / error states use EmptyState / Skeleton patterns.
- Dense numeric columns use tabular numerals.

## RTL rules

- Prefer `ms` / `me` / `ps` / `pe` / `start` / `end` over physical `left` / `right`.
- Directional Heroicons flip or swap under `dir="rtl"`.
- No separate RTL fork of components.

## Dark mode

- `class`-based dark mode via `ThemeToggle` and layout bootstrap (`.dark` on root).
- Semantic `--c-*` tokens define light (`:root`) and dark (`.dark`) RGB triplets.
- Soft status surfaces use quieter dark-mode values for subtle backgrounds.

## Manual QA checklist

Per component or PR touching the kit:

- [ ] Keyboard-only path through primary interactions
  - Use `Tab`/`Shift+Tab`, arrow keys, `Enter`, `Space`, and `Escape`; verify visible focus, modal focus trapping/restoration, DataView sorting, and row actions.
- [ ] VoiceOver or NVDA spot-check on forms and DataView
  - With VoiceOver + Safari or NVDA + Firefox/Chrome, verify form labels, help/error associations, invalid state, DataView result counts, and sort state announcements.
- [ ] LTR and the `he` RTL locale
  - Set the app locale to `he` (or temporarily set the page root to `dir="rtl"`); verify Tabs arrow direction, icon padding, pagination chevrons, and end-aligned menus.
- [ ] Light and dark theme — contrast and readability
  - Scan Button, Input, Alert, and DataView states in both themes, including hover, focus, disabled, and soft status surfaces.
- [ ] `prefers-reduced-motion: reduce` — non-essential animations disabled
  - Enable reduced motion in the operating system, reload, and confirm that essential state changes remain understandable without non-essential animation.

Record the tester, date, browser/screen-reader combination, locale, and any follow-up issue in the PR before checking off each item.
