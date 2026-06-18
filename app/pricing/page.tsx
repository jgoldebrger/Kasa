import { auth } from '@/app/auth'
import PricingPageView from './PricingPageView'

export const dynamic = 'force-dynamic'

export default async function PricingPage() {
  const session = await auth()
  const isSignedIn = Boolean(session?.user?.id)

  return <PricingPageView isSignedIn={isSignedIn} />
}
