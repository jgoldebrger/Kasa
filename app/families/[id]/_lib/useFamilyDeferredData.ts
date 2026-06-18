'use client'

import { useState, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { cachedFetch } from '@/lib/client-cache'
import { getPlanDisplayName } from '@/lib/payment-plan-display'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import type { PaymentPlan, LifecycleEventType } from './helpers'

export interface UseFamilyDeferredDataOptions {
  familyId: string
  isFamilyFetchStale: (gen: number) => boolean
  beginFamilyFetch: () => number
  toast: { success: (msg: string) => void; error: (msg: string) => void }
  confirm: (opts: {
    title?: string
    message: string
    destructive?: boolean
    confirmLabel?: string
  }) => Promise<boolean>
}

export function useFamilyDeferredData({
  familyId,
  isFamilyFetchStale,
  beginFamilyFetch,
  toast,
  confirm,
}: UseFamilyDeferredDataOptions) {
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([])
  const [lifecycleEventTypes, setLifecycleEventTypes] = useState<LifecycleEventType[]>([])
  const [emailConfig, setEmailConfig] = useState<any>(null)
  const [emailFormData, setEmailFormData] = useState({
    email: '',
    password: '',
    fromName: 'Kasa Family Management',
  })
  const [familyTasks, setFamilyTasks] = useState<any[]>([])
  const [loadingFamilyTasks, setLoadingFamilyTasks] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [subFamilies, setSubFamilies] = useState<any[]>([])
  const [loadingSubFamilies, setLoadingSubFamilies] = useState(false)

  const {
    begin: beginTasksFetch,
    invalidate: invalidateTasksFetch,
    isStale: isTasksFetchStale,
  } = useRequestGeneration()

  const fetchSubFamilies = useCallback(
    async (sharedGen?: number) => {
      if (!familyId) return
      const gen = sharedGen ?? beginFamilyFetch()
      setLoadingSubFamilies(true)
      try {
        const res = await fetch(`/api/families/${familyId}/sub-families`)
        if (isFamilyFetchStale(gen)) return
        if (res.ok) {
          const data = await res.json().catch(() => [])
          if (isFamilyFetchStale(gen)) return
          setSubFamilies(data || [])
        }
      } catch (error) {
        if (isFamilyFetchStale(gen)) return
        console.error('Error fetching sub-families:', error)
      } finally {
        if (!isFamilyFetchStale(gen)) setLoadingSubFamilies(false)
      }
    },
    [familyId, beginFamilyFetch, isFamilyFetchStale],
  )

  const fetchFamilyTasks = useCallback(async () => {
    if (!familyId) return
    const gen = beginTasksFetch()
    setLoadingFamilyTasks(true)
    try {
      const res = await fetch(`/api/tasks?relatedFamilyId=${familyId}`)
      if (isTasksFetchStale(gen)) return
      if (res.ok) {
        const data = await res.json().catch(() => [])
        if (isTasksFetchStale(gen)) return
        setFamilyTasks(Array.isArray(data) ? data : [])
      } else {
        if (isTasksFetchStale(gen)) return
        setFamilyTasks([])
      }
    } catch (error) {
      if (isTasksFetchStale(gen)) return
      console.error('Error fetching family tasks:', error)
      setFamilyTasks([])
    } finally {
      if (!isTasksFetchStale(gen)) setLoadingFamilyTasks(false)
    }
  }, [familyId, beginTasksFetch, isTasksFetchStale])

  const completeFamilyTask = useCallback(
    async (taskId: string) => {
      const prev = familyTasks
      setFamilyTasks((cur) =>
        cur.map((t) => (t._id === taskId ? { ...t, status: 'completed' } : t)),
      )
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        })
        if (!res.ok) throw new Error()
        toast.success('Task completed.')
      } catch {
        setFamilyTasks(prev)
        toast.error('Could not complete task.')
      }
    },
    [familyTasks, toast],
  )

  const deleteFamilyTask = useCallback(
    async (task: any) => {
      if (
        !(await confirm({
          title: 'Delete task?',
          message: `"${task.title}" will be permanently removed.`,
          destructive: true,
          confirmLabel: 'Delete',
        }))
      )
        return
      try {
        const res = await fetch(`/api/tasks/${task._id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        fetchFamilyTasks()
        toast.success('Task deleted.')
      } catch {
        toast.error('Could not delete task.')
      }
    },
    [confirm, fetchFamilyTasks, toast],
  )

  const paymentPlansInFlightRef = useRef<Promise<void> | null>(null)

  const fetchPaymentPlans = useCallback(
    async (sharedGen?: number) => {
      const gen = sharedGen ?? beginFamilyFetch()
      try {
        const data = await cachedFetch<PaymentPlan[]>('/api/payment-plans', { ttl: 60_000 })
        if (isFamilyFetchStale(gen)) return
        if (Array.isArray(data)) {
          setPaymentPlans(data)
        }
      } catch (error) {
        if (isFamilyFetchStale(gen)) return
        console.error('Error fetching payment plans:', error)
      }
    },
    [beginFamilyFetch, isFamilyFetchStale],
  )

  const ensurePaymentPlans = useCallback(async () => {
    if (paymentPlans.length > 0) return
    if (paymentPlansInFlightRef.current) {
      await paymentPlansInFlightRef.current
      return
    }
    const promise = fetchPaymentPlans().finally(() => {
      paymentPlansInFlightRef.current = null
    })
    paymentPlansInFlightRef.current = promise
    await promise
  }, [paymentPlans.length, fetchPaymentPlans])

  const fetchLifecycleEventTypes = useCallback(
    async (sharedGen?: number) => {
      const gen = sharedGen ?? beginFamilyFetch()
      try {
        const data = await cachedFetch<LifecycleEventType[]>('/api/lifecycle-event-types', {
          ttl: 60_000,
        })
        if (isFamilyFetchStale(gen)) return
        if (Array.isArray(data)) {
          setLifecycleEventTypes(data)
        }
      } catch (error) {
        if (isFamilyFetchStale(gen)) return
        console.error('Error fetching lifecycle event types:', error)
      }
    },
    [beginFamilyFetch, isFamilyFetchStale],
  )

  const fetchEmailConfig = useCallback(
    async (sharedGen?: number) => {
      const gen = sharedGen ?? beginFamilyFetch()
      try {
        const res = await fetch('/api/email-config')
        if (isFamilyFetchStale(gen)) return
        if (res.ok) {
          const config = await res.json().catch(() => ({}))
          if (isFamilyFetchStale(gen)) return
          if (config?.configured === false || !config?.email) {
            setEmailConfig(null)
          } else {
            setEmailConfig(config)
            setEmailFormData((prev) => ({
              ...prev,
              email: config.email,
              fromName: config.fromName || 'Kasa Family Management',
            }))
          }
        }
      } catch (error) {
        if (isFamilyFetchStale(gen)) return
        console.error('Error fetching email config:', error)
      }
    },
    [beginFamilyFetch, isFamilyFetchStale],
  )

  const getPlanNameById = useCallback(
    (planId: string): string => {
      return getPlanDisplayName(paymentPlans, planId)
    },
    [paymentPlans],
  )

  const getPlanName = useCallback(
    (planNumber: number): string => {
      if (!planNumber) return 'No Plan'
      const plan = paymentPlans.find((p) => p.planNumber === planNumber)
      return plan ? plan.name : `Plan ${planNumber}`
    },
    [paymentPlans],
  )

  const resetDeferredData = useCallback(() => {
    paymentPlansInFlightRef.current = null
    setSubFamilies([])
    setFamilyTasks([])
    setPaymentPlans([])
    setLifecycleEventTypes([])
    setEmailConfig(null)
  }, [])

  return {
    paymentPlans,
    setPaymentPlans,
    lifecycleEventTypes,
    setLifecycleEventTypes,
    emailConfig,
    setEmailConfig,
    emailFormData,
    setEmailFormData,
    familyTasks,
    loadingFamilyTasks,
    showTaskModal,
    setShowTaskModal,
    subFamilies,
    loadingSubFamilies,
    fetchSubFamilies,
    fetchFamilyTasks,
    completeFamilyTask,
    deleteFamilyTask,
    ensurePaymentPlans,
    fetchPaymentPlans,
    fetchLifecycleEventTypes,
    fetchEmailConfig,
    getPlanNameById,
    getPlanName,
    invalidateTasksFetch,
    resetDeferredData,
  }
}
