'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const WithdrawalsTab = dynamic(() => import('../_components/WithdrawalsTab'), {
  loading: () => <TabLoading />,
})

export default function FamilyWithdrawalsPage() {
  return <WithdrawalsTab />
}
