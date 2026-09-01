/** Persist only the last 4 digits of a routing number; mask the rest. */
export function sanitizeRoutingNumber(value: string | undefined | null): string | undefined {
  if (!value?.trim()) return undefined
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return undefined
  return `*****${digits.slice(-4)}`
}

export function redactCheckInfoForExport(
  checkInfo: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!checkInfo) return checkInfo ?? null
  const out = { ...checkInfo }
  if (typeof out.routingNumber === 'string' && out.routingNumber.trim()) {
    out.routingNumber = sanitizeRoutingNumber(out.routingNumber) ?? '[REDACTED]'
  }
  return out
}
