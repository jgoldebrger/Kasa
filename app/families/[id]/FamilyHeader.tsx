'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  DocumentTextIcon,
  PaperAirplaneIcon,
  PlusIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline'
import { Button, Card, Tooltip } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import EmailFamilyModal from '@/app/families/_components/EmailFamilyModal'
import FamilyEmailAdminActions from '@/app/families/_components/FamilyEmailAdminActions'
import FamilyEmailIndicators from '@/app/families/_components/FamilyEmailIndicators'
import FamilyTagsEditor from '@/app/families/_components/FamilyTagsEditor'
import { familyTabHref } from './_lib/constants'
import MemberMakePaymentModal from './_components/MemberMakePaymentModal'
import { useFamilyDetail } from './FamilyDetailContext'

export default function FamilyHeader() {
  const t = useT()
  const {
    familyId,
    data,
    isAdmin,
    memberFinancialAccess,
    formatMoney,
    getPlanNameById,
    setShowTaskModal,
    setData,
  } = useFamilyDetail()
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [cardPaymentsEnabled, setCardPaymentsEnabled] = useState(false)

  useEffect(() => {
    if (isAdmin || !memberFinancialAccess) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/families/${familyId}/member-financials`)
        if (!res.ok || cancelled) return
        const payload = await res.json()
        if (!cancelled) setCardPaymentsEnabled(Boolean(payload.cardPaymentsEnabled))
      } catch {
        /* header CTAs still work for offline payments */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [familyId, isAdmin, memberFinancialAccess])

  if (!data?.family) return null

  const family = data.family
  const canEmail = isAdmin && Boolean(family.email?.trim())

  return (
    <Card className="mb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
            {family.name}
          </h1>
          {family.email && (
            <div className="mt-1 space-y-2">
              <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                <span>{family.email}</span>
                <FamilyEmailIndicators family={family} />
              </p>
              {isAdmin && (
                <FamilyEmailAdminActions
                  familyId={String(family._id)}
                  family={family}
                  onUpdated={(patch) =>
                    setData((prev: typeof data) =>
                      prev ? { ...prev, family: { ...prev.family, ...patch } } : prev,
                    )
                  }
                />
              )}
            </div>
          )}
          {isAdmin && (
            <FamilyTagsEditor
              familyId={String(family._id)}
              tags={family.tags ?? []}
              className="mt-3"
              onUpdated={(tags) =>
                setData((prev: typeof data) =>
                  prev ? { ...prev, family: { ...prev.family, tags } } : prev,
                )
              }
            />
          )}
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            {canEmail && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowEmailModal(true)}
                leftIcon={<PaperAirplaneIcon className="h-4 w-4" aria-hidden="true" />}
              >
                {t('families.email.sendToFamily')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setShowTaskModal(true)}
              leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
            >
              {t('family.header.addTask')}
            </Button>
          </div>
        ) : memberFinancialAccess ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setPaymentModalOpen(true)}>
              {t('memberPortal.makePayment')}
            </Button>
            <Link
              href={familyTabHref(familyId, 'statements')}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-app-subtle"
            >
              <DocumentTextIcon className="h-4 w-4" aria-hidden="true" />
              {t('memberPortal.viewStatements')}
            </Link>
          </div>
        ) : null}
      </div>
      <EmailFamilyModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        family={{
          _id: String(family._id),
          name: family.name || '',
          email: family.email,
          emailOptOut: family.emailOptOut,
          emailDeliverabilityWarning: family.emailDeliverabilityWarning,
          emailFormatInvalid: family.emailFormatInvalid,
        }}
      />
      {!isAdmin && memberFinancialAccess && (
        <MemberMakePaymentModal
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          familyId={familyId}
          cardPaymentsEnabled={cardPaymentsEnabled}
        />
      )}
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
