export interface Subprocessor {
  name: string
  purpose: string
  location: string
  website: string
}

/** Third-party vendors that process data on behalf of Kasa customers. */
export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: 'MongoDB Atlas',
    purpose: 'Database hosting and data storage',
    location: 'United States (AWS us-east-1)',
    website: 'https://www.mongodb.com/cloud/atlas',
  },
  {
    name: 'Stripe',
    purpose: 'Platform subscription billing and member payment processing',
    location: 'United States; EU processing where applicable per Stripe DPA',
    website: 'https://stripe.com',
  },
  {
    name: 'Vercel',
    purpose: 'Application hosting, CDN, and serverless compute',
    location: 'United States (iad1 — Washington, D.C. area)',
    website: 'https://vercel.com',
  },
  {
    name: 'Sentry',
    purpose: 'Error monitoring and performance diagnostics (scrubbed payloads)',
    location: 'United States',
    website: 'https://sentry.io',
  },
  {
    name: 'Customer-configured SMTP',
    purpose: 'Outbound email for statements and receipts (credentials stored encrypted)',
    location: 'Varies by organization configuration',
    website: 'https://kasa.com/help/email',
  },
] as const
