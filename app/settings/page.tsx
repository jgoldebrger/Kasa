import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import SettingsView from './SettingsView'
import SettingsLoading from './loading'

export const dynamic = 'force-dynamic'

async function SettingsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin', skipSubscriptionGate: true })
  const initialCurrentRole = (ctx.role ?? null) as 'owner' | 'admin' | 'member' | null

  return <SettingsView initialCurrentRole={initialCurrentRole} />
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsServer />
    </Suspense>
  )
}
