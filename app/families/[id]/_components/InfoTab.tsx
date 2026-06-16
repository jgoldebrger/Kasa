// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PencilIcon } from '@heroicons/react/24/outline'
import { useFamilyDetail } from '../FamilyDetailContext'

function InfoTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue } = props
  return (
    <div>
                    <div className="flex justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-fg">Family Information</h3>
                      </div>
                      {isAdmin && (
                      <button
                        onClick={() => {
                          if (data?.family) {
                            setInfoForm({
                              name: data.family.name || '',
                              hebrewName: data.family.hebrewName || '',
                              weddingDate: data.family.weddingDate ? new Date(data.family.weddingDate).toISOString().split('T')[0] : '',
                              husbandFirstName: data.family.husbandFirstName || '',
                              husbandHebrewName: data.family.husbandHebrewName || '',
                              husbandFatherHebrewName: data.family.husbandFatherHebrewName || '',
                              wifeFirstName: data.family.wifeFirstName || '',
                              wifeHebrewName: data.family.wifeHebrewName || '',
                              wifeFatherHebrewName: data.family.wifeFatherHebrewName || '',
                              husbandCellPhone: data.family.husbandCellPhone || '',
                              wifeCellPhone: data.family.wifeCellPhone || '',
                              address: data.family.address || '',
                              street: data.family.street || '',
                              phone: data.family.phone || '',
                              email: data.family.email || '',
                              city: data.family.city || '',
                              state: data.family.state || '',
                              zip: data.family.zip || '',
                              paymentPlanId: data.family.paymentPlanId?.toString() || ''
                            })
                            setShowInfoModal(true)
                          }
                        }}
                        className="bg-accent text-accent-fg px-4 py-2 rounded-lg flex items-center gap-2 hover:shadow-lg transition-all text-sm"
                      >
                        <PencilIcon className="h-4 w-4" />
                        Edit Info
                      </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {/* Basic Information */}
                      <div className="surface-card rounded-lg p-4 border border-border">
                        <h4 className="text-base font-semibold mb-2 text-fg">Basic Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Family Name</label>
                            {renderEditableField(
                              'name',
                              <p className="text-base font-semibold text-fg">{data.family.name || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'name'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Family Name (Hebrew)</label>
                            {renderEditableField(
                              'hebrewName',
                              <p className="text-base font-semibold text-fg" dir="rtl">{data.family.hebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'hebrew'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Wedding Date</label>
                            {renderEditableField(
                              'weddingDate',
                              <p className="text-base font-semibold text-fg">{data.family.weddingDate ? new Date(data.family.weddingDate).toLocaleDateString() : <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'date'
                            )}
                          </div>
                          {isAdmin && (
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Payment Plan</label>
                            {renderEditableField(
                              'paymentPlanId',
                              <p className="text-base font-semibold text-fg">{getPlanNameById(data.family.paymentPlanId)}</p>,
                              'select',
                              paymentPlans.map(plan => ({ value: plan._id, label: plan.name }))
                            )}
                          </div>
                          )}
                        </div>
                      </div>
    
                      {/* Husband Information */}
                      <div className="surface-card rounded-lg p-4 border border-border">
                        <h4 className="text-base font-semibold mb-2 text-fg">Husband Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name</label>
                            {renderEditableField(
                              'husbandFirstName',
                              <p className="text-base font-semibold text-fg">{data.family.husbandFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'name'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Hebrew Name</label>
                            {renderEditableField(
                              'husbandHebrewName',
                              <p className="text-base font-semibold text-fg" dir="rtl">{data.family.husbandHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'hebrew'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Father's Hebrew Name</label>
                            {renderEditableField(
                              'husbandFatherHebrewName',
                              <p className="text-base font-semibold text-fg" dir="rtl">{data.family.husbandFatherHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'hebrew'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Cell Phone</label>
                            {renderEditableField(
                              'husbandCellPhone',
                              <p className="text-base font-semibold text-fg">{data.family.husbandCellPhone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'phone'
                            )}
                          </div>
                        </div>
                      </div>
    
                      {/* Wife Information */}
                      <div className="surface-card rounded-lg p-4 border border-border">
                        <h4 className="text-base font-semibold mb-2 text-fg">Wife Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name</label>
                            {renderEditableField(
                              'wifeFirstName',
                              <p className="text-base font-semibold text-fg">{data.family.wifeFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'name'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Hebrew Name</label>
                            {renderEditableField(
                              'wifeHebrewName',
                              <p className="text-base font-semibold text-fg" dir="rtl">{data.family.wifeHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'hebrew'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Father's Hebrew Name</label>
                            {renderEditableField(
                              'wifeFatherHebrewName',
                              <p className="text-base font-semibold text-fg" dir="rtl">{data.family.wifeFatherHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'hebrew'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Cell Phone</label>
                            {renderEditableField(
                              'wifeCellPhone',
                              <p className="text-base font-semibold text-fg">{data.family.wifeCellPhone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'phone'
                            )}
                          </div>
                        </div>
                      </div>
    
                      {/* Contact Information */}
                      <div className="surface-card rounded-lg p-4 border border-border">
                        <h4 className="text-base font-semibold mb-2 text-fg">Contact Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Email</label>
                            {renderEditableField(
                              'email',
                              <p className="text-base font-semibold text-fg">{data.family.email || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'email'
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Phone</label>
                            {renderEditableField(
                              'phone',
                              <p className="text-base font-semibold text-fg">{data.family.phone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                              'phone'
                            )}
                          </div>
                          <div className="md:col-span-2">
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Street Address</label>
                            {renderEditableField(
                              'street',
                              <p className="text-base font-semibold text-fg">{data.family.street || data.family.address || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">City</label>
                            {renderEditableField(
                              'city',
                              <p className="text-base font-semibold text-fg">{data.family.city || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">State</label>
                            {renderEditableField(
                              'state',
                              <p className="text-base font-semibold text-fg">{data.family.state || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">ZIP Code</label>
                            {renderEditableField(
                              'zip',
                              <p className="text-base font-semibold text-fg">{data.family.zip || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
  )
}

export default function InfoTab() {
  const ctx = useFamilyDetail()
  return <InfoTabContent {...ctx} />
}
