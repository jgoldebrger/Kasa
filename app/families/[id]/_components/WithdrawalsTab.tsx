// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PlusIcon } from '@heroicons/react/24/outline'
import { DataView, EmptyState, Button, Card } from '@/app/components/ui'
import { FamilyPageHeader, moneyAmountCell } from '@/app/families/_lib'
import { useFamilyDetail } from '../FamilyDetailContext'

function WithdrawalsTabContent(props: FamilyDetailContextValue) {
  const {
    data,
    formatMoney,
    openAddWithdrawal,
    openEditWithdrawal,
    handleDeleteWithdrawal,
    loadMoreLedgerForTab,
    ledgerHasMore,
    loadingMoreLedgerTab,
  } = props
  const withdrawals = data.withdrawals || []

  return (
    <div>
      <FamilyPageHeader
        title="Withdrawals"
        primaryAction={
          <Button
            size="sm"
            leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
            onClick={openAddWithdrawal}
          >
            Add Withdrawal
          </Button>
        }
      />
      <DataView
        tableId="family-withdrawals"
        rows={withdrawals}
        defaultSort={{ id: 'date', dir: 'desc' }}
        globalSearch={{ placeholder: 'Search withdrawals…' }}
        pageSize={10}
        columns={[
          {
            id: 'date',
            header: 'Date',
            headerText: 'Date',
            cell: (w: any) => (
              <span className="tabular">{new Date(w.withdrawalDate).toLocaleDateString()}</span>
            ),
            exportValue: (w: any) => (w.withdrawalDate ? new Date(w.withdrawalDate) : ''),
            filter: { type: 'dateRange', getValue: (w: any) => w.withdrawalDate || null },
          },
          {
            id: 'reason',
            header: 'Reason',
            headerText: 'Reason',
            cell: (w: any) => <span className="text-fg">{w.reason || '—'}</span>,
            exportValue: (w: any) => w.reason || '',
          },
          {
            id: 'amount',
            header: 'Amount',
            headerText: 'Amount',
            align: 'right',
            cell: (w: any) => moneyAmountCell(-Number(w.amount || 0), formatMoney, 'negative'),
            exportValue: (w: any) => w.amount || 0,
            filter: { type: 'numberRange', getValue: (w: any) => w.amount || 0 },
          },
          {
            id: 'notes',
            header: 'Notes',
            headerText: 'Notes',
            hideBelow: 'lg',
            defaultHidden: true,
            cell: (w: any) => <span className="text-sm text-fg-muted">{w.notes || '—'}</span>,
            exportValue: (w: any) => w.notes || '',
          },
          {
            id: 'actions',
            header: '',
            headerText: 'Actions',
            align: 'right',
            cell: (w: any) => (
              <div className="flex justify-end gap-2">
                <Button variant="link" size="sm" onClick={() => openEditWithdrawal(w)}>
                  Edit
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="text-danger"
                  onClick={() => handleDeleteWithdrawal(w)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rowKey={(w: any) => w._id}
        mobileCard={(w: any) => (
          <Card compact>
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-fg">{w.reason || 'Withdrawal'}</div>
              <div className="font-medium tabular text-warning">
                {moneyAmountCell(-Number(w.amount || 0), formatMoney, 'negative')}
              </div>
            </div>
            <div className="mt-2 text-xs text-fg-muted tabular">
              {new Date(w.withdrawalDate).toLocaleDateString()}
            </div>
            {w.notes && <div className="mt-1 text-xs text-fg-muted">{w.notes}</div>}
            <div className="mt-3 flex gap-3">
              <Button variant="link" size="sm" onClick={() => openEditWithdrawal(w)}>
                Edit
              </Button>
              <Button
                variant="link"
                size="sm"
                className="text-danger"
                onClick={() => handleDeleteWithdrawal(w)}
              >
                Delete
              </Button>
            </div>
          </Card>
        )}
        empty={
          <EmptyState
            title="No withdrawals"
            description="No withdrawals recorded for this family yet."
          />
        }
      />
      {ledgerHasMore.withdrawals && withdrawals.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={loadingMoreLedgerTab === 'withdrawals'}
            onClick={() => loadMoreLedgerForTab('withdrawals')}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

export default function WithdrawalsTab() {
  const ctx = useFamilyDetail()
  return <WithdrawalsTabContent {...ctx} />
}
