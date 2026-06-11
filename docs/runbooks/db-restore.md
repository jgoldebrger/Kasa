# Runbook: MongoDB backup and restore

## When to use

- `/api/health` returns `503` with `"mongodb": "error"`
- Atlas alerts: cluster down, disk full, or replication lag
- Accidental data deletion or corruption requiring point-in-time recovery

## Prerequisites

- MongoDB Atlas project access (or self-hosted backup tooling)
- Vercel env access to update `MONGODB_URI` if restoring to a new cluster
- Maintenance window communicated to users (app will be unavailable or read-only during cutover)

## Triage — connectivity first

1. **Health check**

   ```bash
   curl -s https://<domain>/api/health | jq .
   ```

   Expect `status: "ok"`. A `503` confirms the app cannot reach MongoDB.

2. **Atlas checks**

   - Cluster status (paused? scaling?)
   - **Network Access** — Vercel egress IPs still allowed
   - **Database Access** — user/password not rotated without updating `MONGODB_URI`
   - Metrics — connections, disk, opcounters

3. **Connection string hygiene**

   Production `MONGODB_URI` must not include `tlsAllowInvalidCertificates` or `tlsInsecure`. `lib/database.ts` strips these on Vercel but fix the source in Atlas / env vars.

4. **Region alignment**

   Vercel deploys to `iad1` (US East). Atlas cluster should be in `us-east-1` for acceptable latency.

## Backup strategy (Atlas)

1. Enable **Cloud Backup** (continuous) on the production cluster.
2. Note the backup retention window (determines how far back you can restore).
3. For pre-migration safety, take a manual snapshot before major schema changes.

## Restore procedure (Atlas point-in-time)

1. Atlas → **Backup** → select cluster → **Restore**.
2. Choose **Point in Time** and pick a timestamp **before** the incident.
3. Restore to a **new** cluster (recommended) to avoid overwriting live data while validating.
4. Copy the new connection string.
5. Update `MONGODB_URI` in Vercel **Production** env vars.
6. Redeploy (or trigger env refresh) so serverless functions pick up the new URI.
7. Run post-restore smoke test:
   - `curl https://<domain>/api/health`
   - Log in and spot-check families, payments, recent statements
8. When satisfied, decommission the broken cluster or keep it for forensics.

## Restore to same cluster (destructive)

Only when a new cluster is not an option:

1. Atlas restore **overwrites** the target — all writes after the restore point are lost.
2. Put the app in maintenance mode (disable traffic or show a banner).
3. Perform restore; update `MONGODB_URI` only if the SRV host changed.
4. Run `node scripts/fix-indexes.js` if you see `E11000 duplicate key` on startup paths.

## Post-restore data gaps

Restoring to an earlier time means:

- Stripe charges after that point may not match local `Payment` rows — reconcile with Stripe Dashboard.
- Webhooks delivered during the gap may need replay — see [stripe-webhook-replay.md](./stripe-webhook-replay.md).
- Cron jobs may need manual catch-up — see [cron-failure.md](./cron-failure.md).

## Local / staging verification

Developers can point a staging Vercel preview or local `.env.local` at a restored clone cluster (never production credentials on laptops without approval).

```bash
# After updating MONGODB_URI locally
npm run dev
curl -s http://localhost:3000/api/health
```

## Escalation

- Cross-region failover or sharded cluster issues → MongoDB Atlas support ticket.
- Suspected ransomware or credential leak → rotate `MONGODB_URI` password, `ENCRYPTION_KEY` impact review (encrypted SMTP passwords may be unrecoverable if key is lost).
