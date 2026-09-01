# Final App Shell Review — Fix Report

## Status

Completed. All "Must fix" items and the "Minor if cheap" item are resolved.

## Commits

- `2e39267 fix(shell): trap focus in mobile nav drawer`
- `a3501d7 feat(nav): give Help its own top-level nav section`
- `85a987d feat(shortcuts): filter keyboard shortcuts by nav role`

## Changes

### 1. Mobile drawer focus trap (`app/components/AppShell.tsx`)

- On `menuOpen`, focus moves into the drawer (first focusable element, or
  the drawer itself as a fallback), mirroring `Modal`'s focus-trap pattern.
- Added a `Tab`/`Shift+Tab` keydown handler that cycles focus within the
  drawer's focusable elements (same query as `Modal`), including the
  Sidebar's close button.
- `Escape` still closes the drawer and restores focus to
  `#mobile-nav-trigger` — unchanged, kept explicit rather than switching
  to a generic "restore previously-focused element" approach, since the
  latter conflicted with the existing, already-tested Escape behavior in
  `happy-dom` (see Concerns).
- **Minor/cheap fix:** the drawer's `aria-label="Navigation menu"` now
  uses the existing `t('nav.primary')` i18n key (same key already used
  by `Sidebar`'s `<nav>` landmark) instead of a hardcoded English string.
  No new translation keys were needed since `nav.primary` already exists
  in both `en-US` and `he-IL`.

### 2. Help moved to its own top-level section (`lib/nav/config.ts`)

- Removed the `help` item from the `settings` section (admin-only) and
  added a new top-level `help` section (`id: 'help'`, `labelKey:
'nav.section.help'`) containing the `help` item, still restricted to
  `MEMBER_ROLES` so both members and admins see it.
- Added `nav.section.help` ("Help" / "עזרה") to `en-US.json` and
  `he-IL.json`.
- `lib/nav/config.test.ts`: added an assertion that the member-filtered
  section list contains a `help` section id and does **not** contain a
  `settings` section id (members have no admin-only settings items left
  to filter into a visible section).

### 3. Keyboard shortcuts filtered by role (`app/components/KeyboardShortcuts.tsx`, `lib/nav/shortcuts.ts`)

- `getNavShortcutHelpItems(sections?)` now accepts an optional nav-section
  tree (defaults to the full `PRIMARY_NAV_SECTIONS` for backward
  compatibility) instead of always reading the unfiltered config.
- `KeyboardShortcuts` calls `useOrgRole()` for `isAdmin`, builds a
  role-filtered tree via `filterNavSections(PRIMARY_NAV_SECTIONS, {
isAdmin, isPlatformAdmin: false })`, and derives `goRoutes` (the `g …`
  destination map) and the shortcut help list from that filtered tree via
  `useMemo`. Members no longer get `g p` / `g c` / `g s`, etc. `?`,
  `Ctrl+K`, and search remain registered for everyone (not nav-derived).
- Updated `lib/nav/shortcuts.test.ts` with cases for a member-filtered
  tree (only `g f` remains) and an admin-filtered tree (matches the full
  default list).
- Updated `app/components/KeyboardShortcuts.smoke.test.tsx`: added a
  `useOrgRole` mock (admin, matching prior implicit behavior) for the
  existing suite, and a new "member role" suite asserting `g c` does
  **not** navigate when `isAdmin` is false.

## Tests

- `npx vitest run lib/nav app/components/Sidebar.a11y.test.tsx app/components/AppShell.smoke.test.tsx app/components/KeyboardShortcuts.smoke.test.tsx` — **8 files, 25 tests passed.**
- `npx vitest run --config vitest.app.config.ts` (full app suite, regression check) — **39 files, 78 tests passed.**
- `npx vitest run lib/i18n/messages/validate.test.ts` — **1 file, 2 tests passed** (en-US/he-IL key parity holds after the `nav.section.help` addition).

## Concerns

- While implementing the focus trap, an initial version also restored
  focus to the previously-focused element on every drawer close (mirroring
  `Modal` exactly, via a `previouslyFocused` ref). This broke the existing
  `AppShell.smoke.test.tsx` Escape test in `happy-dom`, because a plain
  `fireEvent.click` there doesn't focus the clicked button, so the ref
  captured `document.body` and its `.focus()` call clobbered the explicit
  `#mobile-nav-trigger` focus set by the Escape handler. Kept the existing
  explicit Escape-based restore instead; this satisfies the requirement
  ("Escape already closes + restores focus") without the regression.
- `KeyboardShortcuts.smoke.test.tsx` previously had no `cleanup()` between
  tests, so multiple mounted instances' `window` keydown listeners could
  fire together. This was harmless for the original assertions (which
  only checked "was called with X"), but the new member-role test needed
  a strict "was not called" assertion, so a top-level `afterEach(cleanup)`
  was added to unmount between tests.
