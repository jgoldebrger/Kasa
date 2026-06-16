// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { DataView, EmptyState, SkeletonRows } from '@/app/components/ui'
import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'
import { buildMemberColumns, computeMemberDisplay, planColorForNumber } from '../_lib/helpers'
import { paymentColumnsFor, paymentMobileCard } from '../_lib/helpers'
import { useFamilyDetail } from '../FamilyDetailContext'

function MembersTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue } = props
  return (
    <div>
                    {viewingMemberId && data.members.find((m: any) => m._id === viewingMemberId) ? (
                      // Member Detail View (Full Screen)
                      (() => {
                        const member = data.members.find((m: any) => m._id === viewingMemberId)
                        if (!member) return null
                        
                        // Calculate Hebrew date if missing
                        let displayHebrewDate = member.hebrewBirthDate
                        if (!displayHebrewDate && member.birthDate) {
                          displayHebrewDate = convertToHebrewDate(new Date(member.birthDate))
                        }
                        
                        // Calculate age
                        let age: number
                        if (displayHebrewDate) {
                          const hebrewAge = calculateHebrewAge(displayHebrewDate)
                          if (hebrewAge !== null) {
                            age = hebrewAge
                          } else {
                            const today = new Date()
                            const birthDate = new Date(member.birthDate)
                            age = today.getFullYear() - birthDate.getFullYear()
                            const monthDiff = today.getMonth() - birthDate.getMonth()
                            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                              age--
                            }
                          }
                        } else {
                          const today = new Date()
                          const birthDate = new Date(member.birthDate)
                          age = today.getFullYear() - birthDate.getFullYear()
                          const monthDiff = today.getMonth() - birthDate.getMonth()
                          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                            age--
                          }
                        }
                        
                        return (
                          <div>
                            <div className="flex justify-between items-center mb-6">
                              <div>
                                <button
                                  onClick={() => {
                                    setViewingMemberId(null)
                                    setMemberActiveTab('info')
                                  }}
                                  className="text-accent hover:text-accent-hover mb-2 flex items-center gap-2"
                                >
                                  ← Back to Members List
                                </button>
                                <h3 className="text-xl font-semibold text-fg">
                                  {member.firstName} {member.lastName} - Details
                                </h3>
                              </div>
                            </div>
                            
                            {/* Member Tabs */}
                            <div className="flex gap-2 mb-6 border-b border-border">
                              <button
                                onClick={() => setMemberActiveTab('info')}
                                className={`px-4 py-2 font-medium transition-colors ${
                                  memberActiveTab === 'info'
                                    ? 'text-accent border-b-2 border-blue-600'
                                    : 'text-fg-muted hover:text-fg'
                                }`}
                              >
                                Info
                              </button>
                              {isAdmin && (
                              <>
                              <button
                                onClick={() => setMemberActiveTab('balance')}
                                className={`px-4 py-2 font-medium transition-colors ${
                                  memberActiveTab === 'balance'
                                    ? 'text-accent border-b-2 border-blue-600'
                                    : 'text-fg-muted hover:text-fg'
                                }`}
                              >
                                Balance
                              </button>
                              <button
                                onClick={() => setMemberActiveTab('payments')}
                                className={`px-4 py-2 font-medium transition-colors ${
                                  memberActiveTab === 'payments'
                                    ? 'text-accent border-b-2 border-blue-600'
                                    : 'text-fg-muted hover:text-fg'
                                }`}
                              >
                                Payments
                              </button>
                              <button
                                onClick={() => setMemberActiveTab('statements')}
                                className={`px-4 py-2 font-medium transition-colors ${
                                  memberActiveTab === 'statements'
                                    ? 'text-accent border-b-2 border-blue-600'
                                    : 'text-fg-muted hover:text-fg'
                                }`}
                              >
                                Statements
                              </button>
                              </>
                              )}
                            </div>
    
                            {memberActiveTab === 'info' && (
                            <div className="space-y-4">
                              {/* Basic Information */}
                              <div className="surface-card rounded-lg p-4 border border-border">
                                <h4 className="text-base font-semibold mb-3 text-fg">Basic Information</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name</label>
                                    {renderEditableMemberField(
                                      'firstName',
                                      <p className="text-base font-semibold text-fg">{member.firstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'name',
                                      member._id,
                                      undefined
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">First Name (Hebrew)</label>
                                    {renderEditableMemberField(
                                      'hebrewFirstName',
                                      <p className="text-base font-semibold text-fg" dir="rtl">{member.hebrewFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'hebrew',
                                      member._id,
                                      undefined
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Last Name</label>
                                    {renderEditableMemberField(
                                      'lastName',
                                      <p className="text-base font-semibold text-fg">{member.lastName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'name',
                                      member._id,
                                      undefined
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Last Name (Hebrew)</label>
                                    {renderEditableMemberField(
                                      'hebrewLastName',
                                      <p className="text-base font-semibold text-fg" dir="rtl">{member.hebrewLastName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'hebrew',
                                      member._id,
                                      undefined
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Gender</label>
                                    {renderEditableMemberField(
                                      'gender',
                                      <p className="text-base font-semibold text-fg capitalize">{member.gender || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'select',
                                      member._id,
                                      [
                                        { value: 'male', label: 'Male' },
                                        { value: 'female', label: 'Female' }
                                      ]
                                    )}
                                  </div>
                                </div>
                              </div>
    
                              {/* Birth Information */}
                              <div className="surface-card rounded-lg p-4 border border-border">
                                <h4 className="text-base font-semibold mb-3 text-fg">Birth Information</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Birth Date</label>
                                    {renderEditableMemberField(
                                      'birthDate',
                                      <p className="text-base font-semibold text-fg">{member.birthDate ? new Date(member.birthDate).toLocaleDateString() : <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'date',
                                      member._id,
                                      undefined
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Hebrew Birth Date (Auto-calculated)</label>
                                    <div className="border border-border rounded px-3 py-2">
                                      <p className="text-base font-semibold text-fg" dir="rtl">{displayHebrewDate || <span className="text-fg-subtle font-normal">Not provided</span>}</p>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Current Age</label>
                                    <div className="border border-border rounded px-3 py-2">
                                      <p className="text-base font-semibold text-fg">{age} years</p>
                                    </div>
                                  </div>
                                  {member.barMitzvahDate && (
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Bar/Bat Mitzvah Date</label>
                                      <div className="border border-border rounded px-3 py-2">
                                        <p className="text-base font-semibold text-fg">{new Date(member.barMitzvahDate).toLocaleDateString()}</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
    
                              {/* Marriage Information - Show if age >= 18 or if fields have values */}
                              {(age >= 18 || member.weddingDate || member.spouseName || member.spouseFirstName || member.email || member.address || member.phone) && (
                                <div className="surface-card rounded-lg p-4 border border-border">
                                  <h4 className="text-base font-semibold mb-3 text-fg">Marriage Information</h4>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Wedding Date</label>
                                      {renderEditableMemberField(
                                        'weddingDate',
                                        <p className="text-base font-semibold text-fg">{member.weddingDate ? new Date(member.weddingDate).toLocaleDateString() : <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'date',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse First Name</label>
                                      {renderEditableMemberField(
                                        'spouseFirstName',
                                        <p className="text-base font-semibold text-fg">{member.spouseFirstName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'name',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Hebrew Name</label>
                                      {renderEditableMemberField(
                                        'spouseHebrewName',
                                        <p className="text-base font-semibold text-fg" dir="rtl">{member.spouseHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'hebrew',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Father's Hebrew Name</label>
                                      {renderEditableMemberField(
                                        'spouseFatherHebrewName',
                                        <p className="text-base font-semibold text-fg" dir="rtl">{member.spouseFatherHebrewName || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'hebrew',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Cell Phone</label>
                                      {renderEditableMemberField(
                                        'spouseCellPhone',
                                        <p className="text-base font-semibold text-fg">{member.spouseCellPhone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'phone',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Phone</label>
                                    {renderEditableMemberField(
                                      'phone',
                                      <p className="text-base font-semibold text-fg">{member.phone || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'phone',
                                      member._id,
                                      undefined
                                    )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Email</label>
                                    {renderEditableMemberField(
                                      'email',
                                      <p className="text-base font-semibold text-fg">{member.email || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                      'email',
                                      member._id,
                                      undefined
                                    )}
                                    </div>
                                    <div className="md:col-span-2">
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Address</label>
                                      {renderEditableMemberField(
                                        'address',
                                        <p className="text-base font-semibold text-fg">{member.address || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'name',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">City</label>
                                      {renderEditableMemberField(
                                        'city',
                                        <p className="text-base font-semibold text-fg">{member.city || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'name',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">State</label>
                                      {renderEditableMemberField(
                                        'state',
                                        <p className="text-base font-semibold text-fg">{member.state || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'name',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    <div>
                                      <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">ZIP Code</label>
                                      {renderEditableMemberField(
                                        'zip',
                                        <p className="text-base font-semibold text-fg">{member.zip || <span className="text-fg-subtle font-normal">Not provided</span>}</p>,
                                        'text',
                                        member._id,
                                        undefined
                                      )}
                                    </div>
                                    {/* Keep spouseName for backward compatibility */}
                                    {member.spouseName && !member.spouseFirstName && (
                                      <div>
                                        <label className="text-xs font-bold text-fg mb-1 block uppercase tracking-wide">Spouse Name (Legacy)</label>
                                      {renderEditableMemberField(
                                        'spouseName',
                                        <p className="text-base font-semibold text-fg">{member.spouseName}</p>,
                                        'name',
                                        member._id,
                                        undefined
                                      )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
    
                              {/* Actions */}
                              {isAdmin && (
                              <div className="flex gap-2 pt-4 border-t border-border">
                                <button
                                  onClick={() => {
                                    setEditingMember(member)
                                    setMemberForm({
                                      firstName: member.firstName,
                                      hebrewFirstName: member.hebrewFirstName || '',
                                      lastName: member.lastName,
                                      hebrewLastName: member.hebrewLastName || '',
                                      birthDate: member.birthDate ? new Date(member.birthDate).toISOString().split('T')[0] : '',
                                      hebrewBirthDate: member.hebrewBirthDate || '',
                                      gender: member.gender || '',
                                      weddingDate: member.weddingDate ? new Date(member.weddingDate).toISOString().split('T')[0] : '',
                                      spouseName: member.spouseName || '',
                                      spouseFirstName: member.spouseFirstName || '',
                                      spouseHebrewName: member.spouseHebrewName || '',
                                      spouseFatherHebrewName: member.spouseFatherHebrewName || '',
                                      spouseCellPhone: member.spouseCellPhone || '',
                                      phone: member.phone || '',
                                      email: member.email || '',
                                      address: member.address || '',
                                      city: member.city || '',
                                      state: member.state || '',
                                      zip: member.zip || ''
                                    })
                                    setShowMemberModal(true)
                                  }}
                                  className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
                                >
                                  Open Full Edit Modal
                                </button>
                                <button
                                  onClick={() => handleDeleteMember(member)}
                                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                                >
                                  Delete Member
                                </button>
                              </div>
                              )}
                            </div>
                            )}
    
                            {memberActiveTab === 'balance' && (
                              <div>
                                {loadingMemberFinancials ? (
                                  <SkeletonRows count={3} />
                                ) : memberBalance ? (
                                  <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                      <div className="surface-card rounded-lg p-6 border border-border">
                                        <p className="text-sm font-medium text-fg-muted mb-1">Plan Cost (Annual)</p>
                                        <p className="text-2xl font-bold text-fg">{formatMoney(memberBalance.planCost)}</p>
                                      </div>
                                      <div className="surface-card rounded-lg p-6 border border-border">
                                        <p className="text-sm font-medium text-fg-muted mb-1">Total Payments</p>
                                        <p className="text-2xl font-bold text-green-600">{formatMoney(memberBalance.totalPayments)}</p>
                                      </div>
                                      <div className={`surface-card rounded-lg p-6 border border-border ${memberBalance.balance >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                                        <p className="text-sm font-medium text-fg-muted mb-1">Current Balance</p>
                                        <p className={`text-2xl font-bold ${memberBalance.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                          {formatMoney(memberBalance.balance)}
                                        </p>
                                      </div>
                                    </div>
                                    {memberBalance.totalLifecyclePayments > 0 && (
                                      <div className="surface-card rounded-lg p-4 border border-border">
                                        <p className="text-sm font-medium text-fg-muted mb-1">Lifecycle Events (Informational)</p>
                                        <p className="text-lg font-semibold text-fg">{formatMoney(memberBalance.totalLifecyclePayments)}</p>
                                        <p className="text-xs text-fg-muted mt-1">Note: Lifecycle events are not included in balance calculation</p>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-center py-12 glass rounded-xl border border-border">
                                    <p className="text-fg-muted">No balance data available</p>
                                  </div>
                                )}
                              </div>
                            )}
    
                            {memberActiveTab === 'payments' && (
                              <div>
                                <div className="flex justify-between mb-4">
                                  <h3 className="text-lg font-semibold">Payments</h3>
                                  <button
                                    onClick={() => {
                                      setPaymentForm({
                                        ...paymentForm,
                                        paymentFor: 'member',
                                        memberId: member._id
                                      })
                                      setShowPaymentModal(true)
                                    }}
                                    className="bg-accent text-white px-4 py-2 rounded flex items-center gap-2"
                                  >
                                    <PlusIcon className="h-4 w-4" />
                                    Add Payment
                                  </button>
                                </div>
                                {loadingMemberFinancials ? (
                                  <SkeletonRows count={5} />
                                ) : (
                                  <DataView
                                    tableId="family-member-payments"
                                    rows={memberPayments}
                                    columns={paymentColumnsFor('member-payment', formatMoney)}
                                    rowKey={(p: any) => p._id}
                                    globalSearch={{ placeholder: 'Search payments…' }}
                                    pageSize={10}
                                    import={{
                                      type: 'payments',
                                      familyId: String(params.id),
                                      memberId: member._id,
                                      onImported: () => fetchFamilyDetails(),
                                    }}
                                    mobileCard={(p) => paymentMobileCard(p, formatMoney)}
                                    empty={
                                      <EmptyState
                                        title="No payments"
                                        description="No payments found for this member."
                                      />
                                    }
                                  />
                                )}
                              </div>
                            )}
    
                            {memberActiveTab === 'statements' && (
                              <div>
                                {loadingMemberFinancials ? (
                                  <SkeletonRows count={4} />
                                ) : memberStatements.length === 0 ? (
                                  <div className="text-center py-12 glass rounded-xl border border-border">
                                    <div className="text-4xl mb-4">📄</div>
                                    <p className="text-fg-muted">No statements found for this member.</p>
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    {memberStatements.map((statement) => (
                                      <div key={statement._id} className="glass rounded-xl p-6 border border-border">
                                        <div className="flex justify-between items-start mb-4">
                                          <div>
                                            <h4 className="font-semibold text-lg">{statement.statementNumber}</h4>
                                            <p className="text-sm text-fg-muted">
                                              {new Date(statement.fromDate).toLocaleDateString()} - {new Date(statement.toDate).toLocaleDateString()}
                                            </p>
                                            <p className="text-xs text-fg-subtle mt-1">
                                              Generated: {new Date(statement.date).toLocaleDateString()}
                                            </p>
                                          </div>
                                          <div className="text-right">
                                            <div className="text-sm text-fg-muted">Closing Balance</div>
                                            <div className="text-xl font-bold">{formatMoney(statement.closingBalance)}</div>
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
                                          <div>
                                            <p className="text-xs text-fg-muted">Opening Balance</p>
                                            <p className="text-sm font-semibold">{formatMoney(statement.openingBalance)}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-fg-muted">Income</p>
                                            <p className="text-sm font-semibold text-green-600">{formatMoney(statement.income)}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-fg-muted">Expenses</p>
                                            <p className="text-sm font-semibold text-red-600">{formatMoney(statement.expenses)}</p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-fg-muted">Closing Balance</p>
                                            <p className="text-sm font-semibold">{formatMoney(statement.closingBalance)}</p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })()
                    ) : (
                      // Members List View
                      <>
                        <div className="flex justify-between mb-6">
                          <div>
                            <h3 className="text-xl font-semibold text-fg mb-1">Family Members (Children)</h3>
                            <p className="text-sm text-fg-muted">Add children to track their ages for payment plan calculations</p>
                          </div>
                          {isAdmin && (
                          <button
                            onClick={openAddMemberModal}
                            className="bg-accent text-accent-fg px-6 py-3 rounded-xl flex items-center gap-2 hover:shadow-lg transition-all duration-200 transform hover:scale-105"
                          >
                            <PlusIcon className="h-5 w-5" />
                            Add Child
                          </button>
                          )}
                        </div>
                        <DataView
                          tableId="family-children"
                          rows={data.members}
                          globalSearch={{ placeholder: 'Search children…' }}
                          pageSize={10}
                          {...(isAdmin
                            ? {
                                import: {
                                  type: 'members' as const,
                                  familyId: String(params.id),
                                  onImported: () => fetchFamilyDetails(),
                                },
                              }
                            : {})}
                          columns={buildMemberColumns({
                            paymentPlans,
                            getPlanName,
                            viewingMemberId,
                            setViewingMemberId,
                            onEdit: handleEditMember,
                            onDelete: handleDeleteMember,
                            canMutate: isAdmin,
                            formatMoney,
                          })}
                          rowKey={(m: any) => m._id}
                          mobileCard={(m: any) => {
                            const info = computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney)
                            return (
                              <div className="surface-card p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <button
                                    onClick={() => setViewingMemberId(viewingMemberId === m._id ? null : m._id)}
                                    className="focus-ring font-medium text-accent hover:underline text-left"
                                  >
                                    {m.firstName} {m.lastName}
                                  </button>
                                  {isAdmin && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleEditMember(m)}
                                      aria-label="Edit"
                                      className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
                                    >
                                      <PencilIcon className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteMember(m)}
                                      aria-label="Delete"
                                      className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                  )}
                                </div>
                                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
                                  <div>
                                    <dt className="text-fg-muted">Age</dt>
                                    <dd className="tabular">{info.age} years</dd>
                                  </div>
                                  <div>
                                    <dt className="text-fg-muted">Born</dt>
                                    <dd className="tabular">{new Date(m.birthDate).toLocaleDateString()}</dd>
                                  </div>
                                  <div className="col-span-2">
                                    <dt className="text-fg-muted">Plan</dt>
                                    <dd>{info.planText || '—'}</dd>
                                  </div>
                                </dl>
                              </div>
                            )
                          }}
                          empty={
                            <EmptyState
                              icon="👶"
                              title="No children added yet"
                              description="Add children to track their ages for payment plan calculations."
                              cta={
                                isAdmin
                                  ? { label: 'Add First Child', onClick: openAddMemberModal }
                                  : undefined
                              }
                            />
                          }
                        />
                      </>
                    )}
                  </div>
  )
}

export default function MembersTab() {
  const ctx = useFamilyDetail()
  return <MembersTabContent {...ctx} />
}
