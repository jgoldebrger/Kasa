import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = path.join(process.cwd(), 'app/components/ui')
const RAW_PALETTE_UTILITY =
  /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

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
})
