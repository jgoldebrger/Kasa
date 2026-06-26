# Runbook: Cron job failure

## When to use

- A scheduled job did not run (missing statements, unpaid recurring charges, etc.)
- Vercel Cron logs show `401`, `429`, `500`, or no invocation
- `JobRun` rows in MongoDB show `status: 'failed'`

## Architecture

Cron entry points live under `/api/jobs/*`. **Vercel Hobby** runs one scheduled trigger: `GET/POST /api/jobs/tick` every 15 minutes (`vercel.json`), which invokes the job routes below. Individual routes remain available for manual replay.

Each route:

- Authenticates via `CRON_SECRET` (`x-cron-secret` or `Authorization: Bearer`)
- Uses distributed locks (`lib/cron-lock.ts`) to prevent duplicate runs
- Writes per-batch audit rows to the `JobRun` collection
- Chunks large org lists and may self-call for the next cursor

| Job                 | Path                                    | Typical symptom                    |
| ------------------- | --------------------------------------- | ---------------------------------- |
| Cycle rollover      | `/api/jobs/cycle-rollover`              | Wrong cycle year on orgs           |
| Generate statements | `/api/jobs/generate-monthly-statements` | Missing monthly statements         |
| Process recurring   | `/api/jobs/process-recurring-payments`  | Saved cards not charged            |
| Send statements     | `/api/jobs/send-monthly-statements`     | Families did not receive PDF email |
| Wedding converter   | `/api/jobs/wedding-converter`           | Children not converted to families |
| Scheduled comms     | `/api/jobs/send-scheduled-emails`       | Pending communications not sent    |
| Email drips         | `/api/jobs/run-email-drips`             | Automation rules not firing        |
| Ops digest          | `/api/jobs/ops-digest`                  | No daily failure email to admins   |

CLI equivalents exist for some jobs (`npm run generate-statements`, etc.) but production should use the API routes with `CRON_SECRET`.

## Triage

### 1. Check Vercel Cron logs

**Vercel → Project → Cron Jobs** — confirm the schedule fired and note HTTP status.

### 2. Check application logs / Sentry

Search for the route name (e.g. `POST /api/jobs/generate-monthly-statements`). `lib/log` and Sentry capture handler errors when `SENTRY_DSN` is set.

### 3. Query `JobRun` in MongoDB

```javascript
db.jobruns.find({ name: 'generate-monthly-statements' }).sort({ startedAt: -1 }).limit(5)
```

Look for `status: 'failed'`, `lastError`, and `errors[]`.

### 4. Common root causes

| Symptom                                | Likely cause                                                 | Fix                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized`                     | `CRON_SECRET` mismatch or missing in Vercel env              | Align secret; redeploy                                                                                                                               |
| `401` + HTML `Authentication Required` | Vercel Deployment Protection blocking internal HTTP (legacy) | `process-recurring-payments` now calls billing logic in-process; redeploy latest. Or disable protection / use automation bypass for other self-calls |
| `429 Too many requests`                | Rate limit hit (`checkRateLimit` on cron scope)              | Wait for window; investigate duplicate triggers                                                                                                      |
| Lock skipped (200 but no work)         | Another instance holds `JobLock` for the same tick           | Wait for TTL (~15 min) or inspect `joblocks` collection                                                                                              |
| `500` + Mongo errors                   | Atlas outage, IP block, bad URI                              | Fix connectivity; see [db-restore.md](./db-restore.md)                                                                                               |
| Job ran but org skipped                | Org automation disabled or schedule day mismatch             | Check org **Settings → Automation** and calendar day config                                                                                          |

## Manual replay

Replace `<domain>`, `<secret>`, and adjust path for the failed job.

```bash
curl -X POST "https://<domain>/api/jobs/generate-monthly-statements" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json"
```

For chunked jobs that stopped mid-way, pass the cursor from the last `JobRun.cursorOut`:

```bash
curl -X POST "https://<domain>/api/jobs/generate-monthly-statements?cursor=<orgId>" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

**Safety:** Locks prevent double-processing for the same logical tick. If a job partially completed, inspect domain data (statements, payments) before replaying to avoid duplicates.

## Prevention

- Keep `CRON_SECRET` rotated only with a coordinated Vercel env update.
- Monitor `/api/health` — cron jobs depend on MongoDB.
- Hobby plan: one Vercel cron (`/api/jobs/tick`); Pro is only needed if you split jobs into separate `vercel.json` entries again.
- Set `SENTRY_DSN` so cron 500s page on-call.

## Escalation

- Data corruption or duplicate charges → stop manual replays; restore from backup if needed ([db-restore.md](./db-restore.md)).
- Stripe charge disputes after a bad recurring run → [stripe-webhook-replay.md](./stripe-webhook-replay.md).
