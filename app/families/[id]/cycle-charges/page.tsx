'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const CycleChargesTab = dynamic(() => import('../_components/CycleChargesTab'), {
  loading: () => <TabLoading />,
})

export default function FamilyCycleChargesPage() {
  return <CycleChargesTab />
}
