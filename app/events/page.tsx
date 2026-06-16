import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { LifecycleEventPayment } from '@/lib/models'
import { EVENTS_LIST_PAGE_SIZE } from '@/lib/client/events-list'
import { encodeCompoundCursor } from '@/lib/pagination'
import { formatLifecycleEventPayments } from '@/lib/route-logic/events'
import EventsView from './EventsView'
import EventsLoading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialEvents(organizationId: string) {
  await connectDB()
  const rows = await LifecycleEventPayment.find({ organizationId })
    .sort({ eventDate: -1, _id: -1 })
    .limit(EVENTS_LIST_PAGE_SIZE + 1)
    .lean<any[]>()

  let nextCursor: string | null = null
  let pageRows = rows
  if (rows.length > EVENTS_LIST_PAGE_SIZE) {
    pageRows = rows.slice(0, EVENTS_LIST_PAGE_SIZE)
    const last = pageRows[pageRows.length - 1]
    if (last) {
      nextCursor = encodeCompoundCursor({
        v: last.eventDate ? new Date(last.eventDate).getTime() : null,
        id: String(last._id),
      })
    }
  }

  const items = await formatLifecycleEventPayments(organizationId, pageRows)
  return {
    items: items.map((r) => JSON.parse(JSON.stringify(r))),
    nextCursor,
  }
}

async function EventsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  try {
    const { items, nextCursor } = await fetchInitialEvents(ctx.organizationId)
    return <EventsView initialEvents={items} initialNextCursor={nextCursor} />
  } catch (err) {
    console.error('[events] server prefetch failed:', err)
    return <EventsView />
  }
}

export default function EventsPage() {
  return (
    <Suspense fallback={<EventsLoading />}>
      <EventsServer />
    </Suspense>
  )
}
