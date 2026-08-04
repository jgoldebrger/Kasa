# Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Kasa’s existing `app/components/ui/*` kit to a contract-first design-system foundation (semantic tokens, WCAG 2.2 AA + denser SR support, RTL) without a visual rebrand.

**Architecture:** Keep CSS custom properties + Tailwind semantic colors; add soft status tokens and written contracts; introduce small shared RTL/a11y helpers; upgrade components in dependency order (primitives → overlays → DataView ecosystem). No new UI libraries.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Tailwind CSS (`darkMode: 'class'`), Vitest + Testing Library + happy-dom, existing Heroicons, existing `cn` helper (`lib/cn.ts`).

**Spec:** `docs/superpowers/specs/2026-08-04-design-system-foundation-design.md`

## Global Constraints

- Refresh, not rebrand — keep the familiar teal/surface look; systematize, don’t invent a new palette.
- WCAG 2.2 AA + stronger screen-reader support for dense money tables/forms.
- Evolve `app/components/ui/*` in place — no Radix/shadcn/MUI.
- Full `ui/*` pass is “done,” including files not re-exported from `index.ts`.
- RTL is first-class: logical CSS (`ms`/`me`/`ps`/`pe`/`start`/`end`), `dir`-aware keyboard and icons.
- Kit components use semantic tokens only; promote raw `green-*` / `amber-*` kit usage into tokens.
- Call-site churn only when an API must tighten for a11y; no page redesigns.
- Prefer small commits per task; keep tests green after each task.
- Optional `@axe-core` CI is out of scope (stretch later).

---

## File map

| Path                                                         | Responsibility                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `docs/design-system/README.md`                               | Token policy + component contract checklist + RTL/dark notes                                    |
| `app/globals.css`                                            | Soft status tokens; `prefers-reduced-motion` for `animate-ui-*`                                 |
| `tailwind.config.js`                                         | Map soft status / danger-fg tokens if added                                                     |
| `lib/ui/writing-direction.ts`                                | `getWritingDirection(el?)`, `horizontalNavDelta(key, dir)`                                      |
| `lib/ui/field-ids.ts`                                        | Shared `useFieldIds(id?)` → `{ fieldId, hintId, errorId, describedBy }`                         |
| `lib/ui/align.ts`                                            | `textAlignClass(align: 'start' \| 'end' \| 'center' \| 'left' \| 'right')` with logical mapping |
| `app/components/ui/*.tsx`                                    | Contract + RTL + token upgrades per task                                                        |
| `app/components/ui/*.smoke.test.tsx` / new `*.a11y.test.tsx` | Behavioral a11y tests (keep auto smokes; add focused tests alongside)                           |

---

### Task 1: Design notes + soft status tokens + reduced motion

**Files:**

- Create: `docs/design-system/README.md`
- Modify: `app/globals.css`
- Modify: `tailwind.config.js`
- Test: `lib/ui/tokens.smoke.test.ts` (new — asserts CSS vars exist via a documented allowlist file, or skip runtime CSS and assert Tailwind config keys)

**Interfaces:**

- Consumes: existing `--c-success` / `--c-warning` / `--c-danger`
- Produces: CSS vars `--c-success-soft`, `--c-warning-soft`, `--c-danger-soft`, `--c-danger-fg`; Tailwind colors `success-soft`, `warning-soft`, `danger-soft`, `danger-fg`

- [ ] **Step 1: Write the failing Tailwind-config assertion**

Create `lib/ui/tokens.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import tailwindConfig from '../../tailwind.config.js'

describe('design tokens', () => {
  it('exposes soft status colors on the Tailwind theme', () => {
    const colors = (tailwindConfig as { theme: { extend: { colors: Record<string, unknown> } } })
      .theme.extend.colors
    expect(colors).toHaveProperty('success-soft')
    expect(colors).toHaveProperty('warning-soft')
    expect(colors).toHaveProperty('danger-soft')
    expect(colors).toHaveProperty('danger-fg')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ui/tokens.smoke.test.ts`

Expected: FAIL — properties missing from `tailwind.config.js`.

- [ ] **Step 3: Add CSS vars + Tailwind mappings + design notes**

In `:root` of `app/globals.css` (after existing status tokens):

```css
--c-success-soft: 220 252 231; /* green-100-ish */
--c-warning-soft: 255 251 235; /* amber-50-ish */
--c-danger-soft: 254 242 242; /* red-50-ish */
--c-danger-fg: 255 255 255;
```

In `.dark` (plain RGB triplets, quiet soft surfaces):

```css
--c-success-soft: 6 46 26;
--c-warning-soft: 69 26 3;
--c-danger-soft: 69 10 10;
--c-danger-fg: 255 255 255;
```

Add at end of `app/globals.css` (class names already defined in this file):

```css
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  .animate-ui-fade,
  .animate-ui-scale,
  .animate-ui-slide {
    animation: none !important;
  }
}
```

In `tailwind.config.js` `theme.extend.colors`:

```js
        success: {
          DEFAULT: 'rgb(var(--c-success) / <alpha-value>)',
          soft: 'rgb(var(--c-success-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--c-warning) / <alpha-value>)',
          soft: 'rgb(var(--c-warning-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
          soft: 'rgb(var(--c-danger-soft) / <alpha-value>)',
          fg: 'rgb(var(--c-danger-fg) / <alpha-value>)',
        },
```

**Important:** Today `success`, `warning`, and `danger` are string colors. Changing them to objects with `DEFAULT` keeps `bg-success` / `text-danger` working. Update Button’s `text-white` on destructive to `text-danger-fg` in Task 3.

Create `docs/design-system/README.md` with sections: Token policy; Component contracts (copy from the approved spec, shortened); RTL rules; Dark mode; Manual QA checklist (keyboard, SR, `he`/`yi`, light/dark).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ui/tokens.smoke.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/design-system/README.md app/globals.css tailwind.config.js lib/ui/tokens.smoke.test.ts
git commit -m "docs(ui): add design-system notes and soft status tokens"
```

---

### Task 2: Shared writing-direction + field-id + align helpers

**Files:**

- Create: `lib/ui/writing-direction.ts`
- Create: `lib/ui/writing-direction.test.ts`
- Create: `lib/ui/field-ids.ts`
- Create: `lib/ui/field-ids.test.ts`
- Create: `lib/ui/align.ts`
- Create: `lib/ui/align.test.ts`

**Interfaces:**

- Consumes: DOM `dir` / `document.documentElement.dir`
- Produces:
  - `export type WritingDirection = 'ltr' | 'rtl'`
  - `export function getWritingDirection(node?: Element | null): WritingDirection`
  - `export function horizontalNavDelta(key: string, dir: WritingDirection): -1 | 0 | 1` — ArrowRight → +1 in LTR / −1 in RTL; ArrowLeft opposite; else 0
  - `export function useFieldIds(id?: string): { fieldId: string; hintId: string; errorId: string; describedBy: (hint?: string, error?: string | null) => string | undefined }`
  - `export type TextAlign = 'start' | 'end' | 'center' | 'left' | 'right'`
  - `export function textAlignClass(align?: TextAlign): string` — maps `start`→`text-start`, `end`→`text-end`, `left`→`text-start`, `right`→`text-end` (logical), `center`→`text-center`

- [ ] **Step 1: Write failing tests**

`lib/ui/writing-direction.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getWritingDirection, horizontalNavDelta } from './writing-direction'

describe('writing-direction', () => {
  it('defaults to ltr without a document dir', () => {
    expect(getWritingDirection(null)).toBe('ltr')
  })

  it('maps arrow keys for rtl', () => {
    expect(horizontalNavDelta('ArrowRight', 'rtl')).toBe(-1)
    expect(horizontalNavDelta('ArrowLeft', 'rtl')).toBe(1)
    expect(horizontalNavDelta('ArrowRight', 'ltr')).toBe(1)
  })
})
```

`lib/ui/align.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { textAlignClass } from './align'

describe('textAlignClass', () => {
  it('maps physical left/right to logical classes', () => {
    expect(textAlignClass('left')).toBe('text-start')
    expect(textAlignClass('right')).toBe('text-end')
    expect(textAlignClass('start')).toBe('text-start')
  })
})
```

`lib/ui/field-ids.test.ts` — use `@vitest-environment happy-dom` and Testing Library render of a tiny hook wrapper, or test a pure `buildFieldIds(autoId, id?)` without hooks if simpler:

```ts
import { describe, it, expect } from 'vitest'
import { buildFieldIds } from './field-ids'

describe('buildFieldIds', () => {
  it('prefers explicit id and builds describedBy', () => {
    const ids = buildFieldIds('auto', 'email')
    expect(ids.fieldId).toBe('email')
    expect(ids.describedBy('hint text', 'boom')).toBe('email-hint email-err')
    expect(ids.describedBy(undefined, null)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ui/writing-direction.test.ts lib/ui/align.test.ts lib/ui/field-ids.test.ts`

Expected: FAIL — modules missing.

- [ ] **Step 3: Implement helpers**

`lib/ui/writing-direction.ts`:

```ts
export type WritingDirection = 'ltr' | 'rtl'

export function getWritingDirection(node?: Element | null): WritingDirection {
  if (typeof document === 'undefined') return 'ltr'
  const raw =
    (node && (node.closest('[dir]') as HTMLElement | null)?.dir) ||
    document.documentElement.getAttribute('dir') ||
    'ltr'
  return raw === 'rtl' ? 'rtl' : 'ltr'
}

export function horizontalNavDelta(key: string, dir: WritingDirection): -1 | 0 | 1 {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0
  const forward = key === 'ArrowRight' ? 1 : -1
  return (dir === 'rtl' ? -forward : forward) as -1 | 1
}
```

`lib/ui/align.ts`:

```ts
export type TextAlign = 'start' | 'end' | 'center' | 'left' | 'right'

export function textAlignClass(align?: TextAlign): string {
  if (align === 'center') return 'text-center'
  if (align === 'end' || align === 'right') return 'text-end'
  return 'text-start'
}
```

`lib/ui/field-ids.ts`:

```ts
export function buildFieldIds(autoId: string, id?: string) {
  const fieldId = id || autoId
  return {
    fieldId,
    hintId: `${fieldId}-hint`,
    errorId: `${fieldId}-err`,
    describedBy(hint?: string, error?: string | null) {
      const parts: string[] = []
      if (hint) parts.push(`${fieldId}-hint`)
      if (error) parts.push(`${fieldId}-err`)
      return parts.length ? parts.join(' ') : undefined
    },
  }
}

import { useId } from 'react'

/** React helper wrapping buildFieldIds + useId. */
export function useFieldIds(id?: string) {
  const autoId = useId()
  return buildFieldIds(autoId, id)
}
```

(Keep `useFieldIds` in the same file; put the `import { useId }` at the top.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ui/writing-direction.test.ts lib/ui/align.test.ts lib/ui/field-ids.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ui/
git commit -m "feat(ui): add RTL, align, and field-id helpers"
```

---

### Task 3: Form primitives — Input, Select, Textarea

**Files:**

- Modify: `app/components/ui/Input.tsx`
- Modify: `app/components/ui/Select.tsx`
- Modify: `app/components/ui/Textarea.tsx`
- Create: `app/components/ui/Input.a11y.test.tsx`
- Create: `app/components/ui/Select.a11y.test.tsx`
- Create: `app/components/ui/Textarea.a11y.test.tsx`
- Keep existing `*.smoke.test.tsx` green

**Interfaces:**

- Consumes: `useFieldIds` / `buildFieldIds` from `lib/ui/field-ids.ts`
- Produces: unchanged public props (`label?`, `hint?`, `error?`, `labelHidden?`) plus requirement that **at least one of** `label`, `aria-label`, or `aria-labelledby` is set (document in JSDoc; enforce in a11y tests; do not throw in production)

- [ ] **Step 1: Write failing a11y tests**

`app/components/ui/Input.a11y.test.tsx`:

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Input } from './Input'

describe('Input a11y', () => {
  it('associates label, hint, and error', () => {
    render(<Input label="Email" hint="Work email" error="Required" />)
    const field = screen.getByLabelText('Email')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field.getAttribute('aria-describedby') || '').toMatch(/hint/)
    expect(field.getAttribute('aria-describedby') || '').toMatch(/err/)
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })

  it('uses logical padding classes for icons', () => {
    const { container } = render(<Input label="Search" leftIcon={<span data-testid="icon" />} />)
    const input = container.querySelector('input')
    expect(input?.className).toMatch(/ps-10/)
    expect(container.innerHTML).toMatch(/start-3/)
  })
})
```

Mirror association tests for Select and Textarea (Select needs `<option>` children).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/ui/Input.a11y.test.tsx`

Expected: FAIL on `ps-10` / `start-3` (currently `pl-10` / `left-3`).

- [ ] **Step 3: Implement logical CSS + shared field ids**

In `Input.tsx`:

- Replace local id logic with `useFieldIds(id)`.
- Replace `ml-0.5` → `ms-0.5`, `left-3` → `start-3`, `right-3` → `end-3`, `pl-10` → `ps-10`, `pr-10` → `pe-10`.
- Ensure `readOnly` vs `disabled` remain distinct (native attributes already; add `aria-readonly` when `readOnly` is true if not redundant for the browser — prefer documenting native `readOnly`).
- Keep `role="alert"` on error text.

Apply the same logical + `useFieldIds` changes to `Select.tsx` and `Textarea.tsx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/components/ui/Input.a11y.test.tsx app/components/ui/Select.a11y.test.tsx app/components/ui/Textarea.a11y.test.tsx app/components/ui/Input.smoke.test.tsx app/components/ui/Select.smoke.test.tsx app/components/ui/Textarea.smoke.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/Input.tsx app/components/ui/Select.tsx app/components/ui/Textarea.tsx app/components/ui/*.a11y.test.tsx
git commit -m "fix(ui): harden Input/Select/Textarea for a11y and RTL"
```

---

### Task 4: Action primitives + feedback — Button, ButtonLink, Badge, Alert, Card, Skeleton, EmptyState, PageHeader

**Files:**

- Modify: `app/components/ui/Button.tsx` (logical icon margins; `text-danger-fg` on destructive; keep `aria-busy`)
- Modify: `app/components/ui/ButtonLink.tsx` (ensure `focus-ring`; logical spacing if any)
- Modify: `app/components/ui/Badge.tsx` (no change required if already tokenized — verify; add `aria-hidden` guidance in JSDoc only)
- Modify: `app/components/ui/Alert.tsx` (`role="status"` default; allow `role="alert"` via prop override already through HTML attrs — document; for `variant="danger"` set `role="alert"` by default)
- Modify: `app/components/ui/Card.tsx`, `Skeleton.tsx`, `EmptyState.tsx`, `PageHeader.tsx` — replace any physical L/R classes with logical; ensure EmptyState actions are keyboard reachable
- Create: `app/components/ui/Button.a11y.test.tsx`
- Create: `app/components/ui/Alert.a11y.test.tsx`

**Interfaces:**

- Consumes: soft/danger-fg tokens from Task 1
- Produces: Alert default role = `alert` when `variant === 'danger'`, else `status`

- [ ] **Step 1: Write failing tests**

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './Button'
import { Alert } from './Alert'

describe('Button a11y', () => {
  it('sets aria-busy when loading', () => {
    render(<Button loading>Save</Button>)
    expect(screen.getByRole('button', { name: /save/i })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button')).toBeDisabled()
  })
})

describe('Alert a11y', () => {
  it('uses alert role for danger', () => {
    render(<Alert variant="danger" title="Failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
  })
})
```

- [ ] **Step 2: Run tests — expect Alert danger role failure if still `status`**

Run: `npx vitest run app/components/ui/Button.a11y.test.tsx app/components/ui/Alert.a11y.test.tsx`

- [ ] **Step 3: Implement**

Button destructive variant classes: replace `text-white` with `text-danger-fg`; `-ml-0.5`/`-mr-0.5` → `-ms-0.5`/`-me-0.5`.

Alert:

```tsx
  const role = rest.role ?? (variant === 'danger' ? 'alert' : 'status')
  return (
    <div role={role} className={cn(...)} {...rest}>
```

Strip `role` from `...rest` before spread to avoid override fights:

```tsx
export function Alert({ variant = 'info', title, className, children, role, ...rest }: AlertProps) {
  const resolvedRole = role ?? (variant === 'danger' ? 'alert' : 'status')
  ...
}
```

Sweep Card/Skeleton/EmptyState/PageHeader for `ml-`/`mr-`/`left-`/`right-`/`text-left` → logical equivalents.

- [ ] **Step 4: Run related smokes + a11y tests**

Run: `npx vitest run app/components/ui/Button.a11y.test.tsx app/components/ui/Alert.a11y.test.tsx app/components/ui/Button.smoke.test.tsx app/components/ui/EmptyState.smoke.test.tsx app/components/ui/Skeleton.smoke.test.tsx app/components/ui/PageHeader.smoke.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/Button.tsx app/components/ui/ButtonLink.tsx app/components/ui/Badge.tsx app/components/ui/Alert.tsx app/components/ui/Card.tsx app/components/ui/Skeleton.tsx app/components/ui/EmptyState.tsx app/components/ui/PageHeader.tsx app/components/ui/Button.a11y.test.tsx app/components/ui/Alert.a11y.test.tsx
git commit -m "fix(ui): harden action and feedback primitives"
```

---

### Task 5: Overlays — Modal + Tooltip

**Files:**

- Modify: `app/components/ui/Modal.tsx`
- Modify: `app/components/ui/Tooltip.tsx`
- Create: `app/components/ui/Modal.a11y.test.tsx`
- Modify: `app/components/ui/Modal.smoke.test.tsx` only if needed
- Create: `app/components/ui/Tooltip.a11y.test.tsx`

**Interfaces:**

- Consumes: existing Modal focus trap
- Produces: documented backdrop policy (`dismissible` default true); close button `aria-label` (ensure present); Tooltip never sole essential info (JSDoc); Tooltip positioning uses logical-friendly classes where possible

- [ ] **Step 1: Write failing Modal keyboard test**

Do not add `@testing-library/user-event` (not in the repo). Use `fireEvent`:

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

describe('Modal a11y', () => {
  it('closes on Escape when dismissible', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Edit family">
        <button type="button">Inside</button>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('exposes dialog name from title', () => {
    render(
      <Modal open onClose={() => {}} title="Edit family">
        body
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Edit family' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run app/components/ui/Modal.a11y.test.tsx`

Expected: PASS if Escape already works; if close button lacks accessible name, add a test that fails and fix.

- [ ] **Step 3: Harden Modal + Tooltip**

Modal close control: ensure `aria-label="Close"` (or i18n key if the kit already uses `t()` — Modal currently has no i18n; use English `Close` consistent with existing kit strings, or wire `t` only if neighboring chrome already does).

Replace `-mr-1 -mt-1` with `-me-1 -mt-1`.

Tooltip: read file; ensure trigger remains tabbable; add JSDoc that tooltip content must duplicate essential visible text; prefer not trapping focus.

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/components/ui/Modal.a11y.test.tsx app/components/ui/Modal.smoke.test.tsx app/components/ui/Tooltip.smoke.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/Modal.tsx app/components/ui/Tooltip.tsx app/components/ui/Modal.a11y.test.tsx app/components/ui/Tooltip.a11y.test.tsx
git commit -m "fix(ui): harden Modal and Tooltip accessibility"
```

---

### Task 6: Menus — ActionMenu, ImportMenu, ExportMenu

**Files:**

- Modify: `app/components/ui/ActionMenu.tsx`
- Modify: `app/components/ui/ImportMenu.tsx`
- Modify: `app/components/ui/ExportMenu.tsx`
- Create: `app/components/ui/ActionMenu.a11y.test.tsx`

**Interfaces:**

- Consumes: `getWritingDirection`, `horizontalNavDelta`
- Produces: ActionMenu `align?: 'start' | 'end' | 'left' | 'right'` (map left→start, right→end); arrow-key movement between `role="menuitem"`; Escape closes and returns focus to trigger; popover edge classes use `end-0` instead of `right-0`

- [ ] **Step 1: Write failing ActionMenu keyboard test**

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ActionMenu from './ActionMenu'

describe('ActionMenu a11y', () => {
  it('opens, moves with arrows, and closes on Escape', () => {
    const onEdit = vi.fn()
    render(
      <ActionMenu
        items={[
          { label: 'Edit', onClick: onEdit },
          { label: 'Delete', onClick: () => {}, destructive: true },
        ]}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.click(trigger)
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    items[0].focus()
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
```

- [ ] **Step 2: Run — expect FAIL (no ArrowDown handling today)**

Run: `npx vitest run app/components/ui/ActionMenu.a11y.test.tsx`

- [ ] **Step 3: Implement menu keyboard + RTL class fixes**

In ActionMenu:

- On open, focus first enabled menuitem.
- On `ArrowDown` / `ArrowUp`, move focus among menuitems (wrap).
- On `Home` / `End`, jump.
- On `Escape`, close and `triggerRef.current?.focus()`.
- Map `align` physical values to start/end for positioning math (`end` uses `rect.right - MENU_WIDTH` in LTR; in RTL invert using `getWritingDirection`).

ImportMenu / ExportMenu: change `right-0` → `end-0`, `text-left` → `text-start`; ensure triggers have accessible names; Escape closes if not already.

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/components/ui/ActionMenu.a11y.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/ActionMenu.tsx app/components/ui/ImportMenu.tsx app/components/ui/ExportMenu.tsx app/components/ui/ActionMenu.a11y.test.tsx
git commit -m "fix(ui): add keyboard navigation to kit menus"
```

---

### Task 7: Tabs + TabNav (RTL-aware arrows)

**Files:**

- Modify: `app/components/ui/Tabs.tsx`
- Modify: `app/components/ui/TabNav.tsx`
- Create: `app/components/ui/Tabs.a11y.test.tsx`

**Interfaces:**

- Consumes: `getWritingDirection`, `horizontalNavDelta`
- Produces: ArrowRight/ArrowLeft move in reading order relative to `dir`

- [ ] **Step 1: Write failing RTL arrow test**

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Tabs } from './Tabs'

describe('Tabs a11y', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('dir', 'rtl')
  })
  afterEach(() => {
    document.documentElement.setAttribute('dir', 'ltr')
  })

  it('moves selection with ArrowRight toward previous item in rtl', () => {
    const onChange = vi.fn()
    render(
      <Tabs
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ]}
        activeId="b"
        onChange={onChange}
      />,
    )
    const tabB = screen.getByRole('tab', { name: 'B' })
    tabB.focus()
    fireEvent.keyDown(tabB, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **Step 2: Run — expect FAIL (ArrowRight currently always +1)**

Run: `npx vitest run app/components/ui/Tabs.a11y.test.tsx`

- [ ] **Step 3: Implement**

In `Tabs.onKeyDown`:

```ts
const dir = getWritingDirection(e.currentTarget)
const delta = horizontalNavDelta(e.key, dir)
if (delta !== 0) {
  e.preventDefault()
  focusByOffset(idx, delta)
  return
}
```

Apply the same pattern to `TabNav.tsx` if it implements arrow keys; if TabNav is link-based only, ensure `aria-current` and logical underline classes.

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/components/ui/Tabs.a11y.test.tsx app/components/ui/Tabs.smoke.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/Tabs.tsx app/components/ui/TabNav.tsx app/components/ui/Tabs.a11y.test.tsx
git commit -m "fix(ui): make Tabs arrow keys dir-aware"
```

---

### Task 8: DataView companions — FilterPopover, FilterChips, ColumnPicker

**Files:**

- Modify: `app/components/ui/FilterPopover.tsx`
- Modify: `app/components/ui/FilterChips.tsx`
- Modify: `app/components/ui/ColumnPicker.tsx`
- Create: `app/components/ui/FilterChips.a11y.test.tsx`

**Interfaces:**

- Consumes: logical CSS conventions from earlier tasks
- Produces: labeled triggers; clear-filter controls with accessible names; `border-l` → `border-s`; `right-0` → `end-0`; `-mr-*` → `-me-*`

- [ ] **Step 1: Write FilterChips logical-CSS + clear-name regression test**

`FilterChips` already uses `aria-label={`Clear ${f.label} filter`}`. Lock that in and fail on physical margins:

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import FilterChips from './FilterChips'

describe('FilterChips a11y', () => {
  it('names clear controls and uses logical auto margin', () => {
    const { container } = render(
      <FilterChips
        filters={[
          {
            id: 'status',
            label: 'Status',
            display: 'Active',
            clear: vi.fn(),
          },
        ]}
        onClearAll={vi.fn()}
        summary="1 result"
      />,
    )
    expect(screen.getByRole('button', { name: 'Clear Status filter' })).toBeTruthy()
    expect(container.innerHTML).toMatch(/ms-auto/)
    expect(container.innerHTML).not.toMatch(/\bml-auto\b/)
  })
})
```

Confirm `ActiveFilter` fields (`id`, `label`, `display`, `clear`) in `@/lib/client/useDataFilters` if the test type-errors — match the real type exactly.

- [ ] **Step 2: Run — expect FAIL on `ms-auto` (file still has `ml-auto` / `-mr-0.5`)**

Run: `npx vitest run app/components/ui/FilterChips.a11y.test.tsx`

- [ ] **Step 3: Implement logical CSS + named popover panels**

In FilterChips: `ml-auto` → `ms-auto`, `-mr-0.5` → `-me-0.5`.

In FilterPopover / ColumnPicker: `right-0` → `end-0`, `border-l` → `border-s`, `text-left` → `text-start`; ensure the popover panel has an accessible name (`aria-label="Filters"` / `aria-label="Columns"`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/components/ui/FilterChips.a11y.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/FilterPopover.tsx app/components/ui/FilterChips.tsx app/components/ui/ColumnPicker.tsx app/components/ui/FilterChips.a11y.test.tsx
git commit -m "fix(ui): harden DataView filter and column chrome"
```

---

### Task 9: ImportModal — token cleanup + form a11y

**Files:**

- Modify: `app/components/ui/ImportModal.tsx`
- Create: `app/components/ui/ImportModal.a11y.test.tsx` (smoke open state with mocked props — keep light)

**Interfaces:**

- Consumes: `bg-success-soft`, `text-success`, `bg-warning-soft`, `text-warning`, `border-warning/40`, etc.
- Produces: no raw `green-*` / `amber-*` classes inside this file

- [ ] **Step 1: Write a grep-backed regression test**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

describe('ImportModal tokens', () => {
  it('does not use raw green/amber palette classes', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/components/ui/ImportModal.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/\b(bg|text|border)-(green|amber)-/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run app/components/ui/ImportModal.a11y.test.tsx`

- [ ] **Step 3: Replace palette classes with semantic tokens**

Examples:

- `border-amber-300 bg-amber-50 ...` → `border-warning/40 bg-warning-soft text-warning`
- `border-green-300 bg-green-50 ...` → `border-success/40 bg-success-soft text-success`
- Badge-like chips → `Badge` variants or `bg-success/10 text-success`

Also replace `ml-*` / `text-left` with logical equivalents in this file.

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/ImportModal.tsx app/components/ui/ImportModal.a11y.test.tsx
git commit -m "refactor(ui): tokenize ImportModal status colors"
```

---

### Task 10: DataView AA+ capstone

**Files:**

- Modify: `app/components/ui/DataView.tsx`
- Modify: `app/components/ui/DataView.smoke.test.tsx` and/or create `app/components/ui/DataView.a11y.test.tsx`
- Consumes: `textAlignClass`, chevron RTL, live region for result changes

**Interfaces:**

- Consumes: `textAlignClass` from `lib/ui/align.ts`; `getWritingDirection`
- Produces:
  - `align` on columns still accepts `'left' | 'right' | 'center'` and ideally `'start' | 'end'` (extend type)
  - Sortable headers keep/`improve` `aria-sort`
  - Visually hidden or `aria-live="polite"` status node announcing filtered row count when filters/search change
  - Pagination chevrons: in RTL, swap which icon means previous/next **or** use logical labels (“Previous”/“Next”) with icons that flip via `className={dir === 'rtl' ? 'rotate-180' : ''}` on a single chevron — prefer accessible text labels that stay correct + CSS flip icons
  - `scope="col"` on header cells

- [ ] **Step 1: Write failing tests**

```tsx
/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DataView } from './DataView'

type Row = { id: string; name: string; amount: number }

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('DataView a11y', () => {
  it('exposes aria-sort on the active sortable column', () => {
    const onSortChange = vi.fn()
    render(
      <DataView
        columns={[
          {
            id: 'name',
            header: 'Name',
            sortable: true,
            cell: (r: Row) => r.name,
          },
        ]}
        rows={[{ id: '1', name: 'Ada', amount: 10 }]}
        rowKey={(r) => r.id}
        mobileCard={(r) => <div>{r.name}</div>}
        tableId="a11y-dv"
        toolbar={false}
        sort={{ id: 'name', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    )
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  it('announces filtered result count in a polite live region', () => {
    render(
      <DataView
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (r: Row) => r.name,
          },
        ]}
        rows={[
          { id: '1', name: 'Ada', amount: 10 },
          { id: '2', name: 'Grace', amount: 20 },
        ]}
        rowKey={(r) => r.id}
        mobileCard={(r) => <div>{r.name}</div>}
        tableId="a11y-dv-search"
        globalSearch
      />,
    )
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).toBeTruthy()
    expect(live?.textContent || '').toMatch(/2/)

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'Ada' } })
    expect(document.querySelector('[aria-live="polite"]')?.textContent || '').toMatch(/1/)
  })
})
```

If the search field is a plain `textbox` rather than `searchbox`, use `getByRole('textbox', { name: /search/i })` after inspecting the rendered markup.

Implement the live region in Step 3 as:

```tsx
<div className="sr-only" aria-live="polite" aria-atomic="true">
  {`${visibleRowCount} results`}
</div>
```

- [ ] **Step 2: Run tests — live region should fail until implemented**

Run: `npx vitest run app/components/ui/DataView.a11y.test.tsx`

- [ ] **Step 3: Implement DataView upgrades**

1. Replace `alignClass` with `textAlignClass` from `lib/ui/align.ts`; extend `DataColumn.align` type.
2. Ensure header `<th scope="col">`.
3. Add polite live region bound to visible/filtered row count.
4. Pagination: accessible names “Previous page” / “Next page”; flip chevron icons under `dir="rtl"` via `getWritingDirection`.
5. Confirm numeric cells can use `tabular` class (document in column examples; don’t force globally).
6. Row `ActionMenu` already keyboard-upgraded in Task 6.

- [ ] **Step 4: Run DataView tests**

Run: `npx vitest run app/components/ui/DataView.a11y.test.tsx app/components/ui/DataView.smoke.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/DataView.tsx app/components/ui/DataView.a11y.test.tsx app/components/ui/DataView.smoke.test.tsx
git commit -m "feat(ui): DataView AA+ sort, live region, and RTL pagination"
```

---

### Task 11: Kit-wide token lint + manual checklist sign-off notes

**Files:**

- Create: `lib/ui/kit-token-policy.test.ts`
- Modify: `docs/design-system/README.md` (mark manual QA checklist items)

**Interfaces:**

- Consumes: all `app/components/ui/*.tsx` sources
- Produces: regression test forbidding raw `green|amber|red|blue|yellow|indigo|purple)-\d` palette utilities inside kit TSX (allowlist exceptions only if strictly necessary — prefer zero exceptions)

- [ ] **Step 1: Write kit token policy test**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const UI_DIR = path.join(process.cwd(), 'app/components/ui')
const PALETTE =
  /\b(bg|text|border|ring|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

describe('ui kit token policy', () => {
  it('avoids raw Tailwind palette color utilities', () => {
    const files = fs.readdirSync(UI_DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    const offenders: string[] = []
    for (const file of files) {
      const src = fs.readFileSync(path.join(UI_DIR, file), 'utf8')
      if (PALETTE.test(src)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run — fix any remaining offenders in kit files**

Run: `npx vitest run lib/ui/kit-token-policy.test.ts`

- [ ] **Step 3: Run full ui test batch**

Run: `npx vitest run app/components/ui lib/ui`

Expected: PASS

- [ ] **Step 4: Update `docs/design-system/README.md` manual QA section** with a short “how to verify” for VoiceOver/NVDA + `he` locale — no need to automate.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/kit-token-policy.test.ts docs/design-system/README.md app/components/ui
git commit -m "test(ui): enforce kit semantic token policy"
```

---

## Manual verification (after Task 11)

1. Light + dark: scan Button/Input/Alert/DataView contrast.
2. Keyboard: Modal trap, ActionMenu arrows, Tabs, DataView sort headers, row actions.
3. Screen reader spot-check: form error association; DataView sort + result count.
4. `dir="rtl"` (or `he` locale): Tabs direction, padding icons, pagination chevrons, menus align to end.

---

## Spec coverage self-review

| Spec requirement                                                       | Task(s)                |
| ---------------------------------------------------------------------- | ---------------------- |
| Token policy / semantic tokens / soft status                           | 1, 9, 11               |
| Written design-system notes                                            | 1, 11                  |
| Form contracts (label, describedby, invalid)                           | 3                      |
| Button/loading/destructive                                             | 4                      |
| Alert live/status roles                                                | 4                      |
| Modal focus/Escape/restore                                             | 5                      |
| Tooltip not sole channel                                               | 5 (JSDoc + review)     |
| Menu keyboard + Escape                                                 | 6                      |
| Tabs roles/keyboard + RTL                                              | 7                      |
| Filter/column chrome labels                                            | 8                      |
| ImportModal in full ui/\* pass                                         | 9                      |
| DataView AA+ (sort, live region, keyboard rows, tabular guidance, RTL) | 10                     |
| Vitest smokes/a11y extensions                                          | 3–11                   |
| No new UI library / refresh not rebrand                                | Global constraints     |
| Reduced motion                                                         | 1                      |
| Dark mode retained                                                     | Global + Task 1 tokens |

**Placeholder scan:** Cleared — Modal uses `fireEvent` (no new deps); FilterChips and DataView tests use real prop shapes (`ActiveFilter`, `globalSearch`).

**Type consistency:** `TextAlign` / `textAlignClass` from Task 2 are the only align helpers; DataView must import them rather than keeping a private `alignClass`. Soft status Tailwind keys from Task 1 are what ImportModal (Task 9) and the kit policy test (Task 11) rely on.
