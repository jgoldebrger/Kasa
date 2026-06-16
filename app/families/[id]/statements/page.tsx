'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const StatementsTab = dynamic(() => import('../_components/StatementsTab'), {
  ssr: false,
  loading: () => <TabLoading />,
})

export default function FamilyStatementsPage() {
  return <StatementsTab />
}
