// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PlusIcon } from '@heroicons/react/24/outline'
import { DataView, EmptyState, Button } from '@/app/components/ui'
import { paymentColumnsFor, paymentMobileCard } from '../_lib/helpers'
import { useFamilyDetail } from '../FamilyDetailContext'

function PaymentsTabContent(props: FamilyDetailContextValue) {
  const {
    params,
    formatMoney,
    data,
    setShowPaymentModal,
    paymentForm,
    setPaymentForm,
    fetchFamilyDetails,
    loadMoreLedgerForTab,
    ledgerHasMore,
    loadingMoreLedgerTab,
  } = props

  return (
    <div>
      <div className="flex justify-between mb-4">
        <h3 className="text-lg font-semibold text-fg">Payments</h3>
        <Button
          size="sm"
          leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
          onClick={() => {
            setPaymentForm({
              ...paymentForm,
              paymentFor: 'family',
              memberId: '',
            })
            setShowPaymentModal(true)
          }}
        >
          Add Payment
        </Button>
      </div>
      {(() => {
        const familyPayments = data.payments.filter((payment: any) => !payment.memberId)
        return (
          <DataView
            tableId="family-payments"
            rows={familyPayments}
            columns={paymentColumnsFor('family-payment', formatMoney)}
            rowKey={(p: any) => p._id}
            globalSearch={{ placeholder: 'Search payments…' }}
            pageSize={10}
            import={{
              type: 'payments',
              familyId: String(params.id),
              onImported: () => fetchFamilyDetails(),
            }}
            mobileCard={(p) => paymentMobileCard(p, formatMoney)}
            empty={<EmptyState title="No payments" description="No family-level payments yet." />}
          />
        )
      })()}
      {ledgerHasMore.payments &&
        data.payments.filter((payment: any) => !payment.memberId).length > 0 && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              loading={loadingMoreLedgerTab === 'payments'}
              onClick={() => loadMoreLedgerForTab('payments')}
            >
              Load more
            </Button>
          </div>
        )}
    </div>
  )
}

export default function PaymentsTab() {
  const ctx = useFamilyDetail()
  return <PaymentsTabContent {...ctx} />
}
