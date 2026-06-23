import { loadPublicPlans } from '@/lib/billing/public-plans'
import PricingPageClient from './PricingPageClient'

export const dynamic = 'force-dynamic'

export default async function PricingPage() {
  const plans = await loadPublicPlans()
  return <PricingPageClient initialPlans={plans} />
}
