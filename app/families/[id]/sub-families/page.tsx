'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const SubFamiliesTab = dynamic(() => import('../_components/SubFamiliesTab'), {
  loading: () => <TabLoading />,
})

export default function FamilySubFamiliesPage() {
  return <SubFamiliesTab />
}
