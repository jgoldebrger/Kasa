# Final Fix Report — Design System Foundation, Whole-Branch Review Follow-up

## Must-fix items addressed (2026-08-04)

1. **DataView RTL leftovers** (`app/components/ui/DataView.tsx`)
   - Search icon `left-2.5` → `start-2.5`; input `pl-8 pr-2.5` → `ps-8 pe-2.5`.
   - Toolbar `ml-auto` → `ms-auto`.
   - Remaining physical `text-left` → `text-start` on mobile card buttons and both table/virtual-table `<thead>`s.
   - Commit: `2589af8`.

2. **Menu focus restore on activate** (`ActionMenu.tsx`, `ImportMenu.tsx`, `ExportMenu.tsx`)
   - Menu item activation (click/Enter) now calls the same `closeAndRestoreFocus()` used for Escape instead of a bare `setOpen(false)`, so keyboard/AT focus returns to the trigger button rather than falling to `<body>`.
   - Commit: `51503f1`.

3. **Token policy blind spot** (`lib/ui/kit-token-policy.test.ts`)
   - Added a second check (`RAW_BLACK_WHITE_UTILITY`) that flags `bg-white`, `text-white`, `bg-black`, `text-black` (with optional opacity suffix) in `app/components/ui/*.tsx`, with a per-file allowlist keyed by filename + a scoped regex.
   - `Modal.tsx`'s backdrop scrim (`bg-black/50 dark:bg-black/70`) is explicitly allowlisted with a comment explaining why it's intentional (themed scrim, not text/surface).
   - Fixed the live offenders the new check caught: `DataView.tsx`'s active pagination pill and `FilterPopover.tsx`'s filter-count badge now use `text-accent-fg` instead of `text-white`.
   - Commit: `3c9df45`.

4. **ImportModal ActionBadge contrast** (`app/components/ui/ImportModal.tsx`)
   - Per-row action badge (import/skip/error) in the dry-run preview now uses `bg-success-soft text-success` / `bg-warning-soft text-warning` / `bg-danger-soft text-danger` instead of `/10`-opacity washes, for AA-compliant contrast on small badge text.
   - Commit: `1afa737`.

5. **Tabs a11y test `dir` cleanup** (`app/components/ui/Tabs.a11y.test.tsx`)
   - `afterEach` now calls `document.documentElement.removeAttribute('dir')` instead of hardcoding `setAttribute('dir', 'ltr')`, matching the teardown pattern used by `DataView.a11y.test.tsx` and `ActionMenu.a11y.test.tsx`.
   - Commit: `a837ffd`.

## Test results

- `npx vitest run app/components/ui lib/ui` — **29 test files / 52 tests passed**, no failures.
- Focused a11y re-runs on touched components (`ActionMenu.a11y.test.tsx`, `Tabs.a11y.test.tsx`, `DataView.a11y.test.tsx`, `ExportMenu.a11y.test.tsx`, `ImportModal.a11y.test.tsx`, `Modal.a11y.test.tsx`) — all passed.
- No new dependencies were added.

## Known gaps / out of scope

- The human manual QA checklist (visual RTL sweep, screen-reader pass, etc.) was intentionally left untouched — those checkboxes still require a person.
- Minor findings 6–12 from the whole-branch review were not addressed, as none were one-line changes directly adjacent to the must-fix items above.
