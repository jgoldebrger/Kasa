// @ts-nocheck
'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  PencilSquareIcon,
  ArrowsRightLeftIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import { Alert, Button, Card } from '@/app/components/ui'
import { FamilyPageHeader } from '@/app/families/_lib'
import FamilyEmailAdminActions from '@/app/families/_components/FamilyEmailAdminActions'
import FamilyEmailIndicators from '@/app/families/_components/FamilyEmailIndicators'
import { useT } from '@/lib/client/i18n'
import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { useFamilyDetail } from '../FamilyDetailContext'
import { familyTabHref } from '../_lib/constants'
import { normalizePlanId } from '@/lib/payment-plan-display'
import MemberFinancialPanel from './MemberFinancialPanel'
import MemberMakePaymentModal from './MemberMakePaymentModal'
import MergeFamilyModal from './MergeFamilyModal'

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card compact>
      <h4 className="mb-4 border-b border-border pb-2 text-sm font-semibold text-fg">{title}</h4>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  )
}

function InfoField({
  label,
  children,
  dir,
}: {
  label: string
  children: ReactNode
  dir?: 'rtl' | 'ltr'
}) {
  return (
    <div className="min-w-0" dir={dir}>
      <p className="mb-1 text-xs font-medium text-fg-muted">{label}</p>
      {children}
    </div>
  )
}

function emptyValue(text = 'Not set') {
  return <span className="font-normal text-fg-subtle">{text}</span>
}

function InfoTabContent(props: FamilyDetailContextValue) {
  const {
    data,
    isAdmin,
    familyId,
    memberFinancialAccess,
    paymentPlans,
    getPlanNameById,
    setInfoForm,
    setShowInfoModal,
    renderEditableField,
    setData,
  } = props

  const t = useT()
  const [showMergeModal, setShowMergeModal] = useState(false)
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

  const family = data?.family
  if (!family) return null

  const openEditAllModal = () => {
    setInfoForm({
      name: family.name || '',
      hebrewName: family.hebrewName || '',
      weddingDate: family.weddingDate
        ? new Date(family.weddingDate).toISOString().split('T')[0]
        : '',
      husbandFirstName: family.husbandFirstName || '',
      husbandHebrewName: family.husbandHebrewName || '',
      husbandFatherHebrewName: family.husbandFatherHebrewName || '',
      wifeFirstName: family.wifeFirstName || '',
      wifeHebrewName: family.wifeHebrewName || '',
      wifeFatherHebrewName: family.wifeFatherHebrewName || '',
      husbandCellPhone: family.husbandCellPhone || '',
      wifeCellPhone: family.wifeCellPhone || '',
      address: family.address || '',
      street: family.street || '',
      phone: family.phone || '',
      email: family.email || '',
      city: family.city || '',
      state: family.state || '',
      zip: family.zip || '',
      paymentPlanId: family.paymentPlanId?.toString() || '',
    })
    setShowInfoModal(true)
  }

  return (
    <div className="space-y-4">
      {!isAdmin && memberFinancialAccess && (
        <FamilyPageHeader
          title={t('memberPortal.currentBalance')}
          primaryAction={
            <Button size="sm" onClick={() => setPaymentModalOpen(true)}>
              {t('memberPortal.makePayment')}
            </Button>
          }
          secondaryActions={
            <Link
              href={familyTabHref(familyId, 'statements')}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-app-subtle"
            >
              <DocumentTextIcon className="h-4 w-4" aria-hidden="true" />
              {t('memberPortal.viewStatements')}
            </Link>
          }
        />
      )}
      {!isAdmin && (
        <MemberFinancialPanel
          familyId={familyId}
          memberFinancialAccess={memberFinancialAccess}
          initialBalance={memberFinancialAccess ? data?.balance : null}
          initialPayments={memberFinancialAccess ? data?.payments : []}
        />
      )}
      {!isAdmin && memberFinancialAccess && (
        <MemberMakePaymentModal
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          familyId={familyId}
          cardPaymentsEnabled={cardPaymentsEnabled}
        />
      )}
      <FamilyPageHeader
        title="Family profile"
        description={
          isAdmin
            ? 'Click any value to edit inline, or use Edit all for the full form.'
            : 'Contact and household details for this family.'
        }
        primaryAction={
          isAdmin ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<PencilSquareIcon className="h-4 w-4" aria-hidden="true" />}
              onClick={openEditAllModal}
            >
              Edit all
            </Button>
          ) : undefined
        }
      />

      {isAdmin && (
        <Alert variant="info" className="text-sm">
          Tip: click a field, type your change, then press Enter or ✓ to save.
        </Alert>
      )}

      <InfoSection title="Basic information">
        <InfoField label="Family name">
          {renderEditableField(
            'name',
            <p className="font-medium text-fg">{family.name || emptyValue()}</p>,
            'name',
          )}
        </InfoField>
        <InfoField label="Family name (Hebrew)" dir="rtl">
          {renderEditableField(
            'hebrewName',
            <p className="font-medium text-fg">{family.hebrewName || emptyValue()}</p>,
            'hebrew',
          )}
        </InfoField>
        <InfoField label="Wedding date">
          {renderEditableField(
            'weddingDate',
            <p className="font-medium text-fg tabular">
              {family.weddingDate
                ? new Date(family.weddingDate).toLocaleDateString()
                : emptyValue()}
            </p>,
            'date',
          )}
        </InfoField>
        {isAdmin && (
          <InfoField label="Payment plan">
            {renderEditableField(
              'paymentPlanId',
              <p className="font-medium text-fg">{getPlanNameById(family.paymentPlanId)}</p>,
              'select',
              paymentPlans.map((plan) => ({
                value: normalizePlanId(plan._id),
                label: plan.name,
              })),
            )}
          </InfoField>
        )}
        {family.parentFamilyId && (
          <InfoField label="Parent household">
            <Link
              href={`/families/${family.parentFamilyId}`}
              className="font-medium text-accent hover:underline"
            >
              View parent family
            </Link>
          </InfoField>
        )}
      </InfoSection>

      {isAdmin && (
        <InfoSection title="Household actions">
          <div className="col-span-full flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              Merge this household into another family. Members, payments, and events move to the
              target; this record is archived.
            </p>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<ArrowsRightLeftIcon className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setShowMergeModal(true)}
            >
              Merge household
            </Button>
          </div>
        </InfoSection>
      )}

      <MergeFamilyModal
        open={showMergeModal}
        onClose={() => setShowMergeModal(false)}
        sourceFamilyId={familyId}
        sourceFamilyName={family.name || ''}
      />

      <InfoSection title="Husband">
        <InfoField label="First name">
          {renderEditableField(
            'husbandFirstName',
            <p className="font-medium text-fg">{family.husbandFirstName || emptyValue()}</p>,
            'name',
          )}
        </InfoField>
        <InfoField label="Hebrew name" dir="rtl">
          {renderEditableField(
            'husbandHebrewName',
            <p className="font-medium text-fg">{family.husbandHebrewName || emptyValue()}</p>,
            'hebrew',
          )}
        </InfoField>
        <InfoField label="Father's Hebrew name" dir="rtl">
          {renderEditableField(
            'husbandFatherHebrewName',
            <p className="font-medium text-fg">{family.husbandFatherHebrewName || emptyValue()}</p>,
            'hebrew',
          )}
        </InfoField>
        <InfoField label="Cell phone">
          {renderEditableField(
            'husbandCellPhone',
            <p className="font-medium text-fg tabular">
              {family.husbandCellPhone || emptyValue()}
            </p>,
            'phone',
          )}
        </InfoField>
      </InfoSection>

      <InfoSection title="Wife">
        <InfoField label="First name">
          {renderEditableField(
            'wifeFirstName',
            <p className="font-medium text-fg">{family.wifeFirstName || emptyValue()}</p>,
            'name',
          )}
        </InfoField>
        <InfoField label="Hebrew name" dir="rtl">
          {renderEditableField(
            'wifeHebrewName',
            <p className="font-medium text-fg">{family.wifeHebrewName || emptyValue()}</p>,
            'hebrew',
          )}
        </InfoField>
        <InfoField label="Father's Hebrew name" dir="rtl">
          {renderEditableField(
            'wifeFatherHebrewName',
            <p className="font-medium text-fg">{family.wifeFatherHebrewName || emptyValue()}</p>,
            'hebrew',
          )}
        </InfoField>
        <InfoField label="Cell phone">
          {renderEditableField(
            'wifeCellPhone',
            <p className="font-medium text-fg tabular">{family.wifeCellPhone || emptyValue()}</p>,
            'phone',
          )}
        </InfoField>
      </InfoSection>

      <InfoSection title="Contact & address">
        <InfoField label="Email">
          {renderEditableField(
            'email',
            <div className="space-y-2">
              <p className="font-medium text-fg break-all">{family.email || emptyValue()}</p>
              {family.email && <FamilyEmailIndicators family={family} />}
              {isAdmin && family.email && (
                <FamilyEmailAdminActions
                  familyId={familyId}
                  family={family}
                  onUpdated={(patch) =>
                    setData((prev) =>
                      prev ? { ...prev, family: { ...prev.family, ...patch } } : prev,
                    )
                  }
                />
              )}
            </div>,
            'email',
          )}
        </InfoField>
        <InfoField label="Home phone">
          {renderEditableField(
            'phone',
            <p className="font-medium text-fg tabular">{family.phone || emptyValue()}</p>,
            'phone',
          )}
        </InfoField>
        <InfoField label="Street address" dir="auto">
          {renderEditableField(
            'street',
            <p className="font-medium text-fg">
              {family.street || family.address || emptyValue()}
            </p>,
          )}
        </InfoField>
        <InfoField label="City">
          {renderEditableField(
            'city',
            <p className="font-medium text-fg">{family.city || emptyValue()}</p>,
          )}
        </InfoField>
        <InfoField label="State">
          {renderEditableField(
            'state',
            <p className="font-medium text-fg">{family.state || emptyValue()}</p>,
          )}
        </InfoField>
        <InfoField label="ZIP code">
          {renderEditableField(
            'zip',
            <p className="font-medium text-fg tabular">{family.zip || emptyValue()}</p>,
          )}
        </InfoField>
      </InfoSection>
    </div>
  )
}

export default function InfoTab() {
  const ctx = useFamilyDetail()
  return <InfoTabContent {...ctx} />
}
