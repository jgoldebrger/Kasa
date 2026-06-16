// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { DataView, EmptyState, Button } from '@/app/components/ui'
import { useFamilyDetail } from '../FamilyDetailContext'

function CycleChargesTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue, loadMoreLedgerForTab, ledgerHasMore, loadingMoreLedgerTab } = props
  const cycleCharges = data.cycleCharges || []
  return (
    <div>
                    <div className="flex justify-between mb-4 gap-3 flex-wrap">
                      <div>
                        <h3 className="text-lg font-semibold">Cycle Charges</h3>
                        <p className="text-xs text-fg-muted mt-1 max-w-prose">
                          Annual membership-dues charges captured by the cycle-rollover job on
                          each cycle start. Each row reduces the family balance by one
                          year&rsquo;s plan price; the current in-progress cycle is shown as
                          &ldquo;Plan Cost (Annual)&rdquo; on the Info tab instead.
                        </p>
                      </div>
                    </div>
                    <DataView
                      tableId="family-cycle-charges"
                      rows={cycleCharges}
                      globalSearch={{ placeholder: 'Search charges…' }}
                      pageSize={10}
                      columns={[
                        {
                          id: 'date',
                          header: 'Charge Date',
                          headerText: 'Charge Date',
                          cell: (c: any) => <span className="tabular">{new Date(c.chargeDate).toLocaleDateString()}</span>,
                          exportValue: (c: any) => (c.chargeDate ? new Date(c.chargeDate) : ''),
                          filter: { type: 'dateRange', getValue: (c: any) => c.chargeDate || null },
                        },
                        {
                          id: 'cycleYear',
                          header: 'Cycle Year',
                          headerText: 'Cycle Year',
                          cell: (c: any) => (
                            <span className="tabular text-fg">
                              {c.cycleYear}{' '}
                              <span className="text-xs text-fg-muted">
                                ({c.calendar === 'hebrew' ? 'Hebrew' : 'Gregorian'})
                              </span>
                            </span>
                          ),
                          exportValue: (c: any) => c.cycleYear || '',
                          filter: { type: 'select', getValue: (c: any) => String(c.cycleYear || '') },
                        },
                        {
                          id: 'plan',
                          header: 'Plan',
                          headerText: 'Plan',
                          cell: (c: any) => <span className="text-fg">{c.planName || '—'}</span>,
                          exportValue: (c: any) => c.planName || '',
                          filter: { type: 'multiselect', getValue: (c: any) => c.planName || '' },
                        },
                        {
                          id: 'amount',
                          header: 'Amount',
                          headerText: 'Amount',
                          align: 'right',
                          cell: (c: any) => <span className="font-medium tabular text-orange-600">{formatMoney(-(c.amount || 0))}</span>,
                          exportValue: (c: any) => -(c.amount || 0),
                          filter: { type: 'numberRange', getValue: (c: any) => c.amount || 0 },
                        },
                        {
                          id: 'notes',
                          header: 'Notes',
                          headerText: 'Notes',
                          hideBelow: 'lg',
                          defaultHidden: true,
                          cell: (c: any) => <span className="text-fg-muted text-sm">{c.notes || '—'}</span>,
                          exportValue: (c: any) => c.notes || '',
                        },
                      ]}
                      rowKey={(c: any) => c._id}
                      mobileCard={(c: any) => (
                        <div className="surface-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="font-medium text-fg">Cycle {c.cycleYear}</div>
                            <div className="font-medium tabular text-orange-600">{formatMoney(-(c.amount || 0))}</div>
                          </div>
                          <div className="mt-2 text-xs text-fg-muted tabular">
                            {new Date(c.chargeDate).toLocaleDateString()}
                            {c.planName ? ` · ${c.planName}` : ''}
                            {' · '}{c.calendar === 'hebrew' ? 'Hebrew' : 'Gregorian'}
                          </div>
                          {c.notes && <div className="mt-1 text-xs text-fg-muted">{c.notes}</div>}
                        </div>
                      )}
                      empty={
                        <EmptyState
                          title="No cycle charges yet"
                          description="No annual membership-dues charges have been recorded. The cycle-rollover job writes a row here each time a new membership year starts (Settings → Cycle)."
                        />
                      }
                    />
                    {ledgerHasMore['cycle-charges'] && cycleCharges.length > 0 && (
                      <div className="mt-4 flex justify-center">
                        <Button
                          variant="secondary"
                          loading={loadingMoreLedgerTab === 'cycle-charges'}
                          onClick={() => loadMoreLedgerForTab('cycle-charges')}
                        >
                          Load more
                        </Button>
                      </div>
                    )}
                  </div>
  )
}

export default function CycleChargesTab() {
  const ctx = useFamilyDetail()
  return <CycleChargesTabContent {...ctx} />
}
