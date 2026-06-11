# Runbook: Deploy and rollback (Vercel)

## When to use

- Planned production release
- A bad deploy is causing errors and you need to roll back quickly

## Prerequisites

- Vercel project access (deploy + env vars)
- MongoDB Atlas access (network allowlist, connection string)
- `CRON_SECRET`, `NEXTAUTH_URL`, Stripe live keys configured in Vercel

## Pre-deploy checklist

1. Confirm `MONGODB_URI` has no `tlsAllowInvalidCertificates` / `tlsInsecure` flags.
2. Set strong random values for `NEXTAUTH_SECRET`, `AUTH_SECRET`, and `ENCRYPTION_KEY`.
3. Set `NEXTAUTH_URL` to the production origin (e.g. `https://app.example.com`).
4. Set `CRON_SECRET` (see `.env.example`) — required for all `/api/jobs/*` cron routes.
5. Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` for production error tracking.
6. Whitelist Vercel egress IPs in Atlas **Network Access** (or use `0.0.0.0/0` only if your security policy allows).
7. Stripe: live keys + webhook endpoint pointing at `https://<domain>/api/stripe/webhook`.

## Deploy

```bash
npm run build          # local sanity check
vercel --prod          # or push to the production branch if CI deploys automatically
```

## Post-deploy smoke test

1. `curl -s https://<domain>/api/health` → `{"status":"ok","checks":{"mongodb":"ok"},...}`
2. Visit `/` in incognito → redirected to `/login` or `/welcome`.
3. `curl -s https://<domain>/api/families` (no cookie) → `401` JSON.
4. Log in as admin → org data loads.
5. Optional: trigger a password reset and confirm the email link works once.

## Rollback

### Option A — Vercel instant rollback (preferred)

1. Open **Vercel → Project → Deployments**.
2. Find the last known-good deployment.
3. Click **⋯ → Promote to Production** (or **Rollback**).

This restores the previous build and env snapshot without a new git commit.

### Option B — Git revert + redeploy

```bash
git revert <bad-commit-sha>
git push origin main   # or your production branch
```

Wait for CI / Vercel to finish the new deployment, then re-run the smoke test above.

## Verify cron jobs after deploy

KASA defines five crons in `vercel.json` (requires **Vercel Pro** for more than two cron jobs):

| Path | Schedule (UTC) |
| ---- | -------------- |
| `/api/jobs/cycle-rollover` | `0 1 * * *` |
| `/api/jobs/generate-monthly-statements` | `0 2 * * *` |
| `/api/jobs/process-recurring-payments` | `0 2 * * *` |
| `/api/jobs/send-monthly-statements` | `0 3 * * *` |
| `/api/jobs/wedding-converter` | `0 4 * * *` |

After rollback, confirm `CRON_SECRET` in Vercel env matches what cron invocations send (`Authorization: Bearer` or `x-cron-secret`).

## Escalation

- Persistent `503` on `/api/health` → see [db-restore.md](./db-restore.md) and Atlas status.
- Stripe payment issues after deploy → see [stripe-webhook-replay.md](./stripe-webhook-replay.md).
- Missed cron side effects → see [cron-failure.md](./cron-failure.md).
