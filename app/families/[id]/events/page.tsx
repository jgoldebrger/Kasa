'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const EventsTab = dynamic(() => import('../_components/EventsTab'), {
  loading: () => <TabLoading />,
})

export default function FamilyEventsPage() {
  return <EventsTab />
}
