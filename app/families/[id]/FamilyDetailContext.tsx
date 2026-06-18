'use client'

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  useMemo,
} from 'react'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { PencilIcon } from '@heroicons/react/24/outline'
import { convertToHebrewDate } from '@/lib/hebrew-date'
import { useToast, useConfirm } from '@/app/components/Toast'
import { useOrgRole } from '@/lib/client/useOrgRole'
import { useCurrency } from '@/lib/client/useCurrency'
import {
  ADMIN_ONLY_FAMILY_TABS,
  familyTabFromPathname,
  familyTabHref,
  FAMILY_TAB_SEGMENTS,
  type FamilyTabId,
} from './_lib/constants'
import {
  handleHebrewInput,
  capitalizeName,
  formatPhone,
  validateEmail,
  type FamilyDetails,
} from './_lib/helpers'
import { LEDGER_TABS, useFamilyLedger } from './_lib/useFamilyLedger'
import { useFamilyDeferredData } from './_lib/useFamilyDeferredData'
import { useFamilyStatements } from './_lib/useFamilyStatements'
import { useFamilyMemberActions } from './_lib/useFamilyMemberActions'
import { useFamilyPaymentActions } from './_lib/useFamilyPaymentActions'

export type FamilyDetailContextValue = Record<string, any>

const FamilyDetailContext = createContext<FamilyDetailContextValue | null>(null)

export function useFamilyDetail(): FamilyDetailContextValue {
  const ctx = useContext(FamilyDetailContext)
  if (!ctx) throw new Error('useFamilyDetail must be used within FamilyDetailProvider')
  return ctx
}

export interface FamilyDetailProviderProps {
  children: React.ReactNode
  initialSummary?: FamilyDetails | null
}

export function FamilyDetailProvider({
  children,
  initialSummary = null,
}: FamilyDetailProviderProps) {
  const params = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const familyId =
    typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : ''
  const activeTab: FamilyTabId = familyTabFromPathname(pathname, familyId)

  const toast = useToast()
  const confirm = useConfirm()
  const { isAdmin, loading: roleLoading } = useOrgRole()
  const { format: formatMoney } = useCurrency()

  const [data, setData] = useState<FamilyDetails | null>(initialSummary)
  const [loading, setLoading] = useState(!initialSummary)
  const hydratedFamilyIdRef = useRef<string | null>(
    initialSummary?.family?._id ? String(initialSummary.family._id) : null,
  )

  const [showInfoModal, setShowInfoModal] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [infoForm, setInfoForm] = useState({
    name: '',
    hebrewName: '',
    weddingDate: '',
    husbandFirstName: '',
    husbandHebrewName: '',
    husbandFatherHebrewName: '',
    wifeFirstName: '',
    wifeHebrewName: '',
    wifeFatherHebrewName: '',
    husbandCellPhone: '',
    wifeCellPhone: '',
    address: '',
    street: '',
    phone: '',
    email: '',
    city: '',
    state: '',
    zip: '',
    paymentPlanId: '',
  })

  const {
    begin: beginFamilyFetch,
    invalidate: invalidateFamilyFetch,
    isStale: isFamilyFetchStale,
    current: currentFamilyFetchGen,
  } = useRequestGeneration()

  const ledger = useFamilyLedger({
    familyId,
    isAdmin,
    data,
    setData,
    isFamilyFetchStale,
    currentFamilyFetchGen,
    toast,
  })

  const deferred = useFamilyDeferredData({
    familyId,
    isFamilyFetchStale,
    beginFamilyFetch,
    toast,
    confirm,
  })
  const { setShowTaskModal, fetchFamilyTasks } = deferred

  const fetchFamilyDetails = useCallback(
    async (sharedGen?: number) => {
      const gen = sharedGen ?? beginFamilyFetch()
      if (!familyId) {
        if (!isFamilyFetchStale(gen)) setLoading(false)
        return
      }
      try {
        const res = await fetch(`/api/families/${familyId}?view=summary`)
        if (isFamilyFetchStale(gen)) return
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          console.error('Error fetching family:', err.error || res.status)
          toast.error(err.error || 'Failed to load family details.')
          setData(null)
          setLoading(false)
          return
        }
        const familyData = await res.json().catch(() => ({}))
        if (isFamilyFetchStale(gen)) return

        if (familyData.error || !familyData.family) {
          console.error('Error fetching family:', familyData.error || 'Family not found')
          toast.error(familyData.error || 'Family not found.')
          setData(null)
          setLoading(false)
          return
        }

        if (familyData.members) {
          familyData.members = familyData.members.map((member: any) => {
            if (!member.hebrewBirthDate && member.birthDate) {
              try {
                const hebrewDate = convertToHebrewDate(new Date(member.birthDate))
                if (hebrewDate) {
                  return { ...member, hebrewBirthDate: hebrewDate }
                }
              } catch (e) {
                console.error('Error calculating Hebrew date:', e)
              }
            }
            return member
          })
        }

        if (isFamilyFetchStale(gen)) return
        setData((prev) => ({
          ...familyData,
          payments: prev?.payments ?? [],
          withdrawals: prev?.withdrawals ?? [],
          lifecycleEvents: prev?.lifecycleEvents ?? [],
          cycleCharges: prev?.cycleCharges ?? [],
        }))
      } catch (error) {
        console.error('Error fetching family details:', error)
      } finally {
        if (!isFamilyFetchStale(gen)) setLoading(false)
      }
    },
    [familyId, beginFamilyFetch, isFamilyFetchStale, toast],
  )

  const refreshFamily = useCallback(
    async (sharedGen?: number) => {
      const gen = sharedGen ?? beginFamilyFetch()
      await fetchFamilyDetails(gen)
      await ledger.refreshLedgerTab(activeTab, gen)
    },
    [beginFamilyFetch, fetchFamilyDetails, activeTab, ledger],
  )

  const members = useFamilyMemberActions({
    familyId,
    isAdmin,
    activeTab,
    data,
    refreshFamily,
    toast,
    confirm,
  })
  const { memberActiveTab, setMemberActiveTab } = members

  const statements = useFamilyStatements({
    familyId,
    data,
    formatMoney,
    emailConfig: deferred.emailConfig,
    setEmailConfig: deferred.setEmailConfig,
    emailFormData: deferred.emailFormData,
    setEmailFormData: deferred.setEmailFormData,
    isFamilyFetchStale,
    beginFamilyFetch,
    toast,
  })

  const payments = useFamilyPaymentActions({
    familyId,
    isAdmin,
    formatMoney,
    lifecycleEventTypes: deferred.lifecycleEventTypes,
    refreshFamily,
    fetchMemberFinancials: members.fetchMemberFinancials,
    viewingMemberId: members.viewingMemberId,
    memberActiveTab: members.memberActiveTab,
    toast,
    confirm,
  })

  // Legacy ?tab= deep links → nested routes
  useEffect(() => {
    const tab = searchParams.get('tab') as FamilyTabId | null
    if (!tab || !(tab in FAMILY_TAB_SEGMENTS)) return
    const add = searchParams.get('add')
    const href = familyTabHref(familyId, tab) + (add ? `?add=${add}` : '')
    router.replace(href)
  }, [searchParams, familyId, router])

  // tasks ?add=true deep link
  useEffect(() => {
    if (activeTab === 'tasks' && searchParams.get('add') === 'true') {
      setShowTaskModal(true)
      router.replace(familyTabHref(familyId, 'tasks'))
    }
  }, [activeTab, searchParams, familyId, router, setShowTaskModal])

  useEffect(() => {
    if (roleLoading) return
    const gen = beginFamilyFetch()
    if (!params.id) return

    if (hydratedFamilyIdRef.current === params.id) {
      hydratedFamilyIdRef.current = null
      if (isAdmin) {
        void deferred.ensurePaymentPlans()
        if (LEDGER_TABS.has(activeTab)) {
          ledger.loadedLedgerTabsRef.current.add(activeTab)
          void ledger.fetchLedgerForTab(activeTab, gen)
        }
      }
      return
    }

    ledger.resetLedger()
    setLoading(true)
    void fetchFamilyDetails(gen)
    return () => {
      invalidateFamilyFetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, roleLoading, beginFamilyFetch, invalidateFamilyFetch])

  useEffect(() => {
    if (roleLoading || !isAdmin || !params.id || !data?.family) return
    if (activeTab === 'statements') void statements.fetchStatements()
    else if (activeTab === 'sub-families') void deferred.fetchSubFamilies()
    else if (activeTab === 'tasks') void deferred.fetchFamilyTasks()
    else if (['info', 'members'].includes(activeTab)) void deferred.ensurePaymentPlans()
    else if (LEDGER_TABS.has(activeTab) && !ledger.loadedLedgerTabsRef.current.has(activeTab)) {
      ledger.loadedLedgerTabsRef.current.add(activeTab)
      void ledger.fetchLedgerForTab(activeTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, roleLoading, isAdmin, params.id, data?.family])

  useEffect(() => {
    if (!isAdmin || !payments.showEventModal || deferred.lifecycleEventTypes.length > 0) return
    void deferred.fetchLifecycleEventTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments.showEventModal, isAdmin, deferred.lifecycleEventTypes.length])

  useEffect(() => {
    if (!isAdmin) return
    if (
      (activeTab === 'statements' || statements.showEmailModal) &&
      deferred.emailConfig === null
    ) {
      void deferred.fetchEmailConfig()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, statements.showEmailModal, isAdmin, deferred.emailConfig])

  useEffect(() => {
    if (activeTab === 'tasks' && params.id) {
      void fetchFamilyTasks()
    }
  }, [activeTab, params.id, fetchFamilyTasks])

  useEffect(() => {
    if (roleLoading) return
    if (!isAdmin && ADMIN_ONLY_FAMILY_TABS.has(activeTab)) {
      router.replace(familyTabHref(familyId, 'info'))
    }
    if (!isAdmin && memberActiveTab !== 'info') {
      setMemberActiveTab('info')
    }
  }, [isAdmin, roleLoading, activeTab, memberActiveTab, familyId, router, setMemberActiveTab])

  const handleFieldEdit = (fieldName: string, currentValue: unknown) => {
    if (fieldName === 'weddingDate' && currentValue) {
      const date = new Date(currentValue as string | Date)
      setEditValue(Number.isFinite(date.getTime()) ? date.toISOString().split('T')[0] : '')
    } else if (fieldName === 'paymentPlanId') {
      setEditValue(currentValue != null && currentValue !== '' ? String(currentValue) : '')
    } else {
      setEditValue(currentValue != null ? String(currentValue) : '')
    }
    setEditingField(fieldName)
  }

  const handleFieldSave = async (fieldName: string) => {
    try {
      const updateData: any = {}
      let finalValue = editValue || ''

      const phoneFields = ['phone', 'husbandCellPhone', 'wifeCellPhone']
      const emailFields = ['email']
      const nameFields = ['name', 'firstName', 'lastName', 'husbandFirstName', 'wifeFirstName']

      if (phoneFields.includes(fieldName)) {
        finalValue = formatPhone(finalValue)
      } else if (emailFields.includes(fieldName)) {
        if (finalValue && !validateEmail(finalValue)) {
          toast.error('Please enter a valid email address')
          return
        }
      } else if (nameFields.includes(fieldName)) {
        finalValue = capitalizeName(finalValue)
      }

      if (fieldName === 'weddingDate' && finalValue) {
        updateData[fieldName] = new Date(finalValue)
      } else if (fieldName === 'paymentPlanId') {
        updateData[fieldName] = finalValue || null
      } else if (fieldName === 'street') {
        updateData.street = finalValue || ''
        updateData.address = finalValue || ''
      } else {
        updateData[fieldName] = finalValue || ''
      }

      const res = await fetch(`/api/families/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (res.ok) {
        setEditingField(null)
        setEditValue('')
        void refreshFamily()
      } else {
        const errorData = await res.json().catch(() => ({}))
        toast.error(`Error updating field: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error updating field:', error)
      toast.error('Error updating field. Please try again.')
    }
  }

  const handleFieldCancel = () => {
    setEditingField(null)
    setEditValue('')
  }

  const renderEditableField = (
    fieldName: string,
    displayValue: string | React.ReactNode,
    fieldType: 'text' | 'date' | 'select' | 'hebrew' | 'phone' | 'email' | 'name' = 'text',
    options?: { value: string; label: string }[],
  ) => {
    if (!isAdmin) {
      return <div className="flex-1 min-w-0">{displayValue}</div>
    }

    const isEditing = editingField === fieldName
    const rawValue = data?.family?.[fieldName as keyof typeof data.family]
    const currentValue =
      fieldName === 'street'
        ? data?.family?.street || data?.family?.address || ''
        : (rawValue ?? '')

    const inputClassName =
      'focus-ring w-full min-w-0 rounded-md border border-accent/40 bg-surface px-3 py-2 text-sm text-fg'

    const getInputProps = () => {
      if (fieldType === 'phone') {
        return {
          type: 'tel' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditValue(formatPhone(e.target.value))
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
          },
          placeholder: '(555) 555-5555',
          inputMode: 'tel' as const,
        }
      } else if (fieldType === 'email') {
        return {
          type: 'email' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              if (validateEmail(editValue)) {
                handleFieldSave(fieldName)
              } else {
                toast.error('Please enter a valid email address')
              }
            }
            if (e.key === 'Escape') handleFieldCancel()
          },
          onBlur: () => {
            if (editValue && !validateEmail(editValue)) {
              toast.error('Please enter a valid email address')
            }
          },
        }
      } else if (fieldType === 'name') {
        return {
          type: 'text' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
          },
          onBlur: () => {
            if (editValue) {
              const capitalized = capitalizeName(editValue)
              setEditValue(capitalized)
            }
          },
        }
      } else if (fieldType === 'date') {
        return {
          type: 'date' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
          },
        }
      } else if (fieldType === 'hebrew') {
        return {
          type: 'text' as const,
          dir: 'rtl' as const,
          lang: 'he' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
            handleHebrewInput(e, setEditValue)
          },
          style: { fontFamily: 'Arial Hebrew, David, sans-serif' },
        }
      } else {
        return {
          type: 'text' as const,
          value: editValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleFieldSave(fieldName)
            if (e.key === 'Escape') handleFieldCancel()
          },
        }
      }
    }

    if (isEditing) {
      return (
        <div
          className="flex items-center gap-2"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {fieldType === 'select' && options ? (
            <select
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleFieldCancel()
              }}
              className={inputClassName}
              autoFocus
            >
              <option value="">Select…</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input {...getInputProps()} className={inputClassName} autoFocus />
          )}
          <button
            type="button"
            onClick={() => handleFieldSave(fieldName)}
            className="focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-success hover:bg-success/10"
            title="Save"
            aria-label="Save"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={handleFieldCancel}
            className="focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger/10"
            title="Cancel"
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>
      )
    }

    return (
      <div
        role="button"
        tabIndex={0}
        onMouseDown={(e) => {
          e.preventDefault()
          handleFieldEdit(fieldName, currentValue)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleFieldEdit(fieldName, currentValue)
          }
        }}
        className="group flex min-h-[2.5rem] cursor-text items-center justify-between gap-2 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-app-subtle"
        title="Click to edit"
      >
        <div className="min-w-0 flex-1 text-sm">{displayValue}</div>
        <PencilIcon
          className="h-4 w-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>
    )
  }

  useOrgChanged(
    useCallback(() => {
      invalidateFamilyFetch()
      deferred.invalidateTasksFetch()
      payments.invalidateSavedCardsFetch()
      const gen = beginFamilyFetch()
      members.memberFetchGenRef.current += 1
      ledger.resetLedger()
      setData(null)
      setLoading(true)
      statements.resetStatements()
      deferred.resetDeferredData()
      payments.resetPaymentState()
      members.resetMemberState()
      void fetchFamilyDetails(gen)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      beginFamilyFetch,
      invalidateFamilyFetch,
      deferred.invalidateTasksFetch,
      payments.invalidateSavedCardsFetch,
      fetchFamilyDetails,
      ledger.resetLedger,
      statements.resetStatements,
      deferred.resetDeferredData,
      payments.resetPaymentState,
      members.resetMemberState,
    ]),
  )

  const contextValue = useMemo(
    () => ({
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
      paymentPlans: deferred.paymentPlans,
      lifecycleEventTypes: deferred.lifecycleEventTypes,
      statements: statements.statements,
      loading,
      sendingEmail: statements.sendingEmail,
      emailConfig: deferred.emailConfig,
      showEmailModal: statements.showEmailModal,
      setShowEmailModal: statements.setShowEmailModal,
      emailFormData: deferred.emailFormData,
      setEmailFormData: deferred.setEmailFormData,
      familyTasks: deferred.familyTasks,
      loadingFamilyTasks: deferred.loadingFamilyTasks,
      showTaskModal: deferred.showTaskModal,
      setShowTaskModal: deferred.setShowTaskModal,
      subFamilies: deferred.subFamilies,
      loadingSubFamilies: deferred.loadingSubFamilies,
      showInfoModal,
      setShowInfoModal,
      editingField,
      editValue,
      infoForm,
      setInfoForm,
      showMemberModal: members.showMemberModal,
      setShowMemberModal: members.setShowMemberModal,
      editingMember: members.editingMember,
      setEditingMember: members.setEditingMember,
      viewingMemberId: members.viewingMemberId,
      setViewingMemberId: members.setViewingMemberId,
      memberActiveTab: members.memberActiveTab,
      setMemberActiveTab: members.setMemberActiveTab,
      memberBalance: members.memberBalance,
      memberPayments: members.memberPayments,
      memberStatements: members.memberStatements,
      loadingMemberFinancials: members.loadingMemberFinancials,
      showPaymentModal: payments.showPaymentModal,
      setShowPaymentModal: payments.setShowPaymentModal,
      useStripe: payments.useStripe,
      setUseStripe: payments.setUseStripe,
      showEventModal: payments.showEventModal,
      setShowEventModal: payments.setShowEventModal,
      showWithdrawalModal: payments.showWithdrawalModal,
      setShowWithdrawalModal: payments.setShowWithdrawalModal,
      editingWithdrawal: payments.editingWithdrawal,
      setEditingWithdrawal: payments.setEditingWithdrawal,
      withdrawalForm: payments.withdrawalForm,
      setWithdrawalForm: payments.setWithdrawalForm,
      memberForm: members.memberForm,
      setMemberForm: members.setMemberForm,
      paymentForm: payments.paymentForm,
      setPaymentForm: payments.setPaymentForm,
      savedPaymentMethods: payments.savedPaymentMethods,
      eventForm: payments.eventForm,
      setEventForm: payments.setEventForm,
      fetchFamilyTasks: deferred.fetchFamilyTasks,
      fetchFamilyDetails: refreshFamily,
      fetchSubFamilies: deferred.fetchSubFamilies,
      fetchLedgerForTab: ledger.fetchLedgerForTab,
      loadMoreLedgerForTab: ledger.loadMoreLedgerForTab,
      ledgerHasMore: ledger.ledgerHasMore,
      loadingLedgerTab: ledger.loadingLedgerTab,
      loadingMoreLedgerTab: ledger.loadingMoreLedgerTab,
      fetchSavedPaymentMethods: payments.fetchSavedPaymentMethods,
      fetchMemberFinancials: members.fetchMemberFinancials,
      completeFamilyTask: deferred.completeFamilyTask,
      deleteFamilyTask: deferred.deleteFamilyTask,
      getPlanNameById: deferred.getPlanNameById,
      getPlanName: deferred.getPlanName,
      handlePrintStatement: statements.handlePrintStatement,
      handleSavePDFStatement: statements.handleSavePDFStatement,
      handleSendStatementEmail: statements.handleSendStatementEmail,
      handleSaveEmailConfig: statements.handleSaveEmailConfig,
      handlePrintAllStatements: statements.handlePrintAllStatements,
      openAddMemberModal: members.openAddMemberModal,
      handleFieldEdit,
      handleFieldSave,
      handleFieldCancel,
      renderEditableField,
      renderEditableMemberField: members.renderEditableMemberField,
      handleMemberFieldEdit: members.handleMemberFieldEdit,
      handleMemberFieldSave: members.handleMemberFieldSave,
      handleMemberFieldCancel: members.handleMemberFieldCancel,
      handleAddMember: members.handleAddMember,
      handleEditMember: members.handleEditMember,
      handleUpdateMember: members.handleUpdateMember,
      handleDeleteMember: members.handleDeleteMember,
      handleAddPayment: payments.handleAddPayment,
      openAddWithdrawal: payments.openAddWithdrawal,
      openEditWithdrawal: payments.openEditWithdrawal,
      handleSaveWithdrawal: payments.handleSaveWithdrawal,
      handleDeleteWithdrawal: payments.handleDeleteWithdrawal,
      handleAddEvent: payments.handleAddEvent,
      updateEventAmount: payments.updateEventAmount,
      getFamilyLastName: members.getFamilyLastName,
      setSendingEmail: statements.setSendingEmail,
      setEditingField,
      setEditValue,
      setEditingMemberField: members.setEditingMemberField,
      setEditMemberValue: members.setEditMemberValue,
      editingMemberField: members.editingMemberField,
      editMemberValue: members.editMemberValue,
    }),
    // Intentionally broad deps — mirrors original monolithic component
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      params,
      router,
      pathname,
      familyId,
      activeTab,
      data,
      loading,
      roleLoading,
      isAdmin,
      deferred.paymentPlans,
      deferred.lifecycleEventTypes,
      statements.statements,
      deferred.familyTasks,
      deferred.subFamilies,
      members.viewingMemberId,
      members.memberActiveTab,
      members.memberBalance,
      members.memberPayments,
      members.memberStatements,
      members.showMemberModal,
      payments.showPaymentModal,
      payments.showEventModal,
      payments.showWithdrawalModal,
      showInfoModal,
      deferred.showTaskModal,
      statements.showEmailModal,
      editingField,
      members.editingMemberField,
      payments.paymentForm,
      members.memberForm,
      payments.withdrawalForm,
      payments.eventForm,
      infoForm,
      deferred.emailFormData,
      payments.savedPaymentMethods,
      statements.sendingEmail,
      ledger.ledgerNextCursor,
      ledger.loadingMoreLedgerTab,
    ],
  )

  return (
    <FamilyDetailContext.Provider value={contextValue}>{children}</FamilyDetailContext.Provider>
  )
}
