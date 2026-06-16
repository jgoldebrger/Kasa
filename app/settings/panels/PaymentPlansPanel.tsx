'use client'

import { useEffect, useRef, useState } from 'react'
import { CreditCardIcon, PlusIcon } from '@heroicons/react/24/outline'
import { cachedFetch } from '@/lib/client-cache'
import {
  collectAllFamiliesPages,
  familiesListUrl,
  parseFamiliesListResponse,
} from '@/lib/client/families-list'
import PaymentPlansTable, {
  type PaymentPlanFamily,
  type PaymentPlanRow,
} from '@/app/components/settings/PaymentPlansTable'

const ROSTER_PAGE_SIZE = 50

export interface PaymentPlansPanelProps {
  plans: PaymentPlanRow[]
  onAdd: () => void
  onEdit: (plan: PaymentPlanRow) => void
  onDelete: (id: string) => void
}

function mergePlanRosters(plans: PaymentPlanRow[], families: any[]): PaymentPlanRow[] {
  const byPlan = new Map<string, PaymentPlanFamily[]>()
  for (const f of families) {
    const planId = f.paymentPlanId ? String(f.paymentPlanId) : ''
    if (!planId) continue
    if (!byPlan.has(planId)) byPlan.set(planId, [])
    byPlan.get(planId)!.push({
      _id: String(f._id),
      name: f.name,
      weddingDate: f.weddingDate,
    })
  }
  return plans.map((p) => {
    const roster = byPlan.get(p._id) || []
    return {
      ...p,
      familyCount: roster.length,
      families: roster,
    }
  })
}

export default function PaymentPlansPanel({
  plans,
  onAdd,
  onEdit,
  onDelete,
}: PaymentPlansPanelProps) {
  const [displayPlans, setDisplayPlans] = useState<PaymentPlanRow[]>(plans)
  const fetchGenRef = useRef(0)

  useEffect(() => {
    setDisplayPlans(plans)
  }, [plans])

  useEffect(() => {
    const gen = ++fetchGenRef.current
    let cancelled = false
    ;(async () => {
      try {
        const families = await collectAllFamiliesPages(async (cursor) => {
          const data = await cachedFetch(familiesListUrl(cursor, ROSTER_PAGE_SIZE), {
            ttl: 60_000,
          })
          return parseFamiliesListResponse(data)
        }, ROSTER_PAGE_SIZE)
        if (cancelled || fetchGenRef.current !== gen) return
        setDisplayPlans(mergePlanRosters(plans, families))
      } catch {
        // Keep plan metadata visible; rosters stay empty until refresh.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [plans])

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
        plans={displayPlans}
        onEdit={onEdit}
        onDelete={onDelete}
        tableId="settings-payment-plans"
      />
    </div>
  )
}
