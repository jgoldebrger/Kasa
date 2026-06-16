'use client'

import { CreditCardIcon, PlusIcon } from '@heroicons/react/24/outline'
import PaymentPlansTable, {
  type PaymentPlanRow,
} from '@/app/components/settings/PaymentPlansTable'

export interface PaymentPlansPanelProps {
  plans: PaymentPlanRow[]
  onAdd: () => void
  onEdit: (plan: PaymentPlanRow) => void
  onDelete: (id: string) => void
}

export default function PaymentPlansPanel({
  plans,
  onAdd,
  onEdit,
  onDelete,
}: PaymentPlansPanelProps) {
  return (
    <div className="bg-surface rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
            <CreditCardIcon className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-fg">Payment Plans</h2>
            <p className="text-sm text-fg-muted">
              Manage payment plans and view families using each plan
            </p>
          </div>
        </div>
        <button
          onClick={onAdd}
          className="focus-ring bg-accent text-accent-fg px-4 py-2 rounded-md flex items-center gap-2 hover:bg-accent-hover transition-colors text-sm font-medium"
        >
          <PlusIcon className="h-4 w-4" />
          Add Payment Plan
        </button>
      </div>

      <PaymentPlansTable
        plans={plans}
        onEdit={onEdit}
        onDelete={onDelete}
        tableId="settings-payment-plans"
      />
    </div>
  )
}
