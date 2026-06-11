import { requireServerOrgContext } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

/** P&L and custom report builder are admin-only (API routes enforce the same). */
export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireServerOrgContext({ minRole: 'admin' })
  return children
}
