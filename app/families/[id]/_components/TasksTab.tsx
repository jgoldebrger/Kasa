// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PlusIcon, TrashIcon, ClipboardDocumentListIcon, ClockIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/app/components/ui'
import { useFamilyDetail } from '../FamilyDetailContext'

function TasksTabContent(props: FamilyDetailContextValue) {
  const { params, router, pathname, familyId, activeTab, toast, confirm, isAdmin, roleLoading, formatMoney, data, setData, paymentPlans, lifecycleEventTypes, statements, loading, sendingEmail, emailConfig, showEmailModal, setShowEmailModal, emailFormData, setEmailFormData, familyTasks, loadingFamilyTasks, showTaskModal, setShowTaskModal, subFamilies, loadingSubFamilies, showInfoModal, setShowInfoModal, editingField, editValue, infoForm, setInfoForm, showMemberModal, setShowMemberModal, editingMember, setEditingMember, viewingMemberId, setViewingMemberId, memberActiveTab, setMemberActiveTab, memberBalance, memberPayments, memberStatements, loadingMemberFinancials, showPaymentModal, setShowPaymentModal, useStripe, setUseStripe, showEventModal, setShowEventModal, showWithdrawalModal, setShowWithdrawalModal, editingWithdrawal, setEditingWithdrawal, withdrawalForm, setWithdrawalForm, memberForm, setMemberForm, paymentForm, setPaymentForm, savedPaymentMethods, eventForm, setEventForm, fetchFamilyTasks, fetchFamilyDetails, fetchSubFamilies, fetchSavedPaymentMethods, fetchMemberFinancials, completeFamilyTask, deleteFamilyTask, getPlanNameById, getPlanName, handlePrintStatement, handleSavePDFStatement, handleSendStatementEmail, handleSaveEmailConfig, handlePrintAllStatements, openAddMemberModal, handleFieldEdit, handleFieldSave, handleFieldCancel, renderEditableField, renderEditableMemberField, handleMemberFieldEdit, handleMemberFieldSave, handleMemberFieldCancel, handleAddMember, handleEditMember, handleUpdateMember, handleDeleteMember, handleAddPayment, openAddWithdrawal, openEditWithdrawal, handleSaveWithdrawal, handleDeleteWithdrawal, handleAddEvent, updateEventAmount, getFamilyLastName, setSendingEmail, setEditingField, setEditValue, setEditingMemberField, setEditMemberValue, editingMemberField, editMemberValue } = props
  return (
    <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">Tasks</h3>
                      <button
                        onClick={() => setShowTaskModal(true)}
                        className="bg-accent text-accent-fg px-4 py-2 rounded-lg flex items-center gap-2 hover:shadow-lg transition-all text-sm"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add Task
                      </button>
                    </div>
                    {loadingFamilyTasks ? (
                      <div className="text-center py-12">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
                        <p className="text-fg-muted mt-4">Loading tasks...</p>
                      </div>
                    ) : familyTasks.length === 0 ? (
                      <EmptyState
                        icon={<ClipboardDocumentListIcon />}
                        title="No tasks yet"
                        description="Create a task to track follow-ups or reminders for this family."
                        cta={{
                          label: 'Add Task',
                          onClick: () => setShowTaskModal(true),
                          icon: <PlusIcon className="h-4 w-4" />,
                        }}
                      />
                    ) : (
                      <ul className="space-y-3">
                        {familyTasks.map((task) => {
                          const dueDate = new Date(task.dueDate)
                          const today = new Date()
                          today.setHours(0, 0, 0, 0)
                          const isOverdue = dueDate < today && task.status !== 'completed'
                          const isDueToday = dueDate.toDateString() === today.toDateString()
    
                          const priorityColors: Record<string, string> = {
                            low: 'bg-fg/5 text-fg',
                            medium: 'bg-accent/10 text-accent',
                            high: 'bg-orange-100 text-orange-800',
                            urgent: 'bg-red-100 text-red-800',
                          }
                          const statusColors: Record<string, string> = {
                            pending: 'bg-yellow-100 text-yellow-800',
                            in_progress: 'bg-accent/10 text-accent',
                            completed: 'bg-green-100 text-green-800',
                            cancelled: 'bg-fg/5 text-fg',
                          }
    
                          return (
                            <li
                              key={task._id}
                              className={`glass rounded-xl p-4 border border-border hover:border-white/40 transition-all ${
                                isOverdue ? 'border-red-300 bg-red-50/50' : ''
                              }`}
                            >
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <h4 className="font-semibold text-fg break-words">{task.title}</h4>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${priorityColors[task.priority] || ''}`}>
                                      {task.priority}
                                    </span>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[task.status] || ''}`}>
                                      {String(task.status).replace('_', ' ')}
                                    </span>
                                    {isDueToday && task.status !== 'completed' && (
                                      <span className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800 flex items-center gap-1">
                                        <ClockIcon className="h-3 w-3" aria-hidden="true" />
                                        Due Today
                                      </span>
                                    )}
                                    {isOverdue && (
                                      <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 flex items-center gap-1">
                                        <ExclamationTriangleIcon className="h-3 w-3" aria-hidden="true" />
                                        Overdue
                                      </span>
                                    )}
                                  </div>
                                  {task.description && <p className="text-sm text-fg mb-2">{task.description}</p>}
                                  <div className="flex items-center gap-x-4 gap-y-1 text-xs text-fg-muted flex-wrap">
                                    <span>Due: {dueDate.toLocaleDateString()}</span>
                                    <span>Email: {task.email}</span>
                                    {task.relatedMemberId && (
                                      <span>
                                        Member: {task.relatedMemberId.firstName} {task.relatedMemberId.lastName}
                                      </span>
                                    )}
                                    {task.emailSent && <span className="text-green-700">✓ Email Sent</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 self-end sm:self-start">
                                  {task.status !== 'completed' && (
                                    <button
                                      onClick={() => completeFamilyTask(task._id)}
                                      aria-label={`Mark ${task.title} as completed`}
                                      title="Mark as completed"
                                      className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-green-700 hover:bg-green-50 transition-colors"
                                    >
                                      <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => deleteFamilyTask(task)}
                                    aria-label={`Delete ${task.title}`}
                                    title="Delete task"
                                    className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full text-red-700 hover:bg-red-50 transition-colors"
                                  >
                                    <TrashIcon className="h-5 w-5" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
  )
}

export default function TasksTab() {
  const ctx = useFamilyDetail()
  return <TasksTabContent {...ctx} />
}
