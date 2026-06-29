# Email bounce webhook

Kasa records bounces when an external system POSTs to:

```
POST /api/email/bounce
X-Webhook-Secret: <EMAIL_BOUNCE_WEBHOOK_SECRET>
Content-Type: application/json

{ "emailMessageId": "<mongodb ObjectId>", "reason": "optional" }
```

## Gmail limitation

Gmail SMTP does **not** call this endpoint automatically. Use one of:

1. **Amazon SES / SendGrid / Postmark** — configure their bounce webhook to forward to Kasa with the `emailMessageId` from your send metadata (requires sending through that provider).
2. **Manual / scripted** — when you learn a message bounced, POST with the `EmailMessage` id from Communications → Sent log.

## What Kasa does on bounce

- Sets message status to `bounced`
- Appends a `bounced` event with optional `reason`
- Flags family deliverability after repeated failures (same as send failures)

## Verify

```bash
curl -X POST "$NEXTAUTH_URL/api/email/bounce" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $EMAIL_BOUNCE_WEBHOOK_SECRET" \
  -d '{"emailMessageId":"<id>","reason":"550 User unknown"}'
```

Expect `200` and `{ "ok": true }`.

## Env

Set `EMAIL_BOUNCE_WEBHOOK_SECRET` in production (see `.env.example`).
