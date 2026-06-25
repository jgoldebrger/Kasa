'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useOrgRole } from '@/lib/client/useOrgRole'
import {
  OPEN_CREATE_TASK,
  OPEN_RECORD_EVENT,
  OPEN_RECORD_PAYMENT,
} from '@/lib/client/command-events'

const RecordPaymentModal = dynamic(() => import('@/app/components/payments/RecordPaymentModal'), {
  ssr: false,
})
const RecordEventModal = dynamic(() => import('@/app/components/events/RecordEventModal'), {
  ssr: false,
})
const TaskFormModal = dynamic(() => import('@/app/components/tasks/TaskFormModal'), {
  ssr: false,
})

/** Global listeners for quick-action custom events (search, dashboard, shortcuts). */
export default function GlobalQuickActionModals() {
  const { isAdmin } = useOrgRole()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)

  const onPayment = useCallback(() => setPaymentOpen(true), [])
  const onEvent = useCallback(() => setEventOpen(true), [])
  const onTask = useCallback(() => setTaskOpen(true), [])

  useEffect(() => {
    if (!isAdmin) return
    window.addEventListener(OPEN_RECORD_PAYMENT, onPayment)
    window.addEventListener(OPEN_RECORD_EVENT, onEvent)
    window.addEventListener(OPEN_CREATE_TASK, onTask)
    return () => {
      window.removeEventListener(OPEN_RECORD_PAYMENT, onPayment)
      window.removeEventListener(OPEN_RECORD_EVENT, onEvent)
      window.removeEventListener(OPEN_CREATE_TASK, onTask)
    }
  }, [isAdmin, onPayment, onEvent, onTask])

  if (!isAdmin) return null

  return (
    <>
      <RecordPaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} />
      <RecordEventModal open={eventOpen} onClose={() => setEventOpen(false)} />
      <TaskFormModal open={taskOpen} onClose={() => setTaskOpen(false)} />
    </>
  )
}
