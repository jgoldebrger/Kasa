'use client'

import { PlusIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
import { Button, Card, Tooltip } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { useFamilyDetail } from './FamilyDetailContext'

export default function FamilyHeader() {
  const t = useT()
  const { data, isAdmin, formatMoney, getPlanNameById, setShowTaskModal } = useFamilyDetail()

  if (!data?.family) return null

  return (
    <Card className="mb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
          {data.family.name}
        </h1>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => setShowTaskModal(true)}
            leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
          >
            {t('family.header.addTask')}
          </Button>
        )}
      </div>
      <div
        className={`mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4${isAdmin ? ' md:grid-cols-7' : ''}`}
      >
        <div>
          <p className="text-sm text-fg-muted">{t('family.weddingDate')}</p>
          <p className="font-medium tabular">
            {new Date(data.family.weddingDate).toLocaleDateString()}
          </p>
        </div>
        {isAdmin && (
          <>
            <div>
              <p className="text-sm text-fg-muted">{t('family.header.currentPlan')}</p>
              <p className="font-medium">{getPlanNameById(data.family.paymentPlanId)}</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-sm text-fg-muted">
                {t('family.balance')}
                <Tooltip content={t('family.header.balanceTooltip')}>
                  <QuestionMarkCircleIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
                </Tooltip>
              </p>
              <p
                className={`font-medium tabular ${
                  data.balance.balance < 0 ? 'text-danger' : 'text-success'
                }`}
              >
                {formatMoney(data.balance.balance)}
              </p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">{t('family.members')}</p>
              <p className="font-medium tabular">{data.members.length}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">{t('family.header.totalPayments')}</p>
              <p className="font-medium tabular text-success">
                {formatMoney(data.balance.totalPayments)}
              </p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">{t('family.lifecycleEvents')}</p>
              <p className="font-medium tabular text-accent">
                {formatMoney(data.balance.totalLifecyclePayments)}
              </p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">{t('family.header.planCostAnnual')}</p>
              <p className="font-medium tabular text-warning">
                {formatMoney(-(data.balance.planCost || 0))}
              </p>
            </div>
            {(data.balance.totalCycleCharges || 0) > 0 && (
              <div>
                <p className="text-sm text-fg-muted">{t('family.header.pastCycleCharges')}</p>
                <p className="font-medium tabular text-warning">
                  {formatMoney(-(data.balance.totalCycleCharges || 0))}
                </p>
              </div>
            )}
          </>
        )}
        {!isAdmin && (
          <div>
            <p className="text-sm text-fg-muted">{t('family.members')}</p>
            <p className="font-medium tabular">{data.members.length}</p>
          </div>
        )}
      </div>
    </Card>
  )
}
