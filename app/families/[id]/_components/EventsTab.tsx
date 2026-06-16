// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PlusIcon } from '@heroicons/react/24/outline'
import { DataView, EmptyState, Button } from '@/app/components/ui'
import { useFamilyDetail } from '../FamilyDetailContext'

function EventsTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue, loadMoreLedgerForTab, ledgerHasMore, loadingMoreLedgerTab } = props
  const events = data.lifecycleEvents || []
  return (
    <div>
                    <div className="flex justify-between mb-4">
                      <h3 className="text-lg font-semibold">Lifecycle Events</h3>
                      <button
                        onClick={() => setShowEventModal(true)}
                        className="bg-accent text-white px-4 py-2 rounded flex items-center gap-2"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add Event
                      </button>
                    </div>
                    <DataView
                      tableId="family-events"
                      rows={events}
                      globalSearch={{ placeholder: 'Search events…' }}
                      pageSize={10}
                      import={{
                        type: 'lifecycle-events',
                        familyId: String(params.id),
                        onImported: () => fetchFamilyDetails(),
                      }}
                      columns={[
                        {
                          id: 'date',
                          header: 'Date',
                          headerText: 'Date',
                          cell: (e: any) => <span className="tabular">{new Date(e.eventDate).toLocaleDateString()}</span>,
                          exportValue: (e: any) => (e.eventDate ? new Date(e.eventDate) : ''),
                          filter: { type: 'dateRange', getValue: (e: any) => e.eventDate || null },
                        },
                        {
                          id: 'eventType',
                          header: 'Event Type',
                          headerText: 'Event Type',
                          cell: (e: any) => <span className="capitalize text-fg">{e.eventType.replace('_', ' ')}</span>,
                          exportValue: (e: any) => (e.eventType || '').replace('_', ' '),
                          filter: {
                            type: 'multiselect',
                            getValue: (e: any) => e.eventType || '',
                          },
                        },
                        {
                          id: 'amount',
                          header: 'Amount',
                          headerText: 'Amount',
                          align: 'right',
                          cell: (e: any) => <span className="font-medium tabular">{formatMoney(e.amount)}</span>,
                          exportValue: (e: any) => e.amount || 0,
                          filter: { type: 'numberRange', getValue: (e: any) => e.amount || 0 },
                        },
                        {
                          id: 'year',
                          header: 'Year',
                          headerText: 'Year',
                          hideBelow: 'md',
                          cell: (e: any) => <span className="text-fg-muted tabular">{e.year}</span>,
                          exportValue: (e: any) => e.year || '',
                          filter: { type: 'select', getValue: (e: any) => (e.year ? String(e.year) : '') },
                        },
                        {
                          id: 'notes',
                          header: 'Notes',
                          headerText: 'Notes',
                          hideBelow: 'lg',
                          defaultHidden: true,
                          cell: (e: any) => <span className="text-fg-muted text-sm">{e.notes || '—'}</span>,
                          exportValue: (e: any) => e.notes || '',
                        },
                      ]}
                      rowKey={(e: any) => e._id}
                      mobileCard={(e: any) => (
                        <div className="surface-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="capitalize font-medium text-fg">{e.eventType.replace('_', ' ')}</div>
                            <div className="font-medium tabular text-fg">{formatMoney(e.amount)}</div>
                          </div>
                          <div className="mt-2 text-xs text-fg-muted tabular">
                            {new Date(e.eventDate).toLocaleDateString()} · {e.year}
                          </div>
                          {e.notes && <div className="mt-1 text-xs text-fg-muted">{e.notes}</div>}
                        </div>
                      )}
                      empty={
                        <EmptyState title="No events" description="No lifecycle events yet for this family." />
                      }
                    />
                    {ledgerHasMore.events && events.length > 0 && (
                      <div className="mt-4 flex justify-center">
                        <Button
                          variant="secondary"
                          loading={loadingMoreLedgerTab === 'events'}
                          onClick={() => loadMoreLedgerForTab('events')}
                        >
                          Load more
                        </Button>
                      </div>
                    )}
    
                  </div>
  )
}

export default function EventsTab() {
  const ctx = useFamilyDetail()
  return <EventsTabContent {...ctx} />
}
