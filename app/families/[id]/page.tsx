'use client'

import dynamic from 'next/dynamic'
import TabLoading from './_components/TabLoading'

const InfoTab = dynamic(() => import('./_components/InfoTab'), {
  loading: () => <TabLoading />,
})

export default function FamilyInfoPage() {
  return <InfoTab />
}
