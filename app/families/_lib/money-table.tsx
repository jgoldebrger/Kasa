import type { ReactNode } from 'react'
import { Badge } from '@/app/components/ui'

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  paid: 'success',
  complete: 'success',
  pending: 'warning',
  overdue: 'danger',
  failed: 'danger',
  void: 'muted',
  cancelled: 'muted',
}

export function moneyStatusCell(
  status: string,
  label: string,
): { display: ReactNode; srLabel: string } {
  const variant = STATUS_VARIANT[status.toLowerCase()] ?? 'muted'
  return {
    display: (
      <Badge variant={variant} aria-hidden="true">
        {label}
      </Badge>
    ),
    srLabel: label,
  }
}

export function moneyAmountCell(
  amount: number,
  formatMoney: (n: number) => string,
  tone: 'default' | 'positive' | 'negative' = 'default',
): ReactNode {
  const toneClass =
    tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : 'text-fg'
  return <span className={`font-semibold tabular ${toneClass}`}>{formatMoney(amount)}</span>
}
