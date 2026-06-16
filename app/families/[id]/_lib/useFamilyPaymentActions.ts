'use client'

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import type { LifecycleEventType } from './helpers'

const EMPTY_PAYMENT_FORM = {
  amount: 0,
  paymentDate: new Date().toISOString().split('T')[0],
  year: new Date().getFullYear(),
  type: 'membership' as 'membership' | 'donation' | 'other',
  paymentMethod: 'cash' as 'cash' | 'credit_card' | 'check' | 'quick_pay',
  paymentFrequency: 'one-time' as 'one-time' | 'monthly',
  paymentFor: 'family' as 'family' | 'member',
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
}

export interface UseFamilyPaymentActionsOptions {
  familyId: string
  isAdmin: boolean
  formatMoney: (n: number) => string
  lifecycleEventTypes: LifecycleEventType[]
  refreshFamily: (sharedGen?: number) => Promise<void>
  fetchMemberFinancials: () => Promise<void>
  viewingMemberId: string | null
  memberActiveTab: 'info' | 'balance' | 'payments' | 'statements'
  toast: { success: (msg: string) => void; error: (msg: string) => void }
  confirm: (opts: {
    title?: string
    message: string
    destructive?: boolean
    confirmLabel?: string
  }) => Promise<boolean>
}

export function useFamilyPaymentActions({
  familyId,
  isAdmin,
  formatMoney,
  lifecycleEventTypes,
  refreshFamily,
  fetchMemberFinancials,
  viewingMemberId,
  memberActiveTab,
  toast,
  confirm,
}: UseFamilyPaymentActionsOptions) {
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [useStripe, setUseStripe] = useState(false)
  const [showEventModal, setShowEventModal] = useState(false)
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)
  const [editingWithdrawal, setEditingWithdrawal] = useState<any | null>(null)
  const [withdrawalForm, setWithdrawalForm] = useState({
    amount: 0,
    withdrawalDate: new Date().toISOString().split('T')[0],
    reason: '',
    notes: '',
  })
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM)
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([])
  const [eventForm, setEventForm] = useState({
    eventType: '' as string,
    amount: 0,
    eventDate: new Date().toISOString().split('T')[0],
    year: new Date().getFullYear(),
    notes: '',
  })

  const paymentSubmittingRef = useRef(false)
  const withdrawalSubmittingRef = useRef(false)
  const eventSubmittingRef = useRef(false)
  const lifecycleTypesAppliedRef = useRef(false)

  const {
    begin: beginSavedCardsFetch,
    invalidate: invalidateSavedCardsFetch,
    isStale: isSavedCardsFetchStale,
  } = useRequestGeneration()

  useEffect(() => {
    if (paymentForm.amount <= 0) {
      setUseStripe(false)
    }
  }, [paymentForm.amount])

  useEffect(() => {
    if (lifecycleEventTypes.length > 0 && !lifecycleTypesAppliedRef.current) {
      lifecycleTypesAppliedRef.current = true
      setEventForm({
        eventType: lifecycleEventTypes[0].type,
        amount: lifecycleEventTypes[0].amount,
        eventDate: new Date().toISOString().split('T')[0],
        year: new Date().getFullYear(),
        notes: '',
      })
    }
  }, [lifecycleEventTypes])

  const fetchSavedPaymentMethods = useCallback(async () => {
    if (!familyId) return
    const gen = beginSavedCardsFetch()
    try {
      const res = await fetch(`/api/families/${familyId}/saved-payment-methods`)
      if (isSavedCardsFetchStale(gen)) return
      if (res.ok) {
        const data = await res.json().catch(() => [])
        if (isSavedCardsFetchStale(gen)) return
        setSavedPaymentMethods(data || [])
      }
    } catch (error) {
      if (isSavedCardsFetchStale(gen)) return
      console.error('Error fetching saved payment methods:', error)
      setSavedPaymentMethods([])
    }
  }, [familyId, beginSavedCardsFetch, isSavedCardsFetchStale])

  useEffect(() => {
    if (showPaymentModal && paymentForm.paymentMethod === 'credit_card' && familyId) {
      void fetchSavedPaymentMethods()
    }
  }, [showPaymentModal, paymentForm.paymentMethod, familyId, fetchSavedPaymentMethods])

  const handleAddPayment = async (e: FormEvent) => {
    e.preventDefault()

    if (paymentSubmittingRef.current) return

    if (paymentForm.paymentMethod === 'credit_card' && useStripe) {
      return
    }

    if (!paymentForm.amount || paymentForm.amount <= 0) {
      toast.error('Please enter a valid amount greater than 0')
      return
    }

    if (paymentForm.paymentFor === 'member' && !paymentForm.memberId) {
      toast.error('Please select a member for this payment')
      return
    }

    paymentSubmittingRef.current = true

    if (
      paymentForm.paymentMethod === 'credit_card' &&
      paymentForm.useSavedCard &&
      paymentForm.selectedSavedCardId
    ) {
      try {
        const res = await fetch(`/api/families/${familyId}/charge-saved-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            savedPaymentMethodId: paymentForm.selectedSavedCardId,
            amount: paymentForm.amount,
            paymentDate: paymentForm.paymentDate,
            year: paymentForm.year,
            type: paymentForm.type,
            notes: paymentForm.notes,
            paymentFrequency: paymentForm.paymentFrequency,
            memberId:
              paymentForm.paymentFor === 'member' && paymentForm.memberId
                ? paymentForm.memberId
                : undefined,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error || 'Failed to charge saved card.')
          return
        }
        const data = await res.json().catch(() => ({}))
        if (data.success) {
          setShowPaymentModal(false)
          setUseStripe(false)
          setPaymentForm(EMPTY_PAYMENT_FORM)
          void refreshFamily()
          fetchSavedPaymentMethods()
        } else {
          toast.error(`Error charging card: ${data.error || 'Unknown error'}`)
        }
      } catch (error: any) {
        console.error('Error charging saved card:', error)
        toast.error('Error charging saved card. Please check the console for details.')
      } finally {
        paymentSubmittingRef.current = false
      }
      return
    }

    try {
      const selectedPaymentMethod = paymentForm.paymentMethod || 'cash'

      const paymentData: any = {
        amount: paymentForm.amount,
        paymentDate: paymentForm.paymentDate,
        year: paymentForm.year,
        type: paymentForm.type,
        paymentMethod: selectedPaymentMethod,
        paymentFrequency: paymentForm.paymentFrequency,
        notes: paymentForm.notes || undefined,
      }

      if (paymentForm.paymentFor === 'member' && paymentForm.memberId) {
        paymentData.memberId = paymentForm.memberId
      }

      if (selectedPaymentMethod === 'credit_card') {
        if (paymentForm.ccLast4) {
          paymentData.ccInfo = {
            last4: paymentForm.ccLast4,
            cardType: paymentForm.ccCardType || undefined,
            expiryMonth: paymentForm.ccExpiryMonth || undefined,
            expiryYear: paymentForm.ccExpiryYear || undefined,
            nameOnCard: paymentForm.ccNameOnCard || undefined,
          }
        }
      }

      if (selectedPaymentMethod === 'check') {
        if (paymentForm.checkNumber) {
          paymentData.checkInfo = {
            checkNumber: paymentForm.checkNumber,
            bankName: paymentForm.checkBankName || undefined,
            routingNumber: paymentForm.checkRoutingNumber || undefined,
          }
        }
      }

      const res = await fetch('/api/families/' + familyId + '/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...paymentData, familyId }),
      })

      if (res.ok) {
        setShowPaymentModal(false)
        setPaymentForm(EMPTY_PAYMENT_FORM)
        void refreshFamily()
        fetchSavedPaymentMethods()
        if (viewingMemberId && memberActiveTab === 'payments') {
          fetchMemberFinancials()
        }
      } else {
        const errorData = await res.json().catch(() => ({}))
        const detail =
          Array.isArray(errorData.issues) && errorData.issues.length
            ? ' — ' +
              errorData.issues.map((i: any) => `${i.path || 'body'}: ${i.message}`).join('; ')
            : ''
        console.error('Add payment failed', {
          status: res.status,
          error: errorData?.error,
          issues: errorData?.issues,
          paymentMethod: paymentData?.paymentMethod,
          amount: paymentData?.amount,
        })
        toast.error(`Error adding payment: ${errorData.error || 'Unknown error'}${detail}`)
      }
    } catch (error) {
      console.error('Error adding payment:', error)
      toast.error('Error adding payment. Please check the console for details.')
    } finally {
      paymentSubmittingRef.current = false
    }
  }

  const openAddWithdrawal = () => {
    setEditingWithdrawal(null)
    setWithdrawalForm({
      amount: 0,
      withdrawalDate: new Date().toISOString().split('T')[0],
      reason: '',
      notes: '',
    })
    setShowWithdrawalModal(true)
  }

  const openEditWithdrawal = (w: any) => {
    setEditingWithdrawal(w)
    setWithdrawalForm({
      amount: Number(w.amount) || 0,
      withdrawalDate: w.withdrawalDate
        ? new Date(w.withdrawalDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      reason: w.reason || '',
      notes: w.notes || '',
    })
    setShowWithdrawalModal(true)
  }

  const handleSaveWithdrawal = async (e: FormEvent) => {
    e.preventDefault()
    if (withdrawalSubmittingRef.current) return
    withdrawalSubmittingRef.current = true
    try {
      const url = editingWithdrawal
        ? `/api/families/${familyId}/withdrawals/${editingWithdrawal._id}`
        : `/api/families/${familyId}/withdrawals`
      const method = editingWithdrawal ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withdrawalForm),
      })
      if (res.ok) {
        setShowWithdrawalModal(false)
        setEditingWithdrawal(null)
        void refreshFamily()
        toast.success(editingWithdrawal ? 'Withdrawal updated.' : 'Withdrawal recorded.')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to save withdrawal.')
      }
    } catch (error) {
      console.error('Error saving withdrawal:', error)
      toast.error('Error saving withdrawal.')
    } finally {
      withdrawalSubmittingRef.current = false
    }
  }

  const handleDeleteWithdrawal = async (w: any) => {
    const ok = await confirm({
      title: 'Delete withdrawal?',
      message: `This will permanently remove the ${w.reason ? `"${w.reason}" ` : ''}withdrawal of ${formatMoney(Number(w.amount))}.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/families/${familyId}/withdrawals/${w._id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        void refreshFamily()
        toast.success('Withdrawal deleted.')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to delete withdrawal.')
      }
    } catch (error) {
      console.error('Error deleting withdrawal:', error)
      toast.error('Error deleting withdrawal.')
    }
  }

  const handleAddEvent = async (e: FormEvent) => {
    e.preventDefault()
    if (eventSubmittingRef.current) return
    eventSubmittingRef.current = true
    try {
      const res = await fetch('/api/families/' + familyId + '/lifecycle-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...eventForm, familyId }),
      })
      if (res.ok) {
        setShowEventModal(false)
        const first = lifecycleEventTypes[0]
        setEventForm({
          eventType: first?.type ?? '',
          amount: first?.amount ?? 0,
          eventDate: new Date().toISOString().split('T')[0],
          year: new Date().getFullYear(),
          notes: '',
        })
        void refreshFamily()
        toast.success('Event recorded.')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to save event.')
      }
    } catch (error) {
      console.error('Error adding event:', error)
      toast.error('Error saving event.')
    } finally {
      eventSubmittingRef.current = false
    }
  }

  const updateEventAmount = (type: string) => {
    const matched = lifecycleEventTypes.find((ev) => ev.type === type)
    setEventForm({ ...eventForm, eventType: type, amount: matched?.amount ?? 0 })
  }

  const resetPaymentState = useCallback(() => {
    setSavedPaymentMethods([])
    lifecycleTypesAppliedRef.current = false
  }, [])

  return {
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
    paymentForm,
    setPaymentForm,
    savedPaymentMethods,
    eventForm,
    setEventForm,
    fetchSavedPaymentMethods,
    handleAddPayment,
    openAddWithdrawal,
    openEditWithdrawal,
    handleSaveWithdrawal,
    handleDeleteWithdrawal,
    handleAddEvent,
    updateEventAmount,
    invalidateSavedCardsFetch,
    resetPaymentState,
  }
}
