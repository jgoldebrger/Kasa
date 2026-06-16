// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PrinterIcon, DocumentArrowDownIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import { useFamilyDetail } from '../FamilyDetailContext'

function StatementsTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue } = props
  return (
    <div>
                    <div className="flex justify-between mb-4">
                      <h3 className="text-lg font-semibold">Statements</h3>
                      {statements.length > 0 && (
                        <button
                          onClick={() => handlePrintAllStatements()}
                          className="bg-accent text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-accent-hover"
                        >
                          <PrinterIcon className="h-5 w-5" />
                          Print All Statements
                        </button>
                      )}
                    </div>
                    {statements.length === 0 ? (
                      <div className="text-center py-12 glass rounded-xl border border-border">
                        <div className="text-4xl mb-4">📄</div>
                        <p className="text-fg-muted">No statements found for this family.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {statements.map((statement) => (
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
                            <div className={`grid ${(statement.cycleCharges || 0) > 0 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-4'} gap-4 mt-4 pt-4 border-t border-border`}>
                              <div>
                                <div className="text-xs text-fg-muted">Opening Balance</div>
                                <div className="font-medium">{formatMoney(statement.openingBalance)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-fg-muted">Income</div>
                                <div className="font-medium text-green-600">{formatMoney(statement.income)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-fg-muted">Withdrawals</div>
                                <div className="font-medium text-orange-600">{formatMoney(statement.withdrawals)}</div>
                              </div>
                              {(statement.cycleCharges || 0) > 0 && (
                                <div>
                                  <div className="text-xs text-fg-muted">Annual Dues</div>
                                  <div className="font-medium text-orange-600">{formatMoney(statement.cycleCharges || 0)}</div>
                                </div>
                              )}
                              <div>
                                <div className="text-xs text-fg-muted">Expenses</div>
                                <div className="font-medium text-red-600">{formatMoney(statement.expenses)}</div>
                              </div>
                            </div>
                            <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                              <button
                                onClick={() => handlePrintStatement(statement)}
                                className="text-accent hover:text-accent-hover flex items-center gap-1 text-sm"
                              >
                                <PrinterIcon className="h-4 w-4" />
                                Print
                              </button>
                              <button
                                onClick={() => handleSavePDFStatement(statement)}
                                className="text-green-600 hover:text-green-800 flex items-center gap-1 text-sm"
                              >
                                <DocumentArrowDownIcon className="h-4 w-4" />
                                Save as PDF
                              </button>
                              {data?.family?.email && (
                                <button
                                  onClick={() => handleSendStatementEmail(statement)}
                                  disabled={sendingEmail === statement._id}
                                  className="text-purple-600 hover:text-purple-800 flex items-center gap-1 text-sm disabled:opacity-50"
                                >
                                  <EnvelopeIcon className="h-4 w-4" />
                                  {sendingEmail === statement._id ? 'Sending...' : 'Send Email'}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
  )
}

export default function StatementsTab() {
  const ctx = useFamilyDetail()
  return <StatementsTabContent {...ctx} />
}
