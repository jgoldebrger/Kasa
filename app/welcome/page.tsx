import { redirect } from 'next/navigation'
import JsonLd from '@/app/components/seo/JsonLd'
import { auth } from '@/app/auth'
import { resolveAppBaseUrl } from '@/lib/app-base-url'
import {
  DEFAULT_SOFTWARE_DESCRIPTION,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webPageJsonLd,
} from '@/lib/seo/json-ld'
import { publicPageMetadata } from '@/lib/seo/metadata'
import WelcomeView from './WelcomeView'

export const dynamic = 'force-dynamic'

const TITLE = 'Membership Books for Kehilla Treasurers — Kasa'
const DESCRIPTION =
  'Run statement months on the Hebrew calendar, email each family their balance, and keep yearly P&L without becoming a part-time accountant.'

export const metadata = publicPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/welcome',
})

export default async function WelcomePage() {
  const session = await auth()
  if (session?.user?.id) {
    redirect('/')
  }

  const baseUrl = resolveAppBaseUrl()
  return (
    <>
      <JsonLd data={organizationJsonLd(baseUrl)} />
      <JsonLd data={softwareApplicationJsonLd(baseUrl)} />
      <JsonLd
        data={webPageJsonLd({
          baseUrl,
          path: '/welcome',
          name: TITLE,
          description: DEFAULT_SOFTWARE_DESCRIPTION,
        })}
      />
      <WelcomeView />
    </>
  )
}
