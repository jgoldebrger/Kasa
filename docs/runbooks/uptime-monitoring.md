# Runbook: Uptime monitoring

## When to use

- Setting up production monitoring before launch
- Responding to external uptime alerts
- Answering treasurer questions about availability

## Endpoints

| Endpoint          | Purpose                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health` | Machine-readable probe (JSON). Returns `200` when MongoDB is reachable, `503` otherwise. **Point external monitors here.** |
| `/status`         | Human-readable status page for prospects and staff.                                                                        |

### Health response shape

```json
{
  "status": "ok",
  "checks": { "mongodb": "ok" },
  "timestamp": "2026-06-23T12:00:00.000Z"
}
```

## Recommended setup

1. **External monitor** (Better Uptime, UptimeRobot, Pingdom, etc.)
   - URL: `https://<your-domain>/api/health`
   - Interval: 1–5 minutes
   - Alert on: HTTP status ≠ 200, or timeout > 30s

2. **Sentry** — set `SENTRY_DSN` in production for application errors (see `lib/log.ts`).

3. **Vercel** — enable deployment and function failure notifications in the Vercel project settings.

4. **Cron failures** — daily digest via `/api/jobs/ops-digest` (8:00 UTC in `vercel.json`). Also review `/admin/jobs` in the platform admin console.

## Pre-launch checklist

- [ ] `CRON_SECRET` set in Vercel (≥ 32 characters) — validated by `npm run check:env`
- [ ] `MONGODB_URI`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` set — validated in CI via `check:env`
- [ ] Stripe webhooks configured for platform subscriptions and Connect (see `docs/runbooks/stripe-webhook-replay.md`)
- [ ] `PLATFORM_SMTP_*` configured for invite-request emails
- [ ] Uptime monitor pointing at `/api/health`
- [ ] Legal pages reviewed by counsel before broad marketing (Terms, Privacy, DPA)

## Triage

| Symptom                   | Likely cause        | Action                                          |
| ------------------------- | ------------------- | ----------------------------------------------- |
| `/api/health` returns 503 | MongoDB unreachable | Check Atlas status, IP allowlist, `MONGODB_URI` |
| Health OK but app errors  | Application bug     | Check Sentry, Vercel function logs              |
| Cron jobs failing         | See cron runbook    | `docs/runbooks/cron-failure.md`                 |
