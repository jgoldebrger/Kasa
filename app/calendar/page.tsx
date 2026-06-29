import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import CalendarView from './CalendarView'
import CalendarLoading from './loading'

export const dynamic = 'force-dynamic'

async function CalendarServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <CalendarView />
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarLoading />}>
      <CalendarServer />
    </Suspense>
  )
}
