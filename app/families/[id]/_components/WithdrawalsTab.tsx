// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PlusIcon } from '@heroicons/react/24/outline'
import { DataView, EmptyState, Button } from '@/app/components/ui'
import { useFamilyDetail } from '../FamilyDetailContext'

function WithdrawalsTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue, loadMoreLedgerForTab, ledgerHasMore, loadingMoreLedgerTab } = props
  const withdrawals = data.withdrawals || []
  return (
    <div>
                    <div className="flex justify-between mb-4">
                      <h3 className="text-lg font-semibold">Withdrawals</h3>
                      <button
                        onClick={openAddWithdrawal}
                        className="bg-accent text-white px-4 py-2 rounded flex items-center gap-2"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add Withdrawal
                      </button>
                    </div>
                    <DataView
                      tableId="family-withdrawals"
                      rows={withdrawals}
                      globalSearch={{ placeholder: 'Search withdrawals…' }}
                      pageSize={10}
                      columns={[
                        {
                          id: 'date',
                          header: 'Date',
                          headerText: 'Date',
                          cell: (w: any) => (
                            <span className="tabular">
                              {new Date(w.withdrawalDate).toLocaleDateString()}
                            </span>
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
                          cell: (w: any) => (
                            <span className="font-medium tabular text-orange-600">
                              {formatMoney(-Number(w.amount || 0))}
                            </span>
                          ),
                          exportValue: (w: any) => w.amount || 0,
                          filter: { type: 'numberRange', getValue: (w: any) => w.amount || 0 },
                        },
                        {
                          id: 'notes',
                          header: 'Notes',
                          headerText: 'Notes',
                          hideBelow: 'lg',
                          defaultHidden: true,
                          cell: (w: any) => (
                            <span className="text-fg-muted text-sm">{w.notes || '—'}</span>
                          ),
                          exportValue: (w: any) => w.notes || '',
                        },
                        {
                          id: 'actions',
                          header: '',
                          headerText: 'Actions',
                          align: 'right',
                          cell: (w: any) => (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => openEditWithdrawal(w)}
                                className="text-accent hover:underline text-sm"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteWithdrawal(w)}
                                className="text-red-600 hover:underline text-sm"
                              >
                                Delete
                              </button>
                            </div>
                          ),
                        },
                      ]}
                      rowKey={(w: any) => w._id}
                      mobileCard={(w: any) => (
                        <div className="surface-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="font-medium text-fg">{w.reason || 'Withdrawal'}</div>
                            <div className="font-medium tabular text-orange-600">
                              {formatMoney(-Number(w.amount || 0))}
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-fg-muted tabular">
                            {new Date(w.withdrawalDate).toLocaleDateString()}
                          </div>
                          {w.notes && <div className="mt-1 text-xs text-fg-muted">{w.notes}</div>}
                          <div className="mt-3 flex gap-3">
                            <button
                              onClick={() => openEditWithdrawal(w)}
                              className="text-accent text-sm hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteWithdrawal(w)}
                              className="text-red-600 text-sm hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
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
