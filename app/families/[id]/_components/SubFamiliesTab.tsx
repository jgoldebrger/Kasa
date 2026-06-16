// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { DataView, EmptyState } from '@/app/components/ui'
import { useFamilyDetail } from '../FamilyDetailContext'

function SubFamiliesTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue } = props
  return (
    <div>
                    <div className="flex justify-between mb-4">
                      <h3 className="text-lg font-semibold">Sub-Families</h3>
                      <p className="text-sm text-fg-muted">
                        Families created from members of this family
                      </p>
                    </div>
                    {loadingSubFamilies ? (
                      <div className="text-center py-12">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
                        <p className="text-fg-muted mt-4">Loading sub-families...</p>
                      </div>
                    ) : (
                      <DataView
                        tableId="family-sub-families"
                        rows={subFamilies}
                        rowKey={(s: any) => s._id}
                        globalSearch={{
                          placeholder: 'Search sub-families…',
                          getValue: (s: any) =>
                            [
                              s.name,
                              s.hebrewName,
                              s.husbandFirstName,
                              s.wifeFirstName,
                              s.email,
                              s.address,
                              s.city,
                              s.state,
                              s.zip,
                            ]
                              .filter(Boolean)
                              .join(' '),
                        }}
                        pageSize={10}
                        columns={[
                          {
                            id: 'name',
                            header: 'Family Name',
                            sortable: true,
                            filter: { type: 'text', getValue: (s: any) => s.name || '' },
                            cell: (s: any) => (
                              <div className="flex flex-col">
                                <a
                                  href={`/families/${s._id}`}
                                  className="font-medium text-accent hover:underline"
                                >
                                  {s.name}
                                </a>
                                {s.hebrewName && (
                                  <span
                                    className="text-xs text-fg-muted"
                                    dir="rtl"
                                    style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                                  >
                                    {s.hebrewName}
                                  </span>
                                )}
                              </div>
                            ),
                            exportValue: (s: any) => s.name || '',
                          },
                          {
                            id: 'weddingDate',
                            header: 'Wedding Date',
                            sortable: true,
                            align: 'right',
                            filter: {
                              type: 'dateRange',
                              getValue: (s: any) => (s.weddingDate ? new Date(s.weddingDate) : null),
                            },
                            cell: (s: any) => (
                              <span className="tabular">
                                {s.weddingDate ? new Date(s.weddingDate).toLocaleDateString() : '—'}
                              </span>
                            ),
                            exportValue: (s: any) =>
                              s.weddingDate ? new Date(s.weddingDate).toLocaleDateString() : '',
                          },
                          {
                            id: 'husband',
                            header: 'Husband',
                            sortable: true,
                            filter: { type: 'text', getValue: (s: any) => s.husbandFirstName || '' },
                            cell: (s: any) => s.husbandFirstName || '—',
                            exportValue: (s: any) => s.husbandFirstName || '',
                          },
                          {
                            id: 'wife',
                            header: 'Wife',
                            sortable: true,
                            filter: { type: 'text', getValue: (s: any) => s.wifeFirstName || '' },
                            cell: (s: any) => s.wifeFirstName || '—',
                            exportValue: (s: any) => s.wifeFirstName || '',
                          },
                          {
                            id: 'email',
                            header: 'Email',
                            sortable: true,
                            filter: { type: 'text', getValue: (s: any) => s.email || '' },
                            cell: (s: any) => s.email || '—',
                            exportValue: (s: any) => s.email || '',
                          },
                          {
                            id: 'address',
                            header: 'Address',
                            filter: {
                              type: 'text',
                              getValue: (s: any) =>
                                [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '),
                            },
                            cell: (s: any) => {
                              const parts = [s.address, s.city, s.state, s.zip].filter(Boolean)
                              return parts.length > 0 ? (
                                <span className="text-sm text-fg-muted">{parts.join(', ')}</span>
                              ) : (
                                <span className="text-fg-muted">—</span>
                              )
                            },
                            exportValue: (s: any) =>
                              [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '),
                          },
                          {
                            id: 'actions',
                            header: '',
                            sortable: false,
                            align: 'right',
                            cell: (s: any) => (
                              <a
                                href={`/families/${s._id}`}
                                className="focus-ring inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-fg/5"
                              >
                                View Details
                              </a>
                            ),
                            exportValue: () => '',
                          },
                        ]}
                        mobileCard={(s: any) => {
                          const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ')
                          return (
                            <div className="surface-card p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <a
                                    href={`/families/${s._id}`}
                                    className="focus-ring font-medium text-accent hover:underline"
                                  >
                                    {s.name}
                                  </a>
                                  {s.hebrewName && (
                                    <div
                                      className="text-xs text-fg-muted"
                                      dir="rtl"
                                      style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                                    >
                                      {s.hebrewName}
                                    </div>
                                  )}
                                </div>
                                <a
                                  href={`/families/${s._id}`}
                                  className="focus-ring inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-fg hover:bg-fg/5"
                                >
                                  View
                                </a>
                              </div>
                              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
                                <div>
                                  <dt className="text-fg-muted">Wedding</dt>
                                  <dd className="tabular">
                                    {s.weddingDate ? new Date(s.weddingDate).toLocaleDateString() : '—'}
                                  </dd>
                                </div>
                                {s.husbandFirstName && (
                                  <div>
                                    <dt className="text-fg-muted">Husband</dt>
                                    <dd>{s.husbandFirstName}</dd>
                                  </div>
                                )}
                                {s.wifeFirstName && (
                                  <div>
                                    <dt className="text-fg-muted">Wife</dt>
                                    <dd>{s.wifeFirstName}</dd>
                                  </div>
                                )}
                                {s.email && (
                                  <div className="col-span-2">
                                    <dt className="text-fg-muted">Email</dt>
                                    <dd className="break-all">{s.email}</dd>
                                  </div>
                                )}
                                {addr && (
                                  <div className="col-span-2">
                                    <dt className="text-fg-muted">Address</dt>
                                    <dd>{addr}</dd>
                                  </div>
                                )}
                              </dl>
                            </div>
                          )
                        }}
                        empty={
                          <EmptyState
                            icon="👨‍👩‍👧‍👦"
                            title="No sub-families found"
                            description="When members of this family get married and are converted to their own families, they will appear here."
                          />
                        }
                      />
                    )}
                  </div>
  )
}

export default function SubFamiliesTab() {
  const ctx = useFamilyDetail()
  return <SubFamiliesTabContent {...ctx} />
}
