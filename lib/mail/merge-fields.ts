export interface MergeFieldContext {
  familyName?: string
  balance?: number
  dues?: number
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

/** Replace `{{familyName}}`, `{{balance}}`, and `{{dues}}` in a template string. */
export function applyMergeFields(template: string, ctx: MergeFieldContext): string {
  let out = template
  if (ctx.familyName != null) {
    out = out.replace(/\{\{familyName\}\}/g, ctx.familyName)
  }
  if (ctx.balance != null) {
    out = out.replace(/\{\{balance\}\}/g, formatMoney(ctx.balance))
  }
  if (ctx.dues != null) {
    out = out.replace(/\{\{dues\}\}/g, formatMoney(ctx.dues))
  }
  return out
}
