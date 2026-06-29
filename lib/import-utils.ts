/** Normalize spreadsheet column names for header matching. */
export function normalizeColumnName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '').replace(/[_-]/g, '')
}
