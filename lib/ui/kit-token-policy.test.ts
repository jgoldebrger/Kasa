import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = path.join(process.cwd(), 'app/components/ui')
const RAW_PALETTE_UTILITY =
  /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
// Raw black/white utilities bypass the theme's fg/bg tokens (and, unlike the
// palette shades above, silently break dark mode / contrast). Matched with
// its own regex so allowlisted exceptions (e.g. modal scrims) can be scoped
// per-file below instead of relaxing the check for everyone.
const RAW_BLACK_WHITE_UTILITY =
  /\b(?:bg|text|border|ring|from|to|via)-(?:white|black)(?:\/\d{1,3})?\b/

// Files allowed to use a raw black/white utility for a specific, reviewed
// reason. Keep this list short — prefer fixing the offender instead.
const BLACK_WHITE_ALLOWLIST: Record<string, RegExp> = {
  // Modal backdrop/scrim — intentionally a raw black wash (not themed text or
  // a surface) so it stays visually correct in both light and dark mode.
  'Modal.tsx': /bg-black\/50|bg-black\/70/,
}

describe('ui kit token policy', () => {
  it('avoids raw Tailwind palette color utilities in component sources', () => {
    const componentFiles = fs
      .readdirSync(UI_DIR)
      .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    const offenders: string[] = []

    for (const file of componentFiles) {
      const source = fs.readFileSync(path.join(UI_DIR, file), 'utf8')
      if (RAW_PALETTE_UTILITY.test(source)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('avoids raw black/white color utilities in component sources', () => {
    const componentFiles = fs
      .readdirSync(UI_DIR)
      .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    const offenders: string[] = []

    for (const file of componentFiles) {
      const source = fs.readFileSync(path.join(UI_DIR, file), 'utf8')
      const matches = source.match(new RegExp(RAW_BLACK_WHITE_UTILITY, 'g')) || []
      const allowlist = BLACK_WHITE_ALLOWLIST[file]
      const unexplained = matches.filter((m) => !allowlist?.test(m))
      if (unexplained.length > 0) {
        offenders.push(`${file}: ${unexplained.join(', ')}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
