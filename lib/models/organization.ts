import mongoose, { Schema } from 'mongoose'

const OrganizationSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Set when the owner completes the first-run setup wizard (/setup).
    setupCompletedAt: { type: Date, default: null },
    // Per-org custom branding. Logo is stored as a data URL on the doc itself
    // (capped at ~200KB after server-side resize) to avoid taking on a blob
    // storage dependency. See lib/branding.ts and /api/organizations/branding.
    branding: {
      logoDataUrl: { type: String, default: null },
      logoUpdatedAt: { type: Date, default: null },
      accentColor: { type: String, default: null },
    },
    // Currency + locale settings. Money amounts are still stored as raw
    // numbers (no minor-unit conversion) — the currency code only affects
    // how amounts render. ISO 4217 codes; we accept any uppercase 3-letter
    // string at the schema level and validate against the supported list
    // in lib/currency.ts at write time.
    currency: { type: String, default: 'USD', uppercase: true, trim: true, maxlength: 3 },
    // BCP 47 locale used for Intl.NumberFormat / DateTimeFormat. Defaults
    // to `en-US`. Common alternatives: `he-IL` (Hebrew), `yi` (Yiddish),
    // `en-GB`, `fr-FR`.
    locale: { type: String, default: 'en-US', trim: true, maxlength: 32 },
    // IANA time zone (e.g. `America/New_York`, `Asia/Jerusalem`). Drives
    // the boundary between "today" and "tomorrow" for cron-driven money
    // movement — without this, a 02:00 UTC server tick fires the day's
    // recurring charges before midnight even hits the actual office.
    timezone: { type: String, default: 'UTC', trim: true, maxlength: 64 },
    // Optional Bar Mitzvah automation. When a male family member reaches
    // Bar Mitzvah age (via Hebrew calendar), the member create/update
    // endpoints will:
    //   - assign the configured plan (if `barMitzvahAutoAssignPlanId` is set)
    //   - record a lifecycle event payment of the configured type, valued at
    //     that event type's configured amount (if
    //     `barMitzvahAutoCreateEventTypeId` is set)
    // Each field independently no-ops when null — orgs opt in piecewise.
    barMitzvahAutoAssignPlanId: { type: Schema.Types.ObjectId, ref: 'PaymentPlan', default: null },
    barMitzvahAutoCreateEventTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LifecycleEvent',
      default: null,
    },
    // When a child member is added to a family, record a lifecycle event payment
    // of the configured type at that type's amount. Null disables auto-creation.
    addChildAutoCreateEventTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LifecycleEvent',
      default: null,
    },
    // Default PaymentPlan assigned when a child member is converted into a
    // standalone family (on the wedding-date cron or via the manual
    // convert-to-family endpoint). Null means no plan is auto-assigned and
    // the admin sets it manually on the new family. There is no hardcoded
    // years-married → plan bracketing — orgs pick a single default plan.
    weddingConversionDefaultPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'PaymentPlan',
      default: null,
    },
    // Per-org opt-in for the monthly statement cron jobs. Both default to
    // `false` so existing orgs aren't surprised by automated emails — admins
    // opt in from Settings → Automation. The crons in
    // /api/jobs/generate-monthly-statements and /send-monthly-statements
    // filter on these flags before doing per-org work.
    monthlyStatementAutoGenerate: { type: Boolean, default: false },
    monthlyStatementAutoEmail: { type: Boolean, default: false },
    // Which calendar drives the monthly statement schedule for this org.
    //   - 'gregorian' → fires when today's Gregorian day-of-month matches
    //     `monthlyStatementDay` (1–31).
    //   - 'hebrew'    → fires when today's Hebrew day-of-month matches
    //     `monthlyStatementHebrewDay` (1–30).
    // Each branch has its own end-of-month clamp so an org whose chosen
    // day exceeds the current month's length still fires on the last day
    // of that month.
    monthlyStatementCalendar: { type: String, enum: ['gregorian', 'hebrew'], default: 'gregorian' },
    // Day of the Gregorian month, 1–31. Only consulted when
    // `monthlyStatementCalendar` is 'gregorian'. End-of-month clamp lives
    // in `monthlyStatementDayMatcher` (lib/jobs.ts).
    monthlyStatementDay: { type: Number, default: 1, min: 1, max: 31 },
    // Day of the Hebrew month, 1–30. Only consulted when
    // `monthlyStatementCalendar` is 'hebrew'. End-of-month clamp lives in
    // `monthlyStatementHebrewDayMatcher` (lib/jobs.ts).
    monthlyStatementHebrewDay: { type: Number, default: 1, min: 1, max: 30 },
    // When true, bulk email sends are blocked while the deliverability
    // checklist has failing items — Compose cannot override with "Send anyway".
    emailStrictDeliverability: { type: Boolean, default: false },
    // When false, the org owner is not emailed when a platform admin enters
    // support mode (still subject to PLATFORM_NOTIFY_OWNER_ON_SUPPORT).
    notifyOwnerOnSupportAccess: { type: Boolean, default: true },
    // Org letterhead: the address/contact/signature block stamped onto
    // outbound documents (currently tax receipts; statements still use
    // the hardcoded "Kasa Family Management" header until a follow-up
    // PR migrates them). All fields default to empty strings — orgs opt
    // in piecewise from Settings → Letterhead, and the PDF renderer
    // skips empty lines cleanly. Stored as a nested subdoc so the whole
    // letterhead can be selected/sent with a single `.select('letterhead')`.
    // Platform subscription billing (Kasa → org). Distinct from member
    // card charges handled by /api/stripe/*. Synced from Stripe
    // `customer.subscription.*` webhooks; checkout seeds stripeCustomerId.
    // Stripe Connect (Express) — member dues settle to the org's connected
    // account when STRIPE_CONNECT_ENABLED=true. Platform subscription billing
    // continues to use stripeCustomerId on the platform account.
    stripeConnectAccountId: { type: String, default: null, index: true, sparse: true },
    stripeConnectOnboardingStatus: {
      type: String,
      enum: ['not_started', 'pending', 'complete', 'restricted'],
      default: 'not_started',
    },
    stripeConnectChargesEnabled: { type: Boolean, default: false },
    stripeConnectPayoutsEnabled: { type: Boolean, default: false },
    stripeConnectDetailsSubmitted: { type: Boolean, default: false },
    stripeCustomerId: { type: String, default: null, index: true, sparse: true },
    subscriptionId: { type: String, default: null, index: true, sparse: true },
    planTier: {
      type: String,
      enum: ['starter', 'community', 'institution', null],
      default: null,
    },
    subscriptionStatus: { type: String, default: null },
    trialEndsAt: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    letterhead: {
      addressLine1: { type: String, default: '' },
      addressLine2: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zip: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      // EIN / non-profit tax ID. Printed on tax receipts so donors can
      // claim the deduction. Free-form so non-US orgs can use whatever
      // identifier their jurisdiction uses.
      taxId: { type: String, default: '' },
      signatureName: { type: String, default: '' },
      signatureTitle: { type: String, default: '' },
      statementFooter: { type: String, default: '' },
      receiptThankYou: { type: String, default: '' },
      taxDeductibleDisclosure: { type: String, default: '' },
    },
  },
  { timestamps: true },
)

export const Organization =
  mongoose.models.Organization || mongoose.model('Organization', OrganizationSchema)
