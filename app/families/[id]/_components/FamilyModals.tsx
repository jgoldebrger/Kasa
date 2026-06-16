// @ts-nocheck
'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import TaskFormModal from '@/app/components/tasks/TaskFormModal'
import { useFamilyDetail } from '../FamilyDetailContext'
import { capitalizeName, formatPhone, handleHebrewInput, validateEmail } from '../_lib/helpers'
import { convertToHebrewDate } from '@/lib/hebrew-date'
import { Modal } from './Modal'

const StripePaymentForm = dynamic(() => import('@/app/components/StripePaymentForm'), {
  ssr: false,
  loading: () => (
    <div className="p-4 bg-app-subtle rounded-lg border border-border text-sm text-fg-muted">
      Loading payment form…
    </div>
  ),
})

export default function FamilyModals() {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue } = useFamilyDetail()

  const [memberSubmitting, setMemberSubmitting] = useState(false)
  const [infoSubmitting, setInfoSubmitting] = useState(false)
  const [modalSubmitting, setModalSubmitting] = useState(null)

  const guardedSubmit = async (key, handler, e) => {
    if (modalSubmitting) return
    setModalSubmitting(key)
    try {
      await handler(e)
    } finally {
      setModalSubmitting(null)
    }
  }

  return (
    <>
              {showMemberModal && isAdmin && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="surface-card rounded-2xl p-8 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-border">
                    <h2 className="text-2xl font-bold mb-2 text-fg">
                      {editingMember ? 'Edit Child' : 'Add Child'}
                    </h2>
                    <p className="text-sm text-fg-muted mb-6">Add a child to the family</p>
                    <form
                      onSubmit={async (e) => {
                        if (memberSubmitting) return
                        setMemberSubmitting(true)
                        try {
                          await (editingMember ? handleUpdateMember : handleAddMember)(e)
                        } finally {
                          setMemberSubmitting(false)
                        }
                      }}
                      className="space-y-5"
                    >
                      <div>
                        <label className="block text-sm font-medium mb-2 text-fg">First Name *</label>
                        <input
                          type="text"
                          required
                          value={memberForm.firstName}
                          onChange={(e) => setMemberForm({ ...memberForm, firstName: e.target.value })}
                          onBlur={(e) => {
                            if (e.target.value) {
                              setMemberForm({ ...memberForm, firstName: capitalizeName(e.target.value) })
                            }
                          }}
                          className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                          placeholder="Enter first name"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2 text-fg">First Name (Hebrew) *</label>
                        <input
                          type="text"
                          required
                          dir="rtl"
                          lang="he"
                          inputMode="text"
                          value={memberForm.hebrewFirstName}
                          onChange={(e) => setMemberForm({ ...memberForm, hebrewFirstName: e.target.value })}
                          onKeyDown={(e) => handleHebrewInput(e, memberForm.hebrewFirstName, (value) => setMemberForm({ ...memberForm, hebrewFirstName: value }))}
                          className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all text-right font-hebrew"
                          placeholder="שם פרטי בעברית"
                          style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                        />
                      </div>
                      {editingMember && (
                        <div>
                          <label className="block text-sm font-medium mb-2 text-fg">Last Name *</label>
                          <input
                            type="text"
                            required
                            value={memberForm.lastName}
                            onChange={(e) => setMemberForm({ ...memberForm, lastName: e.target.value })}
                            onBlur={(e) => {
                              if (e.target.value) {
                                setMemberForm({ ...memberForm, lastName: capitalizeName(e.target.value) })
                              }
                            }}
                            className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                            placeholder="Enter last name"
                          />
                        </div>
                      )}
                      {editingMember && (
                        <div>
                          <label className="block text-sm font-medium mb-2 text-fg">Last Name (Hebrew) *</label>
                          <input
                            type="text"
                            required
                            dir="rtl"
                            lang="he"
                            inputMode="text"
                            value={memberForm.hebrewLastName}
                            onChange={(e) => setMemberForm({ ...memberForm, hebrewLastName: e.target.value })}
                            onKeyDown={(e) => handleHebrewInput(e, memberForm.hebrewLastName, (value) => setMemberForm({ ...memberForm, hebrewLastName: value }))}
                            className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all text-right font-hebrew"
                            placeholder="שם משפחה בעברית"
                            style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium mb-2 text-fg">Birth Date (Gregorian) *</label>
                        <input
                          type="date"
                          required
                          value={memberForm.birthDate}
                          onChange={(e) => {
                            const gregorianDate = e.target.value
                            // Auto-calculate Hebrew date from Gregorian date (but don't show it in form)
                            if (gregorianDate) {
                              const dateObj = new Date(gregorianDate)
                              const hebrewDate = convertToHebrewDate(dateObj)
                              setMemberForm({ 
                                ...memberForm, 
                                birthDate: gregorianDate,
                                hebrewBirthDate: hebrewDate
                              })
                            } else {
                              setMemberForm({ ...memberForm, birthDate: gregorianDate })
                            }
                          }}
                          className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                        />
                        <p className="text-xs text-fg-muted mt-1">Hebrew date will be auto-calculated in the background</p>
                      </div>
                      {editingMember && (
                        <div>
                          <label className="block text-sm font-medium mb-2 text-fg">Hebrew Birth Date</label>
                          <input
                            type="text"
                            value={memberForm.hebrewBirthDate}
                            onChange={(e) => setMemberForm({ ...memberForm, hebrewBirthDate: e.target.value })}
                            className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                            placeholder="Hebrew birth date"
                          />
                          <p className="text-xs text-fg-muted mt-1">Hebrew date - Used for Bar/Bat Mitzvah date (13th Hebrew birthday)</p>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium mb-2 text-fg">Gender *</label>
                        <select
                          value={memberForm.gender}
                          onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value as any })}
                          className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                          required
                        >
                          <option value="">Select Gender</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </div>
                      {editingMember && (
                        <>
                          <div className="border-t pt-4 mt-4">
                            <p className="text-sm font-semibold text-fg mb-3">Marriage Information (Auto-converts to new family)</p>
                            <div>
                              <label className="block text-sm font-medium mb-2 text-fg">Wedding Date</label>
                              <input
                                type="date"
                                value={memberForm.weddingDate}
                                onChange={(e) => setMemberForm({ ...memberForm, weddingDate: e.target.value })}
                                className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                                placeholder="Select wedding date"
                              />
                              <p className="text-xs text-fg-muted mt-1">When set, this child will be automatically converted to a new family on the wedding date and removed from current family</p>
                            </div>
                            <div className="mt-4">
                              <label className="block text-sm font-medium mb-2 text-fg">Spouse Name (Optional)</label>
                              <input
                                type="text"
                                value={memberForm.spouseName}
                                onChange={(e) => setMemberForm({ ...memberForm, spouseName: e.target.value })}
                                onBlur={(e) => {
                                  if (e.target.value) {
                                    setMemberForm({ ...memberForm, spouseName: capitalizeName(e.target.value) })
                                  }
                                }}
                                className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                                placeholder="Enter spouse's full name"
                              />
                              <p className="text-xs text-fg-muted mt-1">Spouse will be added as a member of the new family</p>
                            </div>
                          </div>
                        </>
                      )}
                      <div className="flex gap-4 justify-end pt-4">
                        <button 
                          type="button" 
                          onClick={() => {
                            setShowMemberModal(false)
                            setEditingMember(null)
                            setMemberForm({
                              firstName: '',
                              hebrewFirstName: '',
                              lastName: '',
                              hebrewLastName: '',
                              birthDate: '',
                              hebrewBirthDate: '',
                              gender: '',
                              weddingDate: '',
                              spouseName: '',
                              spouseFirstName: '',
                              spouseHebrewName: '',
                              spouseFatherHebrewName: '',
                              spouseCellPhone: '',
                              phone: '',
                              email: '',
                              address: '',
                              city: '',
                              state: '',
                              zip: ''
                            })
                          }}
                          className="px-6 py-2 border border-border rounded-xl hover:bg-app-subtle transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          disabled={memberSubmitting}
                          className="px-6 py-2 bg-accent text-accent-fg rounded-xl hover:shadow-lg transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:pointer-events-none disabled:transform-none"
                        >
                          {memberSubmitting ? 'Saving…' : editingMember ? 'Update Child' : 'Add Child'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
      
              {showInfoModal && isAdmin && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="surface-card rounded-2xl p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-border">
                    <h2 className="text-2xl font-bold mb-4 text-fg">Edit Family Information</h2>
                    <form onSubmit={async (e) => {
                      e.preventDefault()
                      if (infoSubmitting) return
                      setInfoSubmitting(true)
                      try {
                        const res = await fetch(`/api/families/${params.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            ...infoForm,
                            weddingDate: infoForm.weddingDate ? new Date(infoForm.weddingDate).toISOString() : undefined,
                            paymentPlanId: infoForm.paymentPlanId || undefined
                          })
                        })
                        if (res.ok) {
                          setShowInfoModal(false)
                          fetchFamilyDetails()
                        }
                      } catch (error) {
                        console.error('Error updating family info:', error)
                      } finally {
                        setInfoSubmitting(false)
                      }
                    }} className="space-y-6">
                      {/* Basic Information */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4 text-fg">Basic Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Family Name *</label>
                            <input
                              type="text"
                              required
                              value={infoForm.name}
                              onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Family Name (Hebrew)</label>
                            <input
                              type="text"
                              dir="rtl"
                              lang="he"
                              value={infoForm.hebrewName}
                              onChange={(e) => setInfoForm({ ...infoForm, hebrewName: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Wedding Date *</label>
                            <input
                              type="date"
                              required
                              value={infoForm.weddingDate}
                              onChange={(e) => setInfoForm({ ...infoForm, weddingDate: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Payment Plan</label>
                            <select
                              value={infoForm.paymentPlanId}
                              onChange={(e) => setInfoForm({ ...infoForm, paymentPlanId: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                            >
                              <option value="">Select a plan</option>
                              {paymentPlans.map((plan: { _id: string; name: string }) => (
                                <option key={plan._id} value={plan._id}>{plan.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
      
                      {/* Husband Information */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4 text-fg">Husband Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">First Name</label>
                            <input
                              type="text"
                              value={infoForm.husbandFirstName}
                              onChange={(e) => setInfoForm({ ...infoForm, husbandFirstName: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Hebrew Name</label>
                            <input
                              type="text"
                              dir="rtl"
                              lang="he"
                              value={infoForm.husbandHebrewName}
                              onChange={(e) => setInfoForm({ ...infoForm, husbandHebrewName: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Father's Hebrew Name</label>
                            <input
                              type="text"
                              dir="rtl"
                              lang="he"
                              value={infoForm.husbandFatherHebrewName}
                              onChange={(e) => setInfoForm({ ...infoForm, husbandFatherHebrewName: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Cell Phone</label>
                            <input
                              type="tel"
                              value={infoForm.husbandCellPhone}
                              onChange={(e) => setInfoForm({ ...infoForm, husbandCellPhone: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                            />
                          </div>
                        </div>
                      </div>
      
                      {/* Wife Information */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4 text-fg">Wife Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">First Name</label>
                            <input
                              type="text"
                              value={infoForm.wifeFirstName}
                              onChange={(e) => setInfoForm({ ...infoForm, wifeFirstName: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Hebrew Name</label>
                            <input
                              type="text"
                              dir="rtl"
                              lang="he"
                              value={infoForm.wifeHebrewName}
                              onChange={(e) => setInfoForm({ ...infoForm, wifeHebrewName: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Father's Hebrew Name</label>
                            <input
                              type="text"
                              dir="rtl"
                              lang="he"
                              value={infoForm.wifeFatherHebrewName}
                              onChange={(e) => setInfoForm({ ...infoForm, wifeFatherHebrewName: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Cell Phone</label>
                            <input
                              type="tel"
                              value={infoForm.wifeCellPhone}
                              onChange={(e) => setInfoForm({ ...infoForm, wifeCellPhone: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                            />
                          </div>
                        </div>
                      </div>
      
                      {/* Contact Information */}
                      <div>
                        <h3 className="text-lg font-semibold mb-4 text-fg">Contact Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium mb-2 text-fg">Email</label>
                            <input
                              type="email"
                              value={infoForm.email}
                              onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                              placeholder="family@example.com"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">Phone</label>
                            <input
                              type="tel"
                              value={infoForm.phone}
                              onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                              placeholder="(555) 123-4567"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">ZIP Code</label>
                            <input
                              type="text"
                              value={infoForm.zip}
                              onChange={(e) => setInfoForm({ ...infoForm, zip: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                              placeholder="12345"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium mb-2 text-fg">Street Address</label>
                            <input
                              type="text"
                              value={infoForm.street || infoForm.address}
                              onChange={(e) => setInfoForm({ ...infoForm, street: e.target.value, address: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                              placeholder="123 Main Street"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">City</label>
                            <input
                              type="text"
                              value={infoForm.city}
                              onChange={(e) => setInfoForm({ ...infoForm, city: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                              placeholder="New York"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2 text-fg">State</label>
                            <input
                              type="text"
                              value={infoForm.state}
                              onChange={(e) => setInfoForm({ ...infoForm, state: e.target.value })}
                              className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                              placeholder="NY"
                            />
                          </div>
                        </div>
                      </div>
      
                      <div className="flex gap-4 justify-end pt-4">
                        <button
                          type="button"
                          onClick={() => setShowInfoModal(false)}
                          className="px-6 py-2 border border-border rounded-xl hover:bg-app-subtle transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={infoSubmitting}
                          className="px-6 py-2 bg-accent text-accent-fg rounded-xl hover:shadow-lg transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:pointer-events-none disabled:transform-none"
                        >
                          {infoSubmitting ? 'Saving…' : 'Save Info'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
      
              {showPaymentModal && isAdmin && (
                <Modal title="Add Payment" onClose={() => setShowPaymentModal(false)}>
                  <form onSubmit={(e) => guardedSubmit('payment', handleAddPayment, e)} className="space-y-4">
                    {/* Payment For Selection - Only show if opened from member view, otherwise default to family */}
                    {viewingMemberId && memberActiveTab === 'payments' ? (
                      <>
                        {/* When viewing a member, allow selecting payment for member or family */}
                        <div>
                          <label className="block text-sm font-medium mb-1">Payment For *</label>
                          <select
                            value={paymentForm.paymentFor}
                            onChange={(e) => setPaymentForm({ 
                              ...paymentForm, 
                              paymentFor: e.target.value as 'family' | 'member',
                              memberId: e.target.value === 'family' ? '' : viewingMemberId
                            })}
                            className="w-full border rounded px-3 py-2"
                            required
                          >
                            <option value="member">Member (Current: {data?.members?.find((m: any) => m._id === viewingMemberId)?.firstName} {data?.members?.find((m: any) => m._id === viewingMemberId)?.lastName})</option>
                            <option value="family">Family</option>
                          </select>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* When on family Payments tab, payment is always for family - hide the selection */}
                        <input type="hidden" value="family" />
                      </>
                    )}
      
                    {/* Member Selection - Show only if paymentFor is 'member' and not viewing a specific member */}
                    {paymentForm.paymentFor === 'member' && !viewingMemberId && (
                      <div>
                        <label className="block text-sm font-medium mb-1">Select Member *</label>
                        <select
                          value={paymentForm.memberId}
                          onChange={(e) => setPaymentForm({ ...paymentForm, memberId: e.target.value })}
                          className="w-full border rounded px-3 py-2"
                          required={paymentForm.paymentFor === 'member'}
                        >
                          <option value="">Select a member...</option>
                          {data?.members?.map((member: any) => (
                            <option key={member._id} value={member._id}>
                              {member.firstName} {member.lastName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
      
                    <div>
                      <label className="block text-sm font-medium mb-1">Amount *</label>
                      <input
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        value={paymentForm.amount || ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setPaymentForm({ ...paymentForm, amount: value ? parseFloat(value) : 0 })
                        }}
                        className="w-full border rounded px-3 py-2"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Payment Date *</label>
                      <input
                        type="date"
                        required
                        value={paymentForm.paymentDate}
                        onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Year *</label>
                      <input
                        type="number"
                        required
                        value={paymentForm.year}
                        onChange={(e) => setPaymentForm({ ...paymentForm, year: parseInt(e.target.value) })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Type</label>
                      <select
                        value={paymentForm.type}
                        onChange={(e) => setPaymentForm({ ...paymentForm, type: e.target.value as any })}
                        className="w-full border rounded px-3 py-2"
                      >
                        <option value="membership">Membership</option>
                        <option value="donation">Donation</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Payment Frequency *</label>
                      <select
                        value={paymentForm.paymentFrequency}
                        onChange={(e) => setPaymentForm({ ...paymentForm, paymentFrequency: e.target.value as 'one-time' | 'monthly' })}
                        className="w-full border rounded px-3 py-2"
                        required
                      >
                        <option value="one-time">One-Time Payment</option>
                        <option value="monthly">Monthly Payment</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Payment Method *</label>
                      <select
                        value={paymentForm.paymentMethod || 'cash'}
                        onChange={(e) => {
                          const selectedMethod = e.target.value as 'cash' | 'credit_card' | 'check' | 'quick_pay'
                          setPaymentForm({ ...paymentForm, paymentMethod: selectedMethod, useSavedCard: false })
                        }}
                        className="w-full border rounded px-3 py-2"
                        required
                      >
                        <option value="cash">Cash</option>
                        <option value="credit_card">Credit Card</option>
                        <option value="check">Check</option>
                        <option value="quick_pay">Quick Pay</option>
                      </select>
                    </div>
      
                    {/* Credit Card Fields */}
                    {paymentForm.paymentMethod === 'credit_card' && (
                      <div className="space-y-3 p-4 bg-accent/10 rounded-lg border border-accent/20">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-fg">Credit Card Information</h4>
                          {paymentForm.amount > 0 && (
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={useStripe}
                                onChange={(e) => {
                                  setUseStripe(e.target.checked)
                                  if (e.target.checked) {
                                    setPaymentForm({ ...paymentForm, useSavedCard: false })
                                  }
                                }}
                                className="rounded"
                              />
                              <span>Use Stripe (Secure Payment)</span>
                            </label>
                          )}
                        </div>
      
                        {/* Saved Cards */}
                        {savedPaymentMethods.length > 0 && !useStripe && (
                          <div className="mb-4">
                            <label className="block text-sm font-medium mb-2">Saved Cards on File</label>
                            <div className="space-y-2">
                              {savedPaymentMethods.map((card) => (
                                <label
                                  key={card._id}
                                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent/10 ${
                                    paymentForm.useSavedCard && paymentForm.selectedSavedCardId === card._id
                                      ? 'bg-accent/20 border-accent'
                                      : 'bg-surface'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="savedCard"
                                    checked={paymentForm.useSavedCard && paymentForm.selectedSavedCardId === card._id}
                                    onChange={() => setPaymentForm({
                                      ...paymentForm,
                                      useSavedCard: true,
                                      selectedSavedCardId: card._id
                                    })}
                                    className="rounded"
                                  />
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{card.cardType.toUpperCase()}</span>
                                      <span>•••• {card.last4}</span>
                                      {card.isDefault && (
                                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-fg-muted">
                                      Expires {card.expiryMonth}/{card.expiryYear}
                                      {card.nameOnCard && ` • ${card.nameOnCard}`}
                                    </div>
                                  </div>
                                </label>
                              ))}
                              <button
                                type="button"
                                onClick={() => setPaymentForm({ ...paymentForm, useSavedCard: false, selectedSavedCardId: '' })}
                                className="text-sm text-accent hover:text-accent-hover"
                              >
                                Use new card instead
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {!paymentForm.useSavedCard && (
                          <>
                        {useStripe ? (
                          <StripePaymentForm
                            amount={paymentForm.amount}
                            familyId={params.id as string}
                            paymentDate={paymentForm.paymentDate}
                            year={paymentForm.year}
                            type={paymentForm.type}
                            notes={paymentForm.notes}
                            saveCard={paymentForm.saveCard}
                            paymentFrequency={paymentForm.paymentFrequency}
                            memberId={paymentForm.paymentFor === 'member' && paymentForm.memberId ? paymentForm.memberId : undefined}
                            onSuccess={async () => {
                              setShowPaymentModal(false)
                              setUseStripe(false)
                              setPaymentForm({
                                amount: 0,
                                paymentDate: new Date().toISOString().split('T')[0],
                                year: new Date().getFullYear(),
                                type: 'membership',
                                paymentMethod: 'cash',
                                paymentFrequency: 'one-time',
                                paymentFor: 'family',
                                memberId: '',
                                saveCard: false,
                                useSavedCard: false,
                                selectedSavedCardId: '',
                                ccLast4: '',
                                ccCardType: '',
                                ccExpiryMonth: '',
                                ccExpiryYear: '',
                                ccNameOnCard: '',
                                checkNumber: '',
                                checkBankName: '',
                                checkRoutingNumber: '',
                                notes: ''
                              })
                              fetchFamilyDetails()
                              fetchSavedPaymentMethods()
                            }}
                            onError={(error) => {
                              toast.error(`Payment error: ${error}`)
                            }}
                          />
                        ) : (
                          <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium mb-1">Last 4 Digits *</label>
                            <input
                              type="text"
                              required
                              maxLength={4}
                              value={paymentForm.ccLast4}
                              onChange={(e) => setPaymentForm({ ...paymentForm, ccLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                              className="w-full border rounded px-3 py-2"
                              placeholder="1234"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Card Type</label>
                            <select
                              value={paymentForm.ccCardType}
                              onChange={(e) => setPaymentForm({ ...paymentForm, ccCardType: e.target.value })}
                              className="w-full border rounded px-3 py-2"
                            >
                              <option value="">Select...</option>
                              <option value="Visa">Visa</option>
                              <option value="Mastercard">Mastercard</option>
                              <option value="American Express">American Express</option>
                              <option value="Discover">Discover</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Expiry Month</label>
                            <input
                              type="text"
                              maxLength={2}
                              value={paymentForm.ccExpiryMonth}
                              onChange={(e) => setPaymentForm({ ...paymentForm, ccExpiryMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                              className="w-full border rounded px-3 py-2"
                              placeholder="MM"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Expiry Year</label>
                            <input
                              type="text"
                              maxLength={4}
                              value={paymentForm.ccExpiryYear}
                              onChange={(e) => setPaymentForm({ ...paymentForm, ccExpiryYear: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                              className="w-full border rounded px-3 py-2"
                              placeholder="YYYY"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Name on Card</label>
                          <input
                            type="text"
                            value={paymentForm.ccNameOnCard}
                            onChange={(e) => setPaymentForm({ ...paymentForm, ccNameOnCard: e.target.value })}
                            className="w-full border rounded px-3 py-2"
                            placeholder="John Doe"
                          />
                        </div>
                            {paymentForm.amount > 0 && (
                              <label className="flex items-center gap-2 text-sm mt-3">
                                <input
                                  type="checkbox"
                                  checked={paymentForm.saveCard}
                                  onChange={(e) => setPaymentForm({ ...paymentForm, saveCard: e.target.checked })}
                                  className="rounded"
                                />
                                <span>Save card for future use</span>
                              </label>
                            )}
                          </>
                        )}
                          </>
                        )}
                        {paymentForm.useSavedCard && paymentForm.selectedSavedCardId && (
                          <div className="p-4 bg-green-50 border border-green-200 rounded-lg mt-3">
                            <p className="text-sm text-green-800 mb-2">
                              Ready to charge saved card. Click "Add Payment" below to process.
                            </p>
                            {paymentForm.paymentFrequency === 'monthly' && (
                              <p className="text-xs text-green-700">
                                This will be set up as a monthly recurring payment.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
      
                    {/* Check Fields */}
                    {paymentForm.paymentMethod === 'check' && (
                      <div className="space-y-3 p-4 bg-green-50 rounded-lg border border-green-200">
                        <h4 className="font-medium text-fg mb-2">Check Information</h4>
                        <div>
                          <label className="block text-sm font-medium mb-1">Check Number *</label>
                          <input
                            type="text"
                            required
                            value={paymentForm.checkNumber}
                            onChange={(e) => setPaymentForm({ ...paymentForm, checkNumber: e.target.value })}
                            className="w-full border rounded px-3 py-2"
                            placeholder="1234"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Bank Name</label>
                          <input
                            type="text"
                            value={paymentForm.checkBankName}
                            onChange={(e) => setPaymentForm({ ...paymentForm, checkBankName: e.target.value })}
                            className="w-full border rounded px-3 py-2"
                            placeholder="Bank Name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Routing Number</label>
                          <input
                            type="text"
                            value={paymentForm.checkRoutingNumber}
                            onChange={(e) => setPaymentForm({ ...paymentForm, checkRoutingNumber: e.target.value.replace(/\D/g, '') })}
                            className="w-full border rounded px-3 py-2"
                            placeholder="9-digit routing number"
                            maxLength={9}
                          />
                        </div>
                      </div>
                    )}
      
                    <div>
                      <label className="block text-sm font-medium mb-1">Notes</label>
                      <textarea
                        value={paymentForm.notes}
                        onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                        rows={3}
                      />
                    </div>
                    {!(paymentForm.paymentMethod === 'credit_card' && useStripe) && (
                      <div className="flex gap-4 justify-end">
                        <button type="button" onClick={() => {
                          setShowPaymentModal(false)
                          setUseStripe(false)
                        }} className="px-4 py-2 border rounded">
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={modalSubmitting === 'payment'}
                          className="px-4 py-2 bg-accent text-white rounded disabled:opacity-50"
                        >
                          {modalSubmitting === 'payment' ? 'Saving…' : 'Add Payment'}
                        </button>
                      </div>
                    )}
                  </form>
                </Modal>
              )}
      
              {showEmailModal && isAdmin && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-surface rounded-lg p-6 max-w-md w-full">
                    <h2 className="text-xl font-bold mb-4">Email Configuration</h2>
                    <p className="text-sm text-fg-muted mb-4">
                      Configure email settings to send statements via email.
                    </p>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">Gmail Address *</label>
                        <input
                          type="email"
                          required
                          value={emailFormData.email}
                          onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
                          placeholder="your-email@gmail.com"
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Gmail App Password *</label>
                        <input
                          type="password"
                          required
                          value={emailFormData.password}
                          onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
                          placeholder="16-character app password"
                          className="w-full border rounded px-3 py-2"
                        />
                        <p className="text-xs text-fg-muted mt-1">
                          Generate an app password from{' '}
                          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-accent underline">
                            Google Account Settings
                          </a>
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">From Name</label>
                        <input
                          type="text"
                          value={emailFormData.fromName}
                          onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
                          placeholder="Kasa Family Management"
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                      <div className="flex gap-4 justify-end">
                        <button
                          type="button"
                          onClick={() => setShowEmailModal(false)}
                          className="px-4 py-2 border rounded"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEmailConfig}
                          className="px-4 py-2 bg-purple-600 text-white rounded"
                        >
                          Save & Continue
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
      
              {showEventModal && isAdmin && (
                <Modal title="Add Lifecycle Event" onClose={() => setShowEventModal(false)}>
                  <form onSubmit={(e) => guardedSubmit('event', handleAddEvent, e)} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Event Type *</label>
                      <select
                        value={eventForm.eventType}
                        onChange={(e) => updateEventAmount(e.target.value)}
                        className="w-full border rounded px-3 py-2"
                      >
                        {lifecycleEventTypes.length === 0 ? (
                          <option value="">Loading event types...</option>
                        ) : (
                          lifecycleEventTypes.map((eventType) => (
                            <option key={eventType._id} value={eventType.type}>
                              {eventType.name} - {formatMoney(eventType.amount)}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Amount *</label>
                      <input
                        type="number"
                        required
                        value={eventForm.amount}
                        onChange={(e) => setEventForm({ ...eventForm, amount: parseFloat(e.target.value) || 0 })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Event Date *</label>
                      <input
                        type="date"
                        required
                        value={eventForm.eventDate}
                        onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Year *</label>
                      <input
                        type="number"
                        required
                        value={eventForm.year}
                        onChange={(e) => setEventForm({ ...eventForm, year: parseInt(e.target.value) })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Notes</label>
                      <textarea
                        value={eventForm.notes}
                        onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-4 justify-end">
                      <button type="button" onClick={() => setShowEventModal(false)} className="px-4 py-2 border rounded">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={modalSubmitting === 'event'}
                        className="px-4 py-2 bg-accent text-white rounded disabled:opacity-50"
                      >
                        {modalSubmitting === 'event' ? 'Saving…' : 'Add Event'}
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
      
              {showWithdrawalModal && isAdmin && (
                <Modal
                  title={editingWithdrawal ? 'Edit Withdrawal' : 'Add Withdrawal'}
                  onClose={() => {
                    setShowWithdrawalModal(false)
                    setEditingWithdrawal(null)
                  }}
                >
                  <form onSubmit={(e) => guardedSubmit('withdrawal', handleSaveWithdrawal, e)} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Amount *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={withdrawalForm.amount}
                        onChange={(e) =>
                          setWithdrawalForm({
                            ...withdrawalForm,
                            amount: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Withdrawal Date *</label>
                      <input
                        type="date"
                        required
                        value={withdrawalForm.withdrawalDate}
                        onChange={(e) =>
                          setWithdrawalForm({ ...withdrawalForm, withdrawalDate: e.target.value })
                        }
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Reason</label>
                      <input
                        type="text"
                        value={withdrawalForm.reason}
                        onChange={(e) =>
                          setWithdrawalForm({ ...withdrawalForm, reason: e.target.value })
                        }
                        className="w-full border rounded px-3 py-2"
                        placeholder="e.g. Refund, Adjustment"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Notes</label>
                      <textarea
                        value={withdrawalForm.notes}
                        onChange={(e) =>
                          setWithdrawalForm({ ...withdrawalForm, notes: e.target.value })
                        }
                        className="w-full border rounded px-3 py-2"
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-4 justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setShowWithdrawalModal(false)
                          setEditingWithdrawal(null)
                        }}
                        className="px-4 py-2 border rounded"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={modalSubmitting === 'withdrawal'}
                        className="px-4 py-2 bg-accent text-white rounded disabled:opacity-50"
                      >
                        {modalSubmitting === 'withdrawal' ? 'Saving…' : editingWithdrawal ? 'Save Changes' : 'Add Withdrawal'}
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
      
              <TaskFormModal
                open={showTaskModal && isAdmin}
                onClose={() => setShowTaskModal(false)}
                defaults={{
                  relatedFamilyId: typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '',
                  email: data?.family?.email || '',
                }}
                lockFamily
                onCreated={() => {
                  if (activeTab === 'tasks') fetchFamilyTasks()
                }}
              />
    </>
  )
}
