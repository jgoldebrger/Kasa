import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { LifecycleEvent, LifecycleEventPayment } from '@/lib/models'
import EventsView from './EventsView'
import EventsLoading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialEvents(organizationId: string) {
  await connectDB()

  // Parallel: payments (with populated family) + configured event types
  // (drives the human label). One $in lookup, no N+1.
  const [events, configuredTypes] = await Promise.all([
    LifecycleEventPayment.find({ organizationId })
      .sort({ eventDate: -1 })
      .populate('familyId', 'name')
      .lean<any[]>(),
    LifecycleEvent.find({ organizationId }).select('type name').lean<any[]>(),
  ])

  const labelByType = new Map<string, string>(
    configuredTypes.map((t) => [String(t.type || '').toLowerCase(), t.name || t.type]),
  )

  return events.map((evt) => {
    const familyDoc = evt.familyId
    const familyId =
      familyDoc && typeof familyDoc === 'object'
        ? String(familyDoc._id ?? '')
        : familyDoc
          ? String(familyDoc)
          : ''
    const familyName =
      familyDoc && typeof familyDoc === 'object' && 'name' in familyDoc
        ? (familyDoc as any).name
        : 'Unknown Family'
    const rawType = String(evt.eventType || '')
    return {
      _id: String(evt._id),
      familyId,
      familyName,
      eventType: rawType,
      eventTypeLabel: labelByType.get(rawType.toLowerCase()) || rawType,
      eventDate: evt.eventDate ? new Date(evt.eventDate).toISOString() : '',
      year: evt.year ?? 0,
      amount: evt.amount ?? 0,
      notes: evt.notes || '',
    }
  })
}

async function EventsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  let initialEvents: any[] = []
  try {
    initialEvents = await fetchInitialEvents(ctx.organizationId)
  } catch (err) {
    console.error('[events] server prefetch failed:', err)
  }
  return <EventsView initialEvents={initialEvents} />
}

export default function EventsPage() {
  return (
    <Suspense fallback={<EventsLoading />}>
      <EventsServer />
    </Suspense>
  )
}
