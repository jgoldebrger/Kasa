'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const PaymentsTab = dynamic(() => import('../_components/PaymentsTab'), {
  ssr: false,
  loading: () => <TabLoading />,
})

export default function FamilyPaymentsPage() {
  return <PaymentsTab />
}
