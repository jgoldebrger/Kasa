/**
 * @deprecated Use `npx tsx scripts/generate-monthly-statements.ts` instead.
 * The legacy implementation used gross payment amounts, omitted organizationId
 * scoping, and called calculateFamilyBalance with the wrong signature.
 */
console.error(
  'scripts/generate-monthly-statements.js is deprecated.\n' +
    'Run: ORGANIZATION_ID=<id> npm run generate-statements\n' +
    'Or use POST /api/jobs/generate-monthly-statements in production.',
)
process.exit(1)
