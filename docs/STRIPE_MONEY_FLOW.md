# Stripe money flow (KASA)

> **Status:** Current production architecture  
> **As of:** 2026-06-09

KASA uses a **single platform Stripe account**. All card charges for every organization settle to the **platform operator's** Stripe balance and bank account. KASA's MongoDB ledger attributes each payment to the correct `organizationId` and `familyId`; Stripe itself does not split funds per tenant.

---

## Current architecture

```
┌─────────────┐     Stripe Elements      ┌──────────────────┐
│ Org admin   │ ───────────────────────► │ Stripe.js (PCI)  │
│ (browser)   │   card never hits KASA   │ CardElement      │
└──────┬──────┘                          └────────┬─────────┘
       │ POST /api/stripe/create-payment-intent    │
       │ confirm-payment / charge-saved-card       │ confirmCardPayment
       ▼                                           ▼
┌──────────────────────────────────────────────────────────────┐
│ KASA server (STRIPE_SECRET_KEY)                                │
│  • PaymentIntents on platform account                          │
│  • metadata: { organizationId, familyId }                    │
│  • Payment rows in MongoDB (per-org ledger)                    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Platform Stripe      │
                    │ account (live/test)    │
                    │ → operator bank payout │
                    └─────────────────────┘
```

### What happens on a card payment

1. An **org admin** initiates a charge from the family UI (one-time, saved card, or recurring cron).
2. KASA creates a **PaymentIntent** on the platform Stripe account with `metadata.organizationId` and `metadata.familyId`.
3. Card entry uses **Stripe Elements** (`CardElement` in `app/components/StripePaymentForm.tsx`). Only a `clientSecret` and later a `paymentIntentId` / `paymentMethodId` reach KASA — never the PAN or CVC.
4. On success, `/api/stripe/confirm-payment` (or `charge-saved-card` / recurring processor) writes a **`Payment`** document scoped to the org.
5. **Funds** land in the platform Stripe balance. The operator is responsible for reconciling Stripe payouts with each org's books (outside KASA today).

### Saved cards and recurring dues

- Saved cards store a Stripe **PaymentMethod id** (`pm_…`) plus display fields (last4, brand, expiry) in `SavedPaymentMethod`. The full card number is never stored in KASA.
- **Monthly recurring** charges run via `/api/recurring-payments/process` (cron or admin), reusing saved payment methods on the same platform account.
- Failed charges and disputes create **Tasks** and admin notifications; webhooks keep refund/dispute state in sync.

### Environment variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client | Loads Stripe.js |
| `STRIPE_SECRET_KEY` | Server only | API calls (PI create, confirm, webhooks) |
| `STRIPE_WEBHOOK_SECRET` | Server only | Verifies `stripe-signature` on `/api/stripe/webhook` |

All three must refer to the **same Stripe account** (test or live). There is no per-org Stripe key in KASA today.

---

## PCI scope

KASA is designed for **SAQ A** (card data handled entirely by Stripe):

| Responsibility | Owner |
|----------------|-------|
| Card number, expiry, CVC entry | Stripe-hosted fields (Elements) |
| Transmission of card data | Direct browser → Stripe |
| Storage of PAN/CVC | Stripe only |
| Charge authorization & settlement | Platform Stripe account |

**KASA servers never receive, log, or persist full card numbers.** Server-side code only handles PaymentIntent ids, PaymentMethod ids, and non-sensitive card metadata (last4, brand).

**Operator obligations (outside the app):**

- Complete Stripe's account verification and maintain the platform Stripe dashboard.
- File **SAQ A** (or follow your acquirer's guidance) for the platform merchant of record.
- Restrict `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to server env only; never expose in client bundles or logs.
- Use **HTTPS** in production (`NEXTAUTH_URL` / public origin).

---

## What organizations should expect today

| Topic | Today (platform account) |
|-------|---------------------------|
| Who is merchant of record? | **Platform operator** (holder of `STRIPE_SECRET_KEY`) |
| Where do dues land? | Operator's Stripe balance → operator's bank |
| Per-org Stripe dashboard? | **No** — orgs see KASA's payment ledger only |
| Per-org payout / split? | **No** — manual reconciliation off-platform |
| Refunds & disputes | Handled in the **platform** Stripe Dashboard; KASA updates org ledger via webhooks |
| Currency | Per-org display currency; charges use org currency via `resolveStripeCurrency` (no FX in KASA) |
| Card data custody | Stripe; KASA stores `pm_…` references only |

Orgs should treat KASA as **bookkeeping and collection tooling** on top of the operator's merchant account, not as a separate payment processor.

---

## Future: Stripe Connect (not implemented)

A future **Stripe Connect** model would shift money flow so each org (or a designated org treasurer) could be paid directly:

| Aspect | Platform account (now) | Connect (future) |
|--------|------------------------|------------------|
| Stripe account | One platform account | Platform + **Connected accounts** per org |
| Settlement | All funds to operator | **Direct** or **destination charges** to connected accounts |
| Onboarding | None in-app | Stripe Connect onboarding (KYC, bank link) per org |
| Dashboard | Operator only | Orgs could access Express/Standard dashboard (product decision) |
| Code changes | — | `stripeAccount` on API calls, Connect webhooks (`account.updated`), payout models, org settings for `stripeConnectAccountId` |
| PCI | SAQ A (unchanged if still using Elements) | Still SAQ A with Elements; platform may need Connect-specific compliance review |

**No Connect code exists in the repo today.** Planning assumption: migrating to Connect is a **product + compliance** project, not a config toggle. Existing `Payment` rows and metadata would need a migration strategy for in-flight PaymentMethods.

---

## Webhook architecture

**Endpoint:** `POST /api/stripe/webhook`  
**Implementation:** `lib/route-logic/stripe/webhook.ts`

- Raw body is required for signature verification (`stripe.webhooks.constructEvent`).
- CSRF middleware **exempts** this path (Stripe has no browser Origin).
- **Idempotency:** `StripeWebhookEvent` collection deduplicates by `event.id` (7-day TTL).
- Handler errors return **500** so Stripe retries; dedup row is cleared on failure.

### Subscribed event types

Configure these in the Stripe Dashboard when creating the endpoint:

| Event | KASA behavior |
|-------|----------------|
| `payment_intent.succeeded` | Backstop `Payment` insert if confirm-payment did not complete |
| `payment_intent.payment_failed` | Admin task + notification (if not already created) |
| `payment_intent.canceled` | Admin task + notification |
| `charge.refunded` | Update `Payment.refundedAt` / `refundedAmount` |
| `charge.dispute.created` | Mark disputed; open high-priority task; notify admins |
| `charge.dispute.closed` | Update dispute status; sync refunds on `lost` |
| `charge.dispute.funds_withdrawn` | Sync `refundedAmount` from Stripe charge |
| `charge.dispute.funds_reinstated` | Sync after merchant wins dispute |

Other event types are acknowledged with `200` and ignored.

---

## Live webhook setup checklist

Use this when moving from test to **live** mode.

### 1. Stripe Dashboard (live mode)

- [ ] Toggle Stripe Dashboard to **Live** (not Test).
- [ ] Complete account activation (business details, bank account, 2FA).
- [ ] Copy **live** keys: `pk_live_…` and `sk_live_…`.

### 2. Create the live webhook endpoint

- [ ] Go to **Developers → Webhooks → Add endpoint**.
- [ ] **URL:** `https://<your-production-domain>/api/stripe/webhook`  
  Example: `https://app.kasa.example/api/stripe/webhook`
- [ ] **Events:** select the eight types listed above (or "Select events" and add each).
- [ ] Save and copy the **Signing secret** (`whsec_…` for this endpoint only).

### 3. Deploy environment variables

Set in production (Vercel / host env):

- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`
- [ ] `STRIPE_SECRET_KEY=sk_live_…`
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_…` (from the **live** endpoint, not test)
- [ ] Redeploy after changing secrets.

### 4. Verify delivery

- [ ] In Stripe Dashboard → Webhooks → your endpoint → **Send test webhook** (or make a small live charge in a staging org).
- [ ] Confirm HTTP **200** responses in the webhook attempt log.
- [ ] Confirm a row appears in MongoDB `stripewebhookevents` (or check app logs for `[stripe/webhook]` errors).
- [ ] Run a full card flow: create PI → pay → confirm → `Payment` row visible in org UI.

### 5. Operational readiness

- [ ] Document who monitors the **platform** Stripe Dashboard for disputes and refunds.
- [ ] Ensure **Sentry** (`SENTRY_DSN`) is set if you rely on error alerts from webhook 500s.
- [ ] Confirm cron for `/api/recurring-payments/process` uses live keys and `CRON_SECRET`.
- [ ] Remove or rotate any **test** `whsec_` still present in production env.

### 6. Rollback

If webhooks fail after go-live:

1. Check signing secret mismatch (most common: test `whsec` with live keys).
2. Check Stripe attempt log for 400 (signature) vs 500 (handler/DB).
3. Temporarily replay failed events from the Stripe Dashboard after fixing the root cause.

---

## Related code

| Area | Location |
|------|----------|
| Card UI | `app/components/StripePaymentForm.tsx` |
| Create PI | `lib/route-logic/stripe/create-payment-intent.ts` |
| Confirm & ledger | `lib/route-logic/stripe/confirm-payment.ts` |
| Saved card charge | `lib/route-logic/families/[id]/charge-saved-card.ts` |
| Recurring cron | `lib/route-logic/recurring-payments/process.ts` |
| Webhook | `lib/route-logic/stripe/webhook.ts` |
| Money / currency helpers | `lib/money.ts`, `lib/money.server.ts` |
| CSRF exemption | `lib/csrf.ts` (`/api/stripe/webhook`) |

---

## Test mode reference

See [README — Stripe test cards](../README.md#stripe--test-cards) for card numbers. Test and live webhooks require **separate** endpoints and **separate** `STRIPE_WEBHOOK_SECRET` values.
