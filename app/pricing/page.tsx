import { Suspense } from 'react'
import type { Metadata } from 'next'
import JsonLd from '@/app/components/seo/JsonLd'
import { loadPublicPlans } from '@/lib/billing/public-plans'
import { resolveAppBaseUrl } from '@/lib/app-base-url'
import { organizationJsonLd, softwareApplicationJsonLd, webPageJsonLd } from '@/lib/seo/json-ld'
import { publicPageMetadata } from '@/lib/seo/metadata'
import PricingPageClient from './PricingPageClient'

export const dynamic = 'force-dynamic'

const TITLE = 'Kasa Pricing for Kehillos — Starter, Community, Institution'
const DESCRIPTION =
  'Starter $49/mo (75 families), Community $149/mo (300 families), Institution custom. Invitation-only membership software for kehilla treasurers.'

export const metadata: Metadata = publicPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/pricing',
})

export default async function PricingPage() {
  const plans = await loadPublicPlans()
  const baseUrl = resolveAppBaseUrl()
  return (
    <>
      <JsonLd data={organizationJsonLd(baseUrl)} />
      <JsonLd data={softwareApplicationJsonLd(baseUrl)} />
      <JsonLd
        data={webPageJsonLd({
          baseUrl,
          path: '/pricing',
          name: TITLE,
          description: DESCRIPTION,
        })}
      />
      <Suspense fallback={null}>
        <PricingPageClient initialPlans={plans} />
      </Suspense>
    </>
  )
}
