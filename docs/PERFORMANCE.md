# Performance & infrastructure

Operational checklist for production latency and throughput. These items come from measured regressions on misconfigured deploys — not theoretical best practices.

## MongoDB Atlas region (required)

**Requirement:** The Atlas cluster MUST be in **AWS `us-east-1`** to match Vercel's `iad1` (US East, Virginia) region in `vercel.json`.

**Why:** Each cross-region round-trip adds ~50ms+. A typical KASA request makes dozens of MongoDB calls; misaligned regions have measured **~3× p50 latency** vs co-located deploys.

**How to verify**

1. Atlas → **Database** → your cluster → **Configuration** → **Cloud Provider & Region**.
2. Confirm **AWS / N. Virginia (us-east-1)**.
3. If the cluster is elsewhere, create a new cluster in `us-east-1`, migrate data, and update `MONGODB_URI` in Vercel env vars.

**Latency impact:** Same-region ≈ 1–5 ms per query. Cross-region (e.g. `us-west-2` → `iad1`) ≈ 50–80 ms per query, compounding across the request.

## Vercel Pro + Fluid Compute

**Requirement:** Vercel **Pro** (needed for >2 cron jobs in `vercel.json`) with **Fluid Compute** enabled.

**What it does:** In-function concurrency and warm instances reduce cold-start latency on API routes and server components. Most Next.js App Router workloads benefit with no code changes.

**Configuration**

- **Code:** `"fluid": true` is set in `vercel.json` (see `$schema` in that file).
- **Dashboard (if needed):** Project → **Settings** → **Functions** → enable **Fluid Compute**. As of April 2025, new projects default to on; older projects may need the toggle.

Fluid Compute cannot set function **memory** in `vercel.json` — adjust memory in the dashboard if profiling shows CPU-bound handlers.

## Connection pooling

MongoDB driver pool size is configured in `lib/database.ts`:

| Environment | Default `maxPoolSize` | `minPoolSize` |
| ----------- | --------------------- | ------------- |
| Production  | 30                    | 2             |
| Development | 10                    | 0             |

Override with the `MONGODB_MAX_POOL_SIZE` env var (positive integer). Useful when Atlas connection limits or Vercel concurrency change.

**When to tune:** Raise if logs show pool wait / timeout under concurrent load. Lower on Atlas M0/M2 tiers that cap connections (~500 shared).

See `.env.example` for the variable placeholder.

## YearlyCalculation snapshots (avoid `?compute=1`)

The dashboard reads financial totals from a cached **`YearlyCalculation`** document for the current cycle year. When no snapshot exists, `/api/dashboard-stats` returns zeros with `financialsPending: true` unless the client passes **`?compute=1`**, which runs a full **`calculateYearlyBalance`** inline — expensive on first load.

**Operational fix:** Admins should run **Calculate Year** on the [Calculations](/calculations) page (POST `/api/calculations`) at least once per cycle year. That writes the `YearlyCalculation` snapshot the dashboard and projections pages consume.

**After bulk imports or cycle rollover:** Re-run Calculate Year for affected years so the dashboard never falls back to `?compute=1`.

Payment and lifecycle-event writes schedule background recalculation in many paths, but the explicit admin action is the reliable way to keep snapshots warm.

## Payment compound indexes

The `Payment` model defines compound indexes for org-scoped list and balance queries. Ensure these exist in production (Mongoose creates them on connect if `autoIndex` is enabled, or run `db.payments.createIndex(...)` in Atlas):

| Index keys                                                          | Purpose                        |
| ------------------------------------------------------------------- | ------------------------------ |
| `{ organizationId: 1, paymentDate: -1 }`                            | Org payment lists, date-sorted |
| `{ organizationId: 1, familyId: 1, paymentDate: -1 }`               | Family payment history         |
| `{ organizationId: 1, familyId: 1, year: 1 }`                       | Year-scoped family totals      |
| `{ organizationId: 1, stripePaymentIntentId: 1 }` (unique, partial) | Stripe idempotency per org     |
| `{ stripePaymentIntentId: 1 }` (partial)                            | Webhook lookup by intent       |

Source: `lib/models/payment.ts`.

## Client-side GET caching

Stable GET endpoints (`/api/payment-plans`, `/api/lifecycle-event-types`, `/api/organizations/branding`) use `cachedFetch` from `lib/client-cache.ts` where appropriate. Mutations use plain `fetch` and call `invalidate()` on the cached URL.

## Vercel Speed Insights

**What it does:** The root layout mounts `<SpeedInsights />` from `@vercel/speed-insights` alongside the existing `WebVitals` component (which forwards Core Web Vitals to Sentry). Speed Insights sends real-user performance samples to Vercel's dashboard — complementary to Sentry's Web Vitals charts and error correlation.

**Dashboard:** Vercel project → **Speed Insights** tab. Review LCP, FCP, CLS, INP, and TTFB by route and device after production traffic accumulates. Use it to spot regressions after deploys; pair with Sentry Performance when investigating a specific slow page.

## Bundle analysis

Run `npm run analyze` to build the app with `@next/bundle-analyzer` enabled (`ANALYZE=true next build`). The report opens in the browser and shows which client chunks dominate the Settings, dashboard, and other App Router pages — useful after adding heavy tab panels or chart libraries.

## Settings tab lazy loading

The Settings page (`app/settings/SettingsView.tsx`) code-splits each tab panel with `next/dynamic`. Only the active tab's JavaScript is loaded on first visit; switching tabs fetches the panel chunk on demand. Initial `/settings` load stays lean even though the page defines many configuration sections.

## Projections server cache

`loadDuesRecommendation` in `lib/projections.ts` wraps the default forecast path in Next.js `unstable_cache` keyed by **organization id + history window years**, with **`revalidate: 3600`** (1 hour). The `/projections` RSC prefetch uses this cache; the `/api/dues-recommendation` route bypasses it when the client passes custom `forecastYears` or `startYear`. Re-run **Calculate Year** on [Calculations](/calculations) if admins need fresher numbers before the hour expires.

## MongoDB Atlas backup & point-in-time recovery

**Requirement:** Continuous backups with point-in-time recovery (PITR) enabled on the production Atlas cluster.

**Checklist**

1. Atlas → **Database** → your cluster → **Backup** → confirm **Cloud Backup** is on (M10+; M0/M2 use limited snapshot-only backup).
2. Enable **Point-in-Time Recovery** if the tier supports it; note the retention window (default 2 days on M10, longer on higher tiers).
3. Run a **test restore** quarterly: restore to a new cluster or download a snapshot, verify `MONGODB_URI` connectivity, and spot-check org/family/payment counts.
4. Document the Atlas project id, cluster name, and on-call restore steps in your internal runbook (who can trigger restore, how to rotate `MONGODB_URI` in Vercel after failover).

**Why:** Atlas PITR is the fastest path to recover from bad migrations, accidental bulk deletes, or ransomware-style corruption without replaying Stripe webhooks manually.

## Post-deploy: encrypt legacy secrets (dry run)

After each production deploy that touches encryption or auth models, run a **dry run** against production data (from a machine with prod `MONGODB_URI` + `ENCRYPTION_KEY`):

```bash
npx tsx scripts/encrypt-legacy-secrets.ts --dry-run
```

The script reports plaintext SMTP passwords and 2FA secrets still at rest. If counts are non-zero, run without `--dry-run` during a maintenance window (see `docs/SECURITY.md`). Boot-time validation in `lib/env-validation.ts` does not block on legacy plaintext — this script is the operational check.

## Vercel production branch

**Requirement:** Production deployments must come from the **`main`** branch only — no preview or feature branches promoted to production.

**How to verify**

1. Vercel → Project → **Settings** → **Git** → **Production Branch** = `main`.
2. Optionally enforce in repo config by adding to `vercel.json`:

   ```json
   "git": { "productionBranch": "main" }
   ```

3. Confirm preview deployments stay on non-production URLs and do not share production env vars unless explicitly configured.

Misconfigured branch rules have caused staging secrets and experimental code to reach production URLs.
