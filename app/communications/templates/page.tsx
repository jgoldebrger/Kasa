import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import TemplatesView from '../_components/TemplatesView'
import CommunicationsLoading from '../loading'

export const dynamic = 'force-dynamic'

async function TemplatesServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <TemplatesView />
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<CommunicationsLoading />}>
      <TemplatesServer />
    </Suspense>
  )
}
