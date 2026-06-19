# Stripe money flow (KASA)

> **Status:** Platform account (default) + optional Stripe Connect

> **As of:** 2026-06-19

KASA uses a **platform Stripe account** for all API calls. When `STRIPE_CONNECT_ENABLED=true`, member card charges are created on each org's **connected account** via the `stripeAccount` request option; funds settle to the org's linked bank account instead of the platform balance.

When `STRIPE_CONNECT_ENABLED` is **false** (default), behavior is unchanged: all charges settle to the platform operator's Stripe balance.

---

## Architecture modes

### Legacy platform account (`STRIPE_CONNECT_ENABLED=false`)

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

### Stripe Connect (`STRIPE_CONNECT_ENABLED=true`)

```

┌─────────────┐  loadStripe(pk, { stripeAccount })   ┌──────────────────┐

│ Org admin   │ ───────────────────────────────────► │ Stripe.js        │

└──────┬──────┘                                      └────────┬─────────┘

       │ create-payment-intent → { clientSecret, stripeAccountId }

       ▼

┌──────────────────────────────────────────────────────────────┐

│ KASA platform (STRIPE_SECRET_KEY)                              │

│  • PI create/confirm with { stripeAccount: acct_… }          │

│  • Org fields: stripeConnectAccountId,                       │

│    stripeConnectChargesEnabled, …                            │

└──────────────────────────────┬───────────────────────────────────┘

                               │

                               ▼

                    ┌─────────────────────┐

                    │ Connected account      │

                    │ (per org, Express)     │

                    │ → org treasurer bank   │

                    └─────────────────────┘

```

**Gating:** Member charges require an active Kasa platform subscription **and** `stripeConnectChargesEnabled` when Connect is on. Orgs complete onboarding from Settings → Billing.

**Client routing:** `create-payment-intent` returns `stripeAccountId` when Connect is active; `StripePaymentForm` loads Stripe.js with that account before mounting Elements.

**Webhooks:** Connect events include `event.account`. Charge/dispute handlers pass `{ stripeAccount: event.account }` when retrieving related Stripe objects.

---

## What happens on a card payment

1. An **org admin** initiates a charge from the family UI (one-time, saved card, or recurring cron).

2. KASA creates a **PaymentIntent** with `metadata.organizationId` and `metadata.familyId`. When Connect is enabled and the org has charges enabled, the PI is scoped to `org.stripeConnectAccountId`.

3. Card entry uses **Stripe Elements** (`CardElement` in `app/components/StripePaymentForm.tsx`). Only a `clientSecret` and later a `paymentIntentId` / `paymentMethodId` reach KASA — never the PAN or CVC.

4. On success, `/api/stripe/confirm-payment` (or `charge-saved-card` / recurring processor) writes a **`Payment`** document scoped to the org.

5. **Funds** land in the platform balance (legacy) or the org's connected account (Connect).

### Saved cards and recurring dues

- Saved cards store a Stripe **PaymentMethod id** (`pm_…`) plus display fields in `SavedPaymentMethod`. PaymentMethod ids are **account-scoped** — they cannot be migrated between platform and connected accounts.

- `SavedPaymentMethod.legacyPlatformAccount` defaults to `true`. Cards saved after Connect onboarding set `legacyPlatformAccount: false`. Legacy cards cannot be charged when Connect is enabled; families must re-enter their card.

- **Monthly recurring** charges run via `/api/recurring-payments/process`. When Connect is enabled, recurring rows are **skipped** (schedule not advanced) if onboarding is incomplete or the saved card is legacy.

- Failed charges and disputes create **Tasks** and admin notifications; webhooks keep refund/dispute state in sync.

### Environment variables

| Variable | Scope | Purpose |

|----------|-------|---------|

| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client | Loads Stripe.js |

| `STRIPE_SECRET_KEY` | Server only | Platform API calls (PI create, confirm, webhooks) |

| `STRIPE_WEBHOOK_SECRET` | Server only | Verifies `stripe-signature` on `/api/stripe/webhook` |

| `STRIPE_CONNECT_ENABLED` | Server | `true` routes member charges through Connect; `false` = legacy |

All Stripe keys must refer to the **same platform Stripe account** (test or live). Connected accounts are created under that platform.

---

## PCI scope

KASA is designed for **SAQ A** (card data handled entirely by Stripe):

| Responsibility | Owner |

|----------------|-------|

| Card number, expiry, CVC entry | Stripe-hosted fields (Elements) |

| Transmission of card data | Direct browser → Stripe |

| Storage of PAN/CVC | Stripe only |

| Charge authorization & settlement | Platform or connected account (Connect) |

**KASA servers never receive, log, or persist full card numbers.** Server-side code only handles PaymentIntent ids, PaymentMethod ids, and non-sensitive card metadata (last4, brand).

---

## What organizations should expect

| Topic | Legacy (`STRIPE_CONNECT_ENABLED=false`) | Connect (`STRIPE_CONNECT_ENABLED=true`) |

|-------|-------------------------------------------|----------------------------------------|

| Merchant of record (member charges) | Platform operator | **Org** (connected account) |

| Where dues land | Operator's Stripe balance | Org's connected account → org bank |

| Onboarding | None | Stripe Connect in Settings → Billing |

| Saved cards before Connect | N/A | Must be re-saved (`legacyPlatformAccount`) |

| Refunds & disputes | Platform Stripe Dashboard | Connected account dashboard |

| Currency | Per-org via `resolveStripeCurrency` | Same |

---

## Webhook architecture

**Endpoint:** `POST /api/stripe/webhook`

**Implementation:** `lib/route-logic/stripe/webhook.ts`

- Raw body is required for signature verification (`stripe.webhooks.constructEvent`).

- CSRF middleware **exempts** this path (Stripe has no browser Origin).

- **Idempotency:** `StripeWebhookEvent` collection deduplicates by `event.id` (7-day TTL).

- **Connect:** When `event.account` is set, Stripe API lookups use `{ stripeAccount: event.account }`.

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

| `account.updated` | Sync org `stripeConnect*` fields (Connect onboarding) |

Other event types are acknowledged with `200` and ignored.

---

## Related code

| Area | Location |

|------|----------|

| Connect client helpers | `lib/stripe/client.ts` |

| Card UI | `app/components/StripePaymentForm.tsx` |

| Create PI | `lib/route-logic/stripe/create-payment-intent.ts` |

| Confirm & ledger | `lib/route-logic/stripe/confirm-payment.ts` |

| Saved card charge | `lib/route-logic/families/[id]/charge-saved-card.ts` |

| Saved card CRUD | `lib/route-logic/families/[id]/saved-payment-methods.ts` |

| Recurring cron | `lib/route-logic/recurring-payments/process.ts` |

| Member charge gate | `lib/billing/feature-gate.ts` |

| Webhook | `lib/route-logic/stripe/webhook.ts` |

| Org Connect fields | `lib/models/organization.ts` |

| Saved card migration flag | `lib/models/saved-payment-method.ts` (`legacyPlatformAccount`) |

---

## Test mode reference

See [README — Stripe test cards](../README.md#stripe--test-cards) for card numbers. Test and live webhooks require **separate** endpoints and **separate** `STRIPE_WEBHOOK_SECRET` values.
