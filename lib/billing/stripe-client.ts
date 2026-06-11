import Stripe from 'stripe'
import https from 'https'

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
})

let stripeSingleton: Stripe | null = null

export function getBillingStripe(): Stripe | null {
  const apiKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!apiKey) return null
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(apiKey, {
      httpAgent: httpsAgent,
      maxNetworkRetries: 2,
      timeout: 30000,
    })
  }
  return stripeSingleton
}

export function getAppBaseUrl(): string {
  return (
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    'http://localhost:3000'
  )
}
