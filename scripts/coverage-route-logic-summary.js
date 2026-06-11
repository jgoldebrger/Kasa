/**
 * List lib/route-logic files below 100% line coverage.
 * Run after: npm run test:route-logic-coverage
 */
const fs = require('fs')
const path = require('path')

const summaryPath = path.join(__dirname, '..', 'coverage-route-logic', 'coverage-summary.json')
if (!fs.existsSync(summaryPath)) {
  console.error('Missing coverage-route-logic/coverage-summary.json — run npm run test:route-logic-coverage first.')
  process.exit(1)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const rows = Object.entries(summary)
  .filter(([key]) => key !== 'total' && key.replace(/\\/g, '/').includes('route-logic'))
  .map(([file, stats]) => ({
    file: file.replace(/.*route-logic/i, 'route-logic').replace(/\\/g, '/'),
    pct: stats.lines.pct,
    uncovered: stats.lines.total - stats.lines.covered,
  }))
  .filter((r) => r.pct < 100)
  .sort((a, b) => a.pct - b.pct)

console.log('\nlib/route-logic files below 100% lines:\n')
for (const r of rows) {
  console.log(`  ${String(r.pct).padStart(6)}%  (${r.uncovered} lines)  ${r.file}`)
}
console.log(`\n${rows.length} file(s) below 100%.\n`)
