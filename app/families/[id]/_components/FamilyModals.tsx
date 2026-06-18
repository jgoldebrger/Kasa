// @ts-nocheck
'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import TaskFormModal from '@/app/components/tasks/TaskFormModal'
import { useFamilyDetail } from '../FamilyDetailContext'
import { capitalizeName, formatPhone, handleHebrewInput, validateEmail } from '../_lib/helpers'
import { convertToHebrewDate } from '@/lib/hebrew-date'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { normalizePlanId } from '@/lib/payment-plan-display'
import { Modal } from '@/app/components/ui/Modal'
import { Button, Input, Select, Textarea } from '@/app/components/ui'

const StripePaymentForm = dynamic(() => import('@/app/components/StripePaymentForm'), {
  ssr: false,
  loading: () => (
    <div className="p-4 bg-app-subtle rounded-lg border border-border text-sm text-fg-muted">
      Loading payment form…
    </div>
  ),
})

export default function FamilyModals() {
  const {
    params,
    router,
    pathname,
    familyId,
    activeTab,
    toast,
    confirm,
    isAdmin,
    roleLoading,
    formatMoney,
    data,
    setData,
    paymentPlans,
    lifecycleEventTypes,
    statements,
    loading,
    sendingEmail,
    emailConfig,
    showEmailModal,
    setShowEmailModal,
    emailFormData,
    setEmailFormData,
    familyTasks,
    loadingFamilyTasks,
    showTaskModal,
    setShowTaskModal,
    subFamilies,
    loadingSubFamilies,
    showInfoModal,
    setShowInfoModal,
    editingField,
    editValue,
    infoForm,
    setInfoForm,
    showMemberModal,
    setShowMemberModal,
    editingMember,
    setEditingMember,
    viewingMemberId,
    setViewingMemberId,
    memberActiveTab,
    setMemberActiveTab,
    memberBalance,
    memberPayments,
    memberStatements,
    loadingMemberFinancials,
    showPaymentModal,
    setShowPaymentModal,
    useStripe,
    setUseStripe,
    showEventModal,
    setShowEventModal,
    showWithdrawalModal,
    setShowWithdrawalModal,
    editingWithdrawal,
    setEditingWithdrawal,
    withdrawalForm,
    setWithdrawalForm,
    memberForm,
    setMemberForm,
    paymentForm,
    setPaymentForm,
    savedPaymentMethods,
    eventForm,
    setEventForm,
    fetchFamilyTasks,
    fetchFamilyDetails,
    fetchSubFamilies,
    fetchSavedPaymentMethods,
    fetchMemberFinancials,
    completeFamilyTask,
    deleteFamilyTask,
    getPlanNameById,
    getPlanName,
    handlePrintStatement,
    handleSavePDFStatement,
    handleSendStatementEmail,
    handleSaveEmailConfig,
    handlePrintAllStatements,
    openAddMemberModal,
    handleFieldEdit,
    handleFieldSave,
    handleFieldCancel,
    renderEditableField,
    renderEditableMemberField,
    handleMemberFieldEdit,
    handleMemberFieldSave,
    handleMemberFieldCancel,
    handleAddMember,
    handleEditMember,
    handleUpdateMember,
    handleDeleteMember,
    handleAddPayment,
    openAddWithdrawal,
    openEditWithdrawal,
    handleSaveWithdrawal,
    handleDeleteWithdrawal,
    handleAddEvent,
    updateEventAmount,
    getFamilyLastName,
    setSendingEmail,
    setEditingField,
    setEditValue,
    setEditingMemberField,
    setEditMemberValue,
    editingMemberField,
    editMemberValue,
  } = useFamilyDetail()

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

  const resetMemberForm = () => {
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
      zip: '',
    })
  }

  const closeMemberModal = () => {
    setShowMemberModal(false)
    setEditingMember(null)
    resetMemberForm()
  }

  return (
    <>
      {showMemberModal && isAdmin && (
        <Modal
          open
          title={editingMember ? 'Edit Child' : 'Add Child'}
          description="Add a child to the family"
          onClose={closeMemberModal}
          maxWidth="max-w-md"
        >
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
            className="space-y-4"
          >
            <Input
              label="First Name"
              type="text"
              required
              value={memberForm.firstName}
              onChange={(e) => setMemberForm({ ...memberForm, firstName: e.target.value })}
              onBlur={(e) => {
                if (e.target.value) {
                  setMemberForm({ ...memberForm, firstName: capitalizeName(e.target.value) })
                }
              }}
              placeholder="Enter first name"
            />
            <Input
              label="First Name (Hebrew)"
              type="text"
              required
              dir="rtl"
              lang="he"
              inputMode="text"
              value={memberForm.hebrewFirstName}
              onChange={(e) => setMemberForm({ ...memberForm, hebrewFirstName: e.target.value })}
              onKeyDown={(e) =>
                handleHebrewInput(e, (value) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    hebrewFirstName:
                      typeof value === 'function' ? value(prev.hebrewFirstName) : value,
                  })),
                )
              }
              className="text-right font-hebrew"
              placeholder="שם פרטי בעברית"
              style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
            />
            {editingMember && (
              <Input
                label="Last Name"
                type="text"
                required
                value={memberForm.lastName}
                onChange={(e) => setMemberForm({ ...memberForm, lastName: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value) {
                    setMemberForm({ ...memberForm, lastName: capitalizeName(e.target.value) })
                  }
                }}
                placeholder="Enter last name"
              />
            )}
            {editingMember && (
              <Input
                label="Last Name (Hebrew)"
                type="text"
                required
                dir="rtl"
                lang="he"
                inputMode="text"
                value={memberForm.hebrewLastName}
                onChange={(e) => setMemberForm({ ...memberForm, hebrewLastName: e.target.value })}
                onKeyDown={(e) =>
                  handleHebrewInput(e, (value) =>
                    setMemberForm((prev) => ({
                      ...prev,
                      hebrewLastName:
                        typeof value === 'function' ? value(prev.hebrewLastName) : value,
                    })),
                  )
                }
                className="text-right font-hebrew"
                placeholder="שם משפחה בעברית"
                style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
              />
            )}
            <Input
              label="Birth Date (Gregorian)"
              type="date"
              required
              value={memberForm.birthDate}
              onChange={(e) => {
                const gregorianDate = e.target.value
                if (gregorianDate) {
                  const dateObj = new Date(gregorianDate)
                  const hebrewDate = convertToHebrewDate(dateObj)
                  setMemberForm({
                    ...memberForm,
                    birthDate: gregorianDate,
                    hebrewBirthDate: hebrewDate,
                  })
                } else {
                  setMemberForm({ ...memberForm, birthDate: gregorianDate })
                }
              }}
              hint="Hebrew date will be auto-calculated in the background"
            />
            {editingMember && (
              <Input
                label="Hebrew Birth Date"
                type="text"
                value={memberForm.hebrewBirthDate}
                onChange={(e) => setMemberForm({ ...memberForm, hebrewBirthDate: e.target.value })}
                placeholder="Hebrew birth date"
                hint="Used for Bar/Bat Mitzvah date (13th Hebrew birthday)"
              />
            )}
            <Select
              label="Gender"
              value={memberForm.gender}
              onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value as any })}
              required
            >
              <option value="">Select Gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </Select>
            {editingMember && (
              <div className="border-t border-border pt-4">
                <p className="mb-3 text-sm font-semibold text-fg">
                  Marriage Information (Auto-converts to new family)
                </p>
                <div className="space-y-4">
                  <Input
                    label="Wedding Date"
                    type="date"
                    value={memberForm.weddingDate}
                    onChange={(e) => setMemberForm({ ...memberForm, weddingDate: e.target.value })}
                    hint="When set, this child will be automatically converted to a new family on the wedding date and removed from current family"
                  />
                  <Input
                    label="Spouse Name (Optional)"
                    type="text"
                    value={memberForm.spouseName}
                    onChange={(e) => setMemberForm({ ...memberForm, spouseName: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value) {
                        setMemberForm({
                          ...memberForm,
                          spouseName: capitalizeName(e.target.value),
                        })
                      }
                    }}
                    placeholder="Enter spouse's full name"
                    hint="Spouse will be added as a member of the new family"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={closeMemberModal}>
                Cancel
              </Button>
              <Button type="submit" loading={memberSubmitting}>
                {editingMember ? 'Update Child' : 'Add Child'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showInfoModal && isAdmin && (
        <Modal
          open
          title="Edit Family Information"
          onClose={() => setShowInfoModal(false)}
          maxWidth="max-w-4xl"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (infoSubmitting) return
              setInfoSubmitting(true)
              try {
                const res = await fetch(`/api/families/${params.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...infoForm,
                    weddingDate: infoForm.weddingDate
                      ? new Date(infoForm.weddingDate).toISOString()
                      : undefined,
                    paymentPlanId: infoForm.paymentPlanId || null,
                  }),
                })
                const updated = await res.json().catch(() => null)
                if (res.ok) {
                  if (updated && typeof updated === 'object') {
                    setData((prev) => {
                      if (!prev) return prev
                      const paymentPlanId =
                        updated.paymentPlanId != null
                          ? normalizePlanId(updated.paymentPlanId)
                          : null
                      return {
                        ...prev,
                        family: { ...prev.family, ...updated, paymentPlanId },
                      }
                    })
                  }
                  invalidateCache(/^\/api\/families/)
                  setShowInfoModal(false)
                  fetchFamilyDetails()
                }
              } catch (error) {
                console.error('Error updating family info:', error)
              } finally {
                setInfoSubmitting(false)
              }
            }}
            className="space-y-6"
          >
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
                  <label className="block text-sm font-medium mb-2 text-fg">
                    Family Name (Hebrew)
                  </label>
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
                      <option key={plan._id} value={normalizePlanId(plan._id)}>
                        {plan.name}
                      </option>
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
                    onChange={(e) =>
                      setInfoForm({ ...infoForm, husbandHebrewName: e.target.value })
                    }
                    className="w-full border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none text-right"
                    style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-fg">
                    Father's Hebrew Name
                  </label>
                  <input
                    type="text"
                    dir="rtl"
                    lang="he"
                    value={infoForm.husbandFatherHebrewName}
                    onChange={(e) =>
                      setInfoForm({ ...infoForm, husbandFatherHebrewName: e.target.value })
                    }
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
                  <label className="block text-sm font-medium mb-2 text-fg">
                    Father's Hebrew Name
                  </label>
                  <input
                    type="text"
                    dir="rtl"
                    lang="he"
                    value={infoForm.wifeFatherHebrewName}
                    onChange={(e) =>
                      setInfoForm({ ...infoForm, wifeFatherHebrewName: e.target.value })
                    }
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
                    onChange={(e) =>
                      setInfoForm({
                        ...infoForm,
                        street: e.target.value,
                        address: e.target.value,
                      })
                    }
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

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="secondary" onClick={() => setShowInfoModal(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={infoSubmitting}>
                Save Info
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showPaymentModal && isAdmin && (
        <Modal
          open
          title="Add Payment"
          onClose={() => setShowPaymentModal(false)}
          maxWidth="max-w-md"
        >
          <form
            onSubmit={(e) => guardedSubmit('payment', handleAddPayment, e)}
            className="space-y-4"
          >
            {/* Payment For Selection - Only show if opened from member view, otherwise default to family */}
            {viewingMemberId && memberActiveTab === 'payments' ? (
              <>
                {/* When viewing a member, allow selecting payment for member or family */}
                <div>
                  <label className="block text-sm font-medium mb-1">Payment For *</label>
                  <select
                    value={paymentForm.paymentFor}
                    onChange={(e) =>
                      setPaymentForm({
                        ...paymentForm,
                        paymentFor: e.target.value as 'family' | 'member',
                        memberId: e.target.value === 'family' ? '' : viewingMemberId,
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                    required
                  >
                    <option value="member">
                      Member (Current:{' '}
                      {data?.members?.find((m: any) => m._id === viewingMemberId)?.firstName}{' '}
                      {data?.members?.find((m: any) => m._id === viewingMemberId)?.lastName})
                    </option>
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
                onChange={(e) =>
                  setPaymentForm({
                    ...paymentForm,
                    paymentFrequency: e.target.value as 'one-time' | 'monthly',
                  })
                }
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
                  const selectedMethod = e.target.value as
                    | 'cash'
                    | 'credit_card'
                    | 'check'
                    | 'quick_pay'
                  setPaymentForm({
                    ...paymentForm,
                    paymentMethod: selectedMethod,
                    useSavedCard: false,
                  })
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
                            checked={
                              paymentForm.useSavedCard &&
                              paymentForm.selectedSavedCardId === card._id
                            }
                            onChange={() =>
                              setPaymentForm({
                                ...paymentForm,
                                useSavedCard: true,
                                selectedSavedCardId: card._id,
                              })
                            }
                            className="rounded"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{card.cardType.toUpperCase()}</span>
                              <span>•••• {card.last4}</span>
                              {card.isDefault && (
                                <span className="rounded bg-success/10 px-2 py-1 text-xs text-success">
                                  Default
                                </span>
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
                        onClick={() =>
                          setPaymentForm({
                            ...paymentForm,
                            useSavedCard: false,
                            selectedSavedCardId: '',
                          })
                        }
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
                        memberId={
                          paymentForm.paymentFor === 'member' && paymentForm.memberId
                            ? paymentForm.memberId
                            : undefined
                        }
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
                            notes: '',
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
                            <label className="block text-sm font-medium mb-1">
                              Last 4 Digits *
                            </label>
                            <input
                              type="text"
                              required
                              maxLength={4}
                              value={paymentForm.ccLast4}
                              onChange={(e) =>
                                setPaymentForm({
                                  ...paymentForm,
                                  ccLast4: e.target.value.replace(/\D/g, '').slice(0, 4),
                                })
                              }
                              className="w-full border rounded px-3 py-2"
                              placeholder="1234"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Card Type</label>
                            <select
                              value={paymentForm.ccCardType}
                              onChange={(e) =>
                                setPaymentForm({ ...paymentForm, ccCardType: e.target.value })
                              }
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
                              onChange={(e) =>
                                setPaymentForm({
                                  ...paymentForm,
                                  ccExpiryMonth: e.target.value.replace(/\D/g, '').slice(0, 2),
                                })
                              }
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
                              onChange={(e) =>
                                setPaymentForm({
                                  ...paymentForm,
                                  ccExpiryYear: e.target.value.replace(/\D/g, '').slice(0, 4),
                                })
                              }
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
                            onChange={(e) =>
                              setPaymentForm({ ...paymentForm, ccNameOnCard: e.target.value })
                            }
                            className="w-full border rounded px-3 py-2"
                            placeholder="John Doe"
                          />
                        </div>
                        {paymentForm.amount > 0 && (
                          <label className="flex items-center gap-2 text-sm mt-3">
                            <input
                              type="checkbox"
                              checked={paymentForm.saveCard}
                              onChange={(e) =>
                                setPaymentForm({ ...paymentForm, saveCard: e.target.checked })
                              }
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
                  <div className="mt-3 rounded-lg border border-success/20 bg-success/10 p-4">
                    <p className="mb-2 text-sm text-success">
                      Ready to charge saved card. Click "Add Payment" below to process.
                    </p>
                    {paymentForm.paymentFrequency === 'monthly' && (
                      <p className="text-xs text-success">
                        This will be set up as a monthly recurring payment.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Check Fields */}
            {paymentForm.paymentMethod === 'check' && (
              <div className="space-y-3 rounded-lg border border-success/20 bg-success/10 p-4">
                <h4 className="font-medium text-fg mb-2">Check Information</h4>
                <div>
                  <label className="block text-sm font-medium mb-1">Check Number *</label>
                  <input
                    type="text"
                    required
                    value={paymentForm.checkNumber}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, checkNumber: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                    placeholder="1234"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={paymentForm.checkBankName}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, checkBankName: e.target.value })
                    }
                    className="w-full border rounded px-3 py-2"
                    placeholder="Bank Name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Routing Number</label>
                  <input
                    type="text"
                    value={paymentForm.checkRoutingNumber}
                    onChange={(e) =>
                      setPaymentForm({
                        ...paymentForm,
                        checkRoutingNumber: e.target.value.replace(/\D/g, ''),
                      })
                    }
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
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowPaymentModal(false)
                    setUseStripe(false)
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={modalSubmitting === 'payment'}>
                  Add Payment
                </Button>
              </div>
            )}
          </form>
        </Modal>
      )}

      {showEmailModal && isAdmin && (
        <Modal
          open
          title="Email Configuration"
          description="Configure email settings to send statements via email."
          onClose={() => setShowEmailModal(false)}
          maxWidth="max-w-md"
        >
          <div className="space-y-4">
            <Input
              label="Gmail Address"
              type="email"
              required
              value={emailFormData.email}
              onChange={(e) => setEmailFormData({ ...emailFormData, email: e.target.value })}
              placeholder="your-email@gmail.com"
            />
            <Input
              label="Gmail App Password"
              type="password"
              required
              value={emailFormData.password}
              onChange={(e) => setEmailFormData({ ...emailFormData, password: e.target.value })}
              placeholder="16-character app password"
            />
            <p className="text-xs text-fg-muted">
              Generate an app password from{' '}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Google Account Settings
              </a>
            </p>
            <Input
              label="From Name"
              type="text"
              value={emailFormData.fromName}
              onChange={(e) => setEmailFormData({ ...emailFormData, fromName: e.target.value })}
              placeholder="Kasa Family Management"
            />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowEmailModal(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveEmailConfig}>
                Save & Continue
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showEventModal && isAdmin && (
        <Modal
          open
          title="Add Lifecycle Event"
          onClose={() => setShowEventModal(false)}
          maxWidth="max-w-md"
        >
          <form onSubmit={(e) => guardedSubmit('event', handleAddEvent, e)} className="space-y-4">
            <Select
              label="Event Type"
              value={eventForm.eventType}
              onChange={(e) => updateEventAmount(e.target.value)}
              required
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
            </Select>
            <Input
              label="Amount"
              type="number"
              required
              value={eventForm.amount}
              onChange={(e) =>
                setEventForm({ ...eventForm, amount: parseFloat(e.target.value) || 0 })
              }
            />
            <Input
              label="Event Date"
              type="date"
              required
              value={eventForm.eventDate}
              onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })}
            />
            <Input
              label="Year"
              type="number"
              required
              value={eventForm.year}
              onChange={(e) => setEventForm({ ...eventForm, year: parseInt(e.target.value) })}
            />
            <Textarea
              label="Notes"
              value={eventForm.notes}
              onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
              rows={3}
            />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowEventModal(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={modalSubmitting === 'event'}>
                Add Event
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showWithdrawalModal && isAdmin && (
        <Modal
          open
          title={editingWithdrawal ? 'Edit Withdrawal' : 'Add Withdrawal'}
          onClose={() => {
            setShowWithdrawalModal(false)
            setEditingWithdrawal(null)
          }}
          maxWidth="max-w-md"
        >
          <form
            onSubmit={(e) => guardedSubmit('withdrawal', handleSaveWithdrawal, e)}
            className="space-y-4"
          >
            <Input
              label="Amount"
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
            />
            <Input
              label="Withdrawal Date"
              type="date"
              required
              value={withdrawalForm.withdrawalDate}
              onChange={(e) =>
                setWithdrawalForm({ ...withdrawalForm, withdrawalDate: e.target.value })
              }
            />
            <Input
              label="Reason"
              type="text"
              value={withdrawalForm.reason}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, reason: e.target.value })}
              placeholder="e.g. Refund, Adjustment"
            />
            <Textarea
              label="Notes"
              value={withdrawalForm.notes}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, notes: e.target.value })}
              rows={3}
            />
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowWithdrawalModal(false)
                  setEditingWithdrawal(null)
                }}
              >
                Cancel
              </Button>
              <Button type="submit" loading={modalSubmitting === 'withdrawal'}>
                {editingWithdrawal ? 'Save Changes' : 'Add Withdrawal'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <TaskFormModal
        open={showTaskModal && isAdmin}
        onClose={() => setShowTaskModal(false)}
        defaults={{
          relatedFamilyId:
            typeof params.id === 'string'
              ? params.id
              : Array.isArray(params.id)
                ? params.id[0]
                : '',
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
