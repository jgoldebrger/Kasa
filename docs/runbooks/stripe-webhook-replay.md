# Runbook: Stripe webhook replay

## When to use

- Payments show as succeeded in Stripe but not in KASA (`Payment` row missing or stale)
- Refunds, disputes, or `payment_intent.payment_failed` events were not applied
- Webhook endpoint returned `5xx` during an outage (Stripe retries ~3 days, then stops)
- After a database restore that predates recent Stripe events

## How webhooks work in KASA

- Endpoint: `POST /api/stripe/webhook`
- Handler: `lib/route-logic/stripe/webhook.ts`
- Auth: Stripe HMAC signature (`stripe-signature` header + `STRIPE_WEBHOOK_SECRET`)
- Idempotency: `StripeWebhookEvent` collection stores `event.id` for 7 days to dedupe retries

Subscribed events (configure in Stripe Dashboard):

- `charge.refunded`
- `charge.dispute.created` / `charge.dispute.closed`
- `payment_intent.payment_failed`

## Triage

### 1. Stripe Dashboard → Developers → Webhooks

- Select the production endpoint (`https://<domain>/api/stripe/webhook`).
- Review **Recent deliveries** for failed attempts (4xx/5xx).
- Open a failed event → note `event.id` (e.g. `evt_…`) and failure response body.

### 2. Verify server configuration

| Env var | Purpose |
| ------- | ------- |
| `STRIPE_SECRET_KEY` | Server API access (`sk_live_…` in prod) |
| `STRIPE_WEBHOOK_SECRET` | Must match the endpoint's **Signing secret** (`whsec_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-side only |

A `503` with `"Stripe webhook not configured"` means one of the secrets is missing in Vercel.

### 3. Check idempotency log

```javascript
db.stripewebhookevents.find({ eventId: 'evt_...' })
```

If present, KASA already processed the event; look for downstream logic bugs instead of replaying.

### 4. Check Sentry

Webhook handler errors are logged via `lib/log` and Sentry when `SENTRY_DSN` is set.

## Replay from Stripe Dashboard (preferred)

1. Open the event in **Developers → Events**.
2. Click **Resend** (or **Send test webhook** only in test mode).
3. Confirm delivery returns `200`.
4. Verify domain effect:
   - Refund → `Payment.refundedAt` / `refundedAmount` updated
   - Dispute → `Payment.disputedAt` + admin `Task` created
   - Payment failed → admin `Task` created

## Bulk replay after outage

1. Fix root cause first (`/api/health`, `STRIPE_WEBHOOK_SECRET`, DB connectivity).
2. In Stripe → Webhooks → endpoint → filter **Failed** deliveries for the incident window.
3. Resend each failed event (Stripe UI) or use the Stripe CLI / API for automation.

Stripe CLI example (test mode):

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger payment_intent.payment_failed
```

Production replays should use Dashboard resend or the [Events API](https://docs.stripe.com/api/events/retrieve) — do not forward live events to localhost.

## Manual reconciliation (last resort)

If an event cannot be resent and money movement already happened in Stripe:

1. Identify the Stripe `payment_intent` or `charge` ID in Dashboard.
2. Locate the KASA `Payment` document by `stripePaymentIntentId` / metadata.
3. Apply the correct state manually (refund flags, dispute status) via admin UI or a one-off script.
4. Document the incident in your change log — manual fixes bypass audit hooks.

## After database restore

Events processed **after** the restore timestamp will be missing locally. For each gap:

1. List Stripe events in the gap window (Dashboard or API).
2. Resend events not present in `StripeWebhookEvent`.
3. Re-run [cron-failure.md](./cron-failure.md) if recurring charges were missed.

## Prevention

- Keep `SENTRY_DSN` set in production.
- Monitor webhook failure rate in Stripe.
- Include webhook smoke test in deploy checklist (Stripe test event in staging).
- Never delete the `StripeWebhookEvent` TTL index — it prevents duplicate side effects on retry.

## Escalation

- Widespread duplicate tasks or payments after replay → stop resends; inspect `StripeWebhookEvent` and `JobRun` collections.
- PCI or fraud concerns → Stripe Radar / support.
