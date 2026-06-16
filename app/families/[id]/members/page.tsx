'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const MembersTab = dynamic(() => import('../_components/MembersTab'), {
  loading: () => <TabLoading />,
})

export default function FamilyMembersPage() {
  return <MembersTab />
}
