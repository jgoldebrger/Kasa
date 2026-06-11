/**
 * Print uncovered files from vitest v8 coverage (json-summary).
 * Run after: npm run test:coverage
 */
const fs = require('fs')
const path = require('path')

const summaryPath = path.join(__dirname, '..', 'coverage', 'coverage-summary.json')
if (!fs.existsSync(summaryPath)) {
  console.error('Missing coverage/coverage-summary.json — run npm run test:coverage first.')
  process.exit(1)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const rows = Object.entries(summary)
  .filter(([key]) => key !== 'total')
  .map(([file, stats]) => ({
    file: file.replace(/\\/g, '/'),
    pct: stats.lines.pct,
    uncovered: stats.lines.total - stats.lines.covered,
  }))
  .filter((r) => r.pct < 100)
  .sort((a, b) => a.pct - b.pct)

console.log('\nFiles below 100% line coverage:\n')
for (const r of rows) {
  console.log(`  ${String(r.pct).padStart(6)}%  (${r.uncovered} lines)  ${r.file}`)
}
console.log(`\n${rows.length} file(s) still have uncovered lines.\n`)
