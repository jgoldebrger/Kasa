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
    slug: 'dues-calculator',
    title: 'Understanding the dues calculator',
    summary: 'Project future dues income and recommend plan pricing.',
    category: 'getting-started',
    sections: [
      {
        heading: 'What it shows',
        body: 'The Dues calc page (Projections) forecasts membership growth, lifecycle expenses, and whether your current payment plans cover projected costs over the next several years.',
      },
      {
        heading: 'Adjusting assumptions',
        body: 'Change the history window and projection horizon to see how recommendations shift. The tool blends roster data, historical averages, and planned events when estimating future expenses.',
      },
      {
        heading: 'Using recommendations',
        body: 'Review suggested plan prices per year before changing Settings → Payment Plans. Recommendations aim to keep the fund solvent while accounting for Bar Mitzvah payers and new families.',
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
    slug: 'statements-email',
    title: 'Email statements to families',
    summary: 'Send statement PDFs from the Statements page.',
    category: 'statements',
    sections: [
      {
        heading: 'Prerequisites',
        body: 'Configure SMTP in Settings → Email and test the connection. Families need a valid email address and must not be opted out of statement email.',
      },
      {
        heading: 'Send individually or in bulk',
        body: 'On the Statements page, use Send via Email for one family or select multiple statements for a batch. Each email includes the PDF attachment and uses your letterhead footer.',
      },
      {
        heading: 'Auto-send',
        body: 'Enable scheduled statement generation in Settings → Rules to create monthly statements automatically. Pair with SMTP so families receive balances without manual sends.',
      },
    ],
  },
  {
    slug: 'email-domain-dns',
    title: 'SPF and DKIM for Gmail sending',
    summary: 'Improve deliverability when sending from Gmail or Google Workspace.',
    category: 'statements',
    sections: [
      {
        heading: 'Why DNS records matter',
        body: 'Kasa sends through your Gmail account using SMTP. Recipient mail servers check SPF and DKIM to confirm messages are authorized from your domain. Missing or incorrect records can cause spam folder delivery or bounces, especially for bulk statements and communications.',
      },
      {
        heading: 'SPF record',
        body: 'Add or update a TXT record on your domain for SPF. For Google Workspace, Google provides the exact value in Admin console → Apps → Google Workspace → Gmail → Authenticate email. A typical record includes `include:_spf.google.com`. Only one SPF TXT record is allowed per domain — merge existing entries rather than creating duplicates.',
      },
      {
        heading: 'DKIM',
        body: 'In Google Admin, generate a DKIM key for your domain and publish the TXT record Google provides. DKIM signing helps Gmail prove messages were not altered in transit. Allow up to 48 hours for DNS propagation, then click Verify in Google Admin.',
      },
      {
        heading: 'Custom From address',
        body: "If you send from an address on your own domain (not @gmail.com), SPF and DKIM for that domain are especially important. Personal @gmail.com addresses rely on Google's infrastructure; Workspace domains need your DNS configured correctly.",
      },
      {
        heading: 'Testing',
        body: 'After saving email settings in Kasa, use Send Test Email on Settings → Email. Check the message headers in your inbox (Show original) for SPF=pass and DKIM=pass. Review failed sends in Communications → Sent log if families report missing mail.',
      },
    ],
  },
  {
    slug: 'email-can-spam',
    title: 'CAN-SPAM and physical address requirements',
    summary: 'Include a valid postal address in bulk emails to families.',
    category: 'statements',
    sections: [
      {
        heading: 'US CAN-SPAM Act',
        body: "Commercial email to US recipients must include a valid physical postal address. Kasa adds your organization's address to statement PDFs and email footers when letterhead is configured. Bulk communications and statement emails should not be sent without a complete address on file.",
      },
      {
        heading: 'Configure letterhead',
        body: 'Go to Settings → Letterhead and enter your organization name, street address, city, state, ZIP, and phone. This information appears on PDF statements and in the HTML footer wrapper for emails sent through Kasa.',
      },
      {
        heading: 'Unsubscribe and opt-out',
        body: 'Families can opt out of bulk statement email and bulk communications separately on the family edit form. Communications emails include an unsubscribe link when sent through the Communications module. Honor opt-outs — opted-out families are skipped in batch sends.',
      },
      {
        heading: 'Best practices',
        body: 'Use accurate subject lines, identify your organization in the From name (Settings → Email → From Name), and avoid misleading content. For large campaigns, spread sends across days to stay within Gmail daily limits.',
      },
    ],
  },
  {
    slug: 'email-setup',
    title: 'Set up Gmail for sending email',
    summary: 'Connect Gmail with an app password, test delivery, and understand sending limits.',
    category: 'statements',
    sections: [
      {
        heading: 'Gmail app password',
        body: 'Open Settings → Email and enter your Gmail address plus a Google App Password — not your regular Gmail password. Generate one at Google Account → Security → 2-Step Verification → App passwords. Paste the 16-character password with or without spaces. For custom domains, also configure SPF and DKIM — see the help article on email domain DNS.',
      },
      {
        heading: 'Send a test email',
        body: 'After saving, click Send Test Email. A successful test confirms Kasa can authenticate with Gmail. Check spam if nothing arrives within a few minutes.',
      },
      {
        heading: 'Daily sending limits',
        body: 'Personal Gmail accounts are limited to roughly 500 outgoing messages per day. Large statement batches or communications campaigns may be throttled or fail if you exceed this limit. Spread bulk sends across days or use Google Workspace for higher quotas.',
      },
      {
        heading: 'Opt-out and unsubscribe',
        body: 'Families can opt out of bulk statement emails and bulk communications separately on the family edit form. Opted-out families are skipped in batch sends but can still receive ad-hoc emails from their family page.',
      },
      {
        heading: 'Communications vs statement opt-out',
        body: 'Statement opt-out affects Send via Email on the Statements page and monthly auto-email. Communications opt-out affects the Communications compose tab and scheduled campaigns. A family may opt out of one but not the other.',
      },
      {
        heading: 'Troubleshooting "Gmail rejected"',
        body: 'If sends fail with a Gmail rejection, verify the app password is current (revoke and create a new one if needed), confirm 2-Step Verification is enabled on the account, and check that "Less secure app access" is not blocking the connection. Review failed sends in Communications → Sent log or the dashboard email summary.',
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
