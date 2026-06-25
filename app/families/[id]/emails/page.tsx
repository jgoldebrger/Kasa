'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const EmailsTab = dynamic(() => import('../_components/EmailsTab'), {
  loading: () => <TabLoading />,
})

export default function FamilyEmailsPage() {
  return <EmailsTab />
}
