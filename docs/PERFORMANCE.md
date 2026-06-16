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
|-------------|----------------------|---------------|
| Production  | 30                   | 2             |
| Development | 10                   | 0             |

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

| Index keys | Purpose |
|------------|---------|
| `{ organizationId: 1, paymentDate: -1 }` | Org payment lists, date-sorted |
| `{ organizationId: 1, familyId: 1, paymentDate: -1 }` | Family payment history |
| `{ organizationId: 1, familyId: 1, year: 1 }` | Year-scoped family totals |
| `{ organizationId: 1, stripePaymentIntentId: 1 }` (unique, partial) | Stripe idempotency per org |
| `{ stripePaymentIntentId: 1 }` (partial) | Webhook lookup by intent |

Source: `lib/models/payment.ts`.

## Client-side GET caching

Stable GET endpoints (`/api/payment-plans`, `/api/lifecycle-event-types`, `/api/organizations/branding`) use `cachedFetch` from `lib/client-cache.ts` where appropriate. Mutations use plain `fetch` and call `invalidate()` on the cached URL.
