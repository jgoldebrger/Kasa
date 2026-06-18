import { redirect } from 'next/navigation'
import { auth } from '@/app/auth'
import WelcomeView from './WelcomeView'

export const dynamic = 'force-dynamic'

export default async function WelcomePage() {
  const session = await auth()
  if (session?.user?.id) {
    redirect('/')
  }

  return <WelcomeView />
}
