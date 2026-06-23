export interface HelpArticle {
  slug: string
  title: string
  summary: string
  category:
    | 'getting-started'
    | 'families'
    | 'payments'
    | 'statements'
    | 'settings'
    | 'troubleshooting'
  sections: { heading: string; body: string }[]
}

export const HELP_CATEGORIES: { id: HelpArticle['category']; label: string }[] = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'families', label: 'Families & members' },
  { id: 'payments', label: 'Payments' },
  { id: 'statements', label: 'Statements & email' },
  { id: 'settings', label: 'Settings' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
]

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'first-login',
    title: 'First login and setup wizard',
    summary: 'Complete your organization setup after accepting an invite.',
    category: 'getting-started',
    sections: [
      {
        heading: 'Accept your invite',
        body: 'Click the invite link from your email, create a password, and sign in. If two-factor authentication is enabled, follow the setup prompts.',
      },
      {
        heading: 'Run the setup wizard',
        body: 'Organization owners are guided through /setup on first login. Configure payment plans, email (SMTP), optional Stripe Connect, and add your first family. You can return to incomplete steps from the dashboard checklist.',
      },
      {
        heading: 'Invite your team',
        body: 'Go to Settings → Members to invite treasurers and assistants. Admins can manage payments and settings; members can view families and the dashboard.',
      },
    ],
  },
  {
    slug: 'payment-plans',
    title: 'Configure payment plans',
    summary: 'Set up age-based dues tiers for your kehilla.',
    category: 'getting-started',
    sections: [
      {
        heading: 'Create plans',
        body: 'Open Settings → Payment Plans. Each plan has a name, yearly price, and optional age range. Assign a plan to families when creating or editing them.',
      },
      {
        heading: 'Bar Mitzvah automation',
        body: 'In Settings → Rules, enable automatic plan assignment and lifecycle event creation when a male member reaches Bar Mitzvah age (Hebrew calendar).',
      },
    ],
  },
  {
    slug: 'import-families',
    title: 'Import families from CSV',
    summary: 'Migrate from spreadsheets using the import tool.',
    category: 'families',
    sections: [
      {
        heading: 'Prepare your file',
        body: 'Use CSV or XLSX with columns for family name, email, address, and payment plan. Download a sample from the import modal on the Families page.',
      },
      {
        heading: 'Run the import',
        body: 'Click Import on the Families page, select your file type (families, members, payments, or lifecycle events), and review the results. Failed rows are listed with error messages.',
      },
      {
        heading: 'Family caps',
        body: 'Starter plans support up to 75 families; Community up to 300. Upgrade from Settings → Billing if you approach your cap.',
      },
    ],
  },
  {
    slug: 'record-payments',
    title: 'Record cash, check, and card payments',
    summary: 'Track dues and event payments from the Payments page.',
    category: 'payments',
    sections: [
      {
        heading: 'Manual payments',
        body: 'Use Quick Pay or open a family record to add cash or check payments. Assign payments to the current billing cycle or a specific year.',
      },
      {
        heading: 'Card payments',
        body: 'Connect Stripe in Settings → Billing (Stripe Connect) so card charges settle to your organization. Families can save cards for recurring monthly charges.',
      },
      {
        heading: 'Recurring billing',
        body: 'Set up recurring monthly charges per family. The nightly cron job processes due charges in your organization timezone.',
      },
    ],
  },
  {
    slug: 'statements',
    title: 'Generate and email statements',
    summary: 'Monthly statements for families with balances.',
    category: 'statements',
    sections: [
      {
        heading: 'Configure letterhead',
        body: 'Settings → Letterhead controls your address, phone, tax ID, and statement footer text that appears on PDF statements.',
      },
      {
        heading: 'Generate statements',
        body: 'Open the Statements page to generate PDFs individually or in bulk. Auto-generation runs on a schedule if enabled in Settings → Rules.',
      },
      {
        heading: 'Email delivery',
        body: 'Configure SMTP in Settings → Email. Statement emails are sent from your configured address. Test the connection before enabling auto-send.',
      },
    ],
  },
  {
    slug: 'email-smtp',
    title: 'Configure email (SMTP)',
    summary: 'Send statements and receipts from your organization address.',
    category: 'settings',
    sections: [
      {
        heading: 'SMTP settings',
        body: 'Settings → Email: enter your SMTP host, port, username, and password. Credentials are encrypted at rest. Common providers include Gmail (app password), Microsoft 365, and transactional services.',
      },
      {
        heading: 'Troubleshooting delivery',
        body: 'If emails fail, check the Activity log for errors. Verify SPF/DKIM records for your domain. Some providers block port 25 — use 587 with STARTTLS.',
      },
    ],
  },
  {
    slug: 'data-export',
    title: 'Export your organization data',
    summary: 'Download a full JSON export for backup or migration.',
    category: 'settings',
    sections: [
      {
        heading: 'Run an export',
        body: 'Organization owners and admins can export from Settings → Data export. The download includes families, members, payments, statements, configuration, and audit history. Sensitive credentials are redacted.',
      },
      {
        heading: 'GDPR and offboarding',
        body: 'Export before cancelling your subscription. After termination, data in the recycle bin is purged after 30 days. Contact privacy@kasa.com for data subject requests.',
      },
    ],
  },
  {
    slug: 'billing-subscription',
    title: 'Platform subscription and billing',
    summary: 'Manage your Kasa subscription plan.',
    category: 'settings',
    sections: [
      {
        heading: 'Subscribe',
        body: 'Organization owners subscribe from Settings → Billing or /pricing. Choose Starter or Community based on family count. Institution plans require contacting sales.',
      },
      {
        heading: 'Manage payment method',
        body: 'Use the Stripe customer portal link in Settings → Billing to update your card or cancel. Members without an active subscription are redirected to pricing.',
      },
    ],
  },
  {
    slug: 'login-issues',
    title: 'Login and access issues',
    summary: 'Reset passwords, 2FA recovery, and role permissions.',
    category: 'troubleshooting',
    sections: [
      {
        heading: 'Forgot password',
        body: 'Use the reset link on the login page. Password reset invalidates existing sessions.',
      },
      {
        heading: 'Two-factor authentication',
        body: 'Enable 2FA from Account settings. Save backup codes securely. If locked out, contact your organization owner or support@kasa.com.',
      },
      {
        heading: 'Cannot access a feature',
        body: 'Member role users cannot access Settings or Payments. Admins need an active platform subscription. Check your role in Settings → Members.',
      },
    ],
  },
]

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug)
}

export function getHelpArticlesByCategory(category: HelpArticle['category']): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category)
}
