// Generates app/components/ui/**/*.smoke.test.tsx (minimal render smoke tests).
// Usage: npx tsx scripts/generate-app-smoke-tests.ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UI_DIR = path.join(ROOT, 'app', 'components', 'ui')

/** Components that need heavy context — covered by Playwright / manual tests. */
const SKIP = new Set([
  'DataView',
  'ImportModal',
  'ImportMenu',
  'ExportMenu',
  'FilterPopover',
  'ColumnPicker',
  'ActionMenu',
  'FilterChips',
])

const RENDER: Record<string, string> = {
  Button: "React.createElement(Component, null, 'Label')",
  Textarea: "React.createElement(Component, { 'aria-label': 'smoke' })",
  Input: "React.createElement(Component, { 'aria-label': 'smoke' })",
  Select: "React.createElement(Component, { 'aria-label': 'smoke' }, React.createElement('option', null, 'a'))",
  Modal:
    "React.createElement(Component, { open: false, onClose: () => {}, title: 'Smoke', children: 'body' })",
  Tabs:
    "React.createElement(Component, { items: [{ id: 'a', label: 'Tab' }], activeId: 'a', onChange: () => {} })",
  EmptyState: "React.createElement(Component, { title: 'Empty' })",
  PageHeader: "React.createElement(Component, { title: 'Smoke' })",
  Tooltip: "React.createElement(Component, { content: 'Tip', children: 'Hover' })",
  Skeleton: 'React.createElement(Component, null)',
}

function isClientComponent(file: string): boolean {
  const text = fs.readFileSync(file, 'utf8')
  return /'use client'/.test(text) || /"use client"/.test(text)
}

function componentName(file: string): string {
  return path.basename(file, '.tsx')
}

function importLine(file: string, name: string): string {
  const text = fs.readFileSync(file, 'utf8')
  if (/export default/.test(text)) {
    return `import Component from './${name}'`
  }
  if (new RegExp(`export (?:const|function) ${name}\\b`).test(text)) {
    return `import { ${name} as Component } from './${name}'`
  }
  return `import Component from './${name}'`
}

function renderExpr(name: string): string {
  return RENDER[name] ?? 'React.createElement(Component, null)'
}

function generate(source: string): string {
  const name = componentName(source)
  return `/**
 * @vitest-environment happy-dom
 * Auto-generated — npm run app-smoke:generate
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
${importLine(source, name)}

describe('${name} smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(${renderExpr(name)} as React.ReactElement)
    expect(container).toBeDefined()
  })
})
`
}

function main() {
  const targets = fs
    .readdirSync(UI_DIR)
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx') && !f.endsWith('.smoke.test.tsx'))
    .map((f) => path.join(UI_DIR, f))
    .filter((f) => isClientComponent(f))
    .filter((f) => !SKIP.has(componentName(f)))

  let written = 0
  for (const source of targets) {
    const out = source.replace(/\.tsx$/, '.smoke.test.tsx')
    const next = generate(source)
    if (fs.existsSync(out) && fs.readFileSync(out, 'utf8') === next) continue
    fs.writeFileSync(out, next, 'utf8')
    written++
  }

  for (const ent of fs.readdirSync(UI_DIR)) {
    if (!ent.endsWith('.smoke.test.tsx')) continue
    const base = ent.replace('.smoke.test.tsx', '')
    if (SKIP.has(base) && !targets.some((t) => componentName(t) === base)) {
      fs.unlinkSync(path.join(UI_DIR, ent))
    }
  }

  console.log(`Smoke tests: ${written} written (${targets.length} UI targets, ${SKIP.size} skipped).`)
}

main()
