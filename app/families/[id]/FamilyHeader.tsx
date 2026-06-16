'use client'

import { PlusIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
import { Button, Tooltip } from '@/app/components/ui'
import { useFamilyDetail } from './FamilyDetailContext'

export default function FamilyHeader() {
  const { data, isAdmin, formatMoney, getPlanNameById, setShowTaskModal } = useFamilyDetail()

  if (!data?.family) return null

  return (
    <div className="surface-card p-5 sm:p-6 mb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold text-fg">{data.family.name}</h1>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => setShowTaskModal(true)}
            leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
          >
            Add Task
          </Button>
        )}
      </div>
      <div className={`grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border${isAdmin ? ' md:grid-cols-7' : ''}`}>
        <div>
          <p className="text-sm text-fg-muted">Wedding Date</p>
          <p className="font-medium">{new Date(data.family.weddingDate).toLocaleDateString()}</p>
        </div>
        {isAdmin && (
          <>
            <div>
              <p className="text-sm text-fg-muted">Current Plan</p>
              <p className="font-medium">{getPlanNameById(data.family.paymentPlanId)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted flex items-center gap-1">
                Balance
                <Tooltip content="Cash received minus lifecycle expenses and plan costs for the current cycle.">
                  <QuestionMarkCircleIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                </Tooltip>
              </p>
              <p className="font-medium text-green-600">{formatMoney(data.balance.balance)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Members</p>
              <p className="font-medium">{data.members.length}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Total Payments</p>
              <p className="font-medium text-green-600">{formatMoney(data.balance.totalPayments)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Lifecycle Events</p>
              <p className="font-medium text-accent">{formatMoney(data.balance.totalLifecyclePayments)}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">Plan Cost (Annual)</p>
              <p className="font-medium text-orange-600">{formatMoney(-(data.balance.planCost || 0))}</p>
            </div>
            {(data.balance.totalCycleCharges || 0) > 0 && (
              <div>
                <p className="text-sm text-fg-muted">Past Cycle Charges</p>
                <p className="font-medium text-orange-600">{formatMoney(-(data.balance.totalCycleCharges || 0))}</p>
              </div>
            )}
          </>
        )}
        {!isAdmin && (
          <div>
            <p className="text-sm text-fg-muted">Members</p>
            <p className="font-medium">{data.members.length}</p>
          </div>
        )}
      </div>
    </div>
  )
}
