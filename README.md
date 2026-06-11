# Kasa — Multi-Tenant Family Financial SaaS

Multi-tenant SaaS for tracking age-based membership payments and lifecycle
events (Chasena, Bar Mitzvah, births, etc.) across many family
organizations. Each organization owns its own families, members,
payments, statements and settings; users can belong to multiple
organizations with role-based access.

---

## Tech stack

| Layer        | Choice                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| Framework    | Next.js 14 (App Router) + React 18 + TypeScript                        |
| Styling      | Tailwind CSS                                                           |
| Auth         | NextAuth (Auth.js v5 beta) — credentials provider, JWT sessions        |
| Database     | MongoDB (Mongoose 7) — shared schema, per-row `organizationId` scoping |
| Payments     | Stripe (`@stripe/react-stripe-js`, server SDK)                         |
| Email        | Nodemailer (per-org SMTP + platform-level SMTP for system mail)        |
| PDF          | `pdf-lib`                                                              |
| Hebrew dates | `@hebcal/core`                                                         |

---

## Quick start

### 1. Prerequisites
- Node.js **18+**
- A MongoDB cluster (local or Atlas)
- (Optional) Stripe account for card payments
- (Optional) SMTP credentials for the platform-level sender

### 2. Install
```bash
npm install
```

### 3. Environment variables (`.env.local`)
```env
# Database
MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/kasa?retryWrites=true&w=majority

# Auth (generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# )
NEXTAUTH_SECRET=<random-base64>
AUTH_SECRET=<same-value-as-NEXTAUTH_SECRET>
NEXTAUTH_URL=http://localhost:3000

# At-rest encryption for stored SMTP passwords etc. (32+ bytes base64)
ENCRYPTION_KEY=<random-base64>

# Platform admins — comma-separated emails notified on new signup requests
# and allowed to review them at /admin/invite-requests
PLATFORM_ADMIN_EMAILS=admin1@example.com,admin2@example.com

# Platform SMTP — required to deliver signup-request admin alerts, password resets
PLATFORM_SMTP_HOST=smtp.gmail.com
PLATFORM_SMTP_PORT=587
PLATFORM_SMTP_USER=youraccount@gmail.com
PLATFORM_SMTP_PASS=<app-password>
PLATFORM_SMTP_FROM="Kasa Platform <youraccount@gmail.com>"

# Stripe (optional)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Set to true when behind a trusted reverse proxy so the rate limiter
# can read client IP from X-Forwarded-For / X-Real-IP. On Vercel this
# is automatic (VERCEL=1); set explicitly for other multi-instance hosts.
TRUST_PROXY_HEADERS=false
```

### 4. Run
```bash
npm run dev
# → http://localhost:3000
```

### 5. First-time setup
- `/login` first request → no users exist → use `/request-invite` to ask
  for an invite. A platform admin receives an email and approves it in
  the admin panel, which issues an invite code → use the code on
  `/signup` to create the first account and its personal workspace.
- Or, for an existing legacy single-tenant DB, run the multi-tenant
  migration once (see **Migration** below).

---

## Multi-tenancy model

- `User` — global accounts (email + bcrypt password)
- `Organization` — a tenant workspace; everything else is scoped to one
- `OrgMembership` — pivot table; user × org × role (`owner | admin | member`)
- All domain documents (`Family`, `Payment`, `PaymentPlan`, …) carry
  `organizationId` and are filtered by it on every read/write via
  `requireOrg(request)` in `lib/auth-helpers.ts`.
- Active org is held in a signed httpOnly cookie set by `OrgSwitcher`.

Role gates (`minRole: 'admin' | 'owner'`) protect destructive and
sensitive routes (deletes, SMTP send, member role changes, etc.).

---

## Features

### Family & member management
- CRUD for families, including Hebrew names for husband/wife/parents
- Add children with English + Hebrew names, gender, and birth date
- Per-member age computed against December 31st of each year

### Payment plans (fully per-organization)
Every organization defines its own list of payment plans in
**Settings → Payment Plans**. Each plan has a `name`, `planNumber`,
and `yearlyPrice`. There are no built-in plans, no default prices,
and no hard cap on how many plans an org can configure. Calculations
iterate the configured plans verbatim — adding a fifth plan
automatically adds a fifth row everywhere it matters.

### Lifecycle events (fully per-organization)
Event types are configured in **Settings → Event Types**. Each entry
has a `type` (lowercase identifier), `name` (human label), and default
`amount`. The yearly calculation, the events list, and the per-family
event form all read from this list — nothing is hardcoded.

### Optional automation (per organization)
**Settings → Automation** exposes three independent opt-in rules. Each
one no-ops when left blank.
- **Bar Mitzvah auto-assign payment plan** — when a male member reaches
  Bar Mitzvah age (Hebrew calendar), assign the selected plan.
- **Bar Mitzvah auto-create lifecycle event** — same trigger, record a
  lifecycle event payment of the selected type at that type's
  configured amount.
- **Child → family conversion default plan** — when a child member is
  converted to a family (wedding-date cron or the manual button), the
  new family is created with the selected plan.

### Payments
- Cash, Credit Card, Check, Quick Pay
- Stripe Elements for PCI-compliant card entry; cards can be saved
  (Stripe customer + payment method) and re-charged
- Optional **Monthly Payment** mode creates a `RecurringPayment` record
  that the cron processor charges every month against the saved card

### Statements
- Per-family monthly statements with opening balance, income,
  withdrawals, expenses, closing balance
- One-click bulk auto-generate for any month
- One-click email blast (per-org SMTP) with PDF attachment

### Yearly calculations
- Income = Σ (members in age group × plan price) + extra donations
- Expenses = Σ (lifecycle event payments in year) + extra expenses
- Balance = Income − Expenses
- Cached in `YearlyCalculation`; auto-recomputed when missing

### Dues calculator (`/projections`)
- Break-even recommendation: `dues = expected event expenses ÷ projected
  payers`. Surfaced as one headline number plus an Excel-style
  year-by-year table.
- "Expected event expenses" = Σ over lifecycle event types of
  `historicalAvgCount × currentCost`. The count comes from the last
  N years of `YearlyCalculation` snapshots (window picker: 3 / 5 / 10);
  the cost is whatever is configured today on the event type.
- "Projected payers" = current family count + average new families/yr.
  When the org has `barMitzvahAutoAssignPlanId` set, current and new
  bar-mitzvah-aged males also count as independent payers.
- Forecast horizon and start year are admin-controlled (5 / 10 / 20 /
  30 / 50 yr horizon, ±5 yr around today for the start year). Each row
  re-divides the same expected expense over the linearly-growing payer
  base, so larger years drive the recommended dues down.

---

## Security posture

This was hardened in a dedicated security pass. Highlights:

- **AuthN/AuthZ** on every API route (`requireSession` /
  `requireOrg({ minRole })`). Defaults to 401 JSON for unauthenticated
  API calls (no HTML redirects).
- **JWT sessions**: 7-day `maxAge`, 24-hour sliding `updateAge`,
  invalidated on password reset via `passwordChangedAt`.
- **Membership cache in JWT** — `requireOrg` reads role from token,
  falls back to DB on miss / 30s refresh window.
- **CSRF**: middleware rejects state-changing requests whose `Origin`
  or `Referer` doesn't match the host.
- **CSP**: strict per-request nonce-based CSP applied in **production**
  only (skipped in dev so Next.js HMR keeps working).
- **HTTP headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`.
- **Mass-assignment** prevented — all PUT/PATCH bodies are whitelisted.
- **XSS** — every interpolated user string in print/email HTML goes
  through `lib/html-escape.ts`.
- **IDOR** — every per-resource route asserts the resource belongs to
  the active org before responding.
- **Open redirect** — login `callbackUrl` is validated to same-origin.
- **At-rest encryption** — stored SMTP passwords are AES-256-GCM
  encrypted with `ENCRYPTION_KEY`.
- **Rate limiting** — MongoDB-backed distributed throttling (`RateLimit`
  collection, atomic `$inc`, TTL index for window expiry). Shared across
  all Node processes — no extra Redis required. IP + optional email keys on
  auth-sensitive routes; broader per-route scopes elsewhere. Honors proxy
  IP headers when `TRUST_PROXY_HEADERS=true` or on Vercel. Auth scopes
  fail closed if Mongo is unavailable; other scopes fail open.
- **Audit log** — `AuditLog` collection captures actor, IP, user-agent,
  resource and action for auth events and all CRUD-of-record mutations.
- **Platform admin 2FA** — users listed in `PLATFORM_ADMIN_EMAILS` must
  have two-factor authentication enabled (`User.twoFactorEnabled`) before
  accessing `/api/admin/*` routes or the `/admin/invite-requests` console.
  Requests without 2FA return `403` with code `PLATFORM_ADMIN_2FA_REQUIRED`.

---

## Performance posture

- Server: N+1 queries removed (Family member counts, plan-family
  counts, task family-member lookup all use grouped aggregations).
- Server: hot list endpoints return `.lean()` documents and set
  `Cache-Control: private, max-age=…, must-revalidate`.
- Server: `dashboard-stats` endpoint returns a small aggregated
  payload instead of shipping all families/payments to the client.
- Client: tiny `lib/client-cache.ts` with TTL + in-flight dedupe
  wraps every `fetch` call from React pages.
- Client: NextAuth session polling disabled
  (`refetchInterval={0}` / `refetchOnWindowFocus={false}`).
- Build: `modularizeImports` for `@heroicons/react/*` and `lodash`,
  `swcMinify`, `compress`, plus `serverComponentsExternalPackages`
  for Node-only deps.
- Auth: cache is purged on logout to avoid leakage on shared machines.

---

## Migration from pre-SaaS data

If you're upgrading from the pre-multi-tenant version of Kasa (no
`organizationId` on rows), run this **once**:

```bash
node scripts/migrate-to-multi-tenant.js \
  --email=youradmin@example.com \
  --password='YourLongStrongPassword' \
  --name=Admin \
  --backfill
```

The script is idempotent. It:
1. Upserts the admin `User`.
2. Creates a "Default Organization".
3. Sets the owner `OrgMembership`.
4. Backfills `organizationId` on every existing domain document.

If you hit `E11000 duplicate key` errors from stale legacy indexes,
run once:

```bash
node scripts/fix-indexes.js
```

---

## Cron jobs (automation)

Production cron entry points are HTTP routes under `/api/jobs/*`, secured
with `CRON_SECRET` (see `.env.example`). `vercel.json` ships with five
schedules — **Vercel Pro** is required (Hobby allows at most two cron jobs).

| API route | Purpose | Schedule (UTC) |
| --------- | ------- | -------------- |
| `/api/jobs/cycle-rollover` | Annual cycle rollover per org | `0 1 * * *` |
| `/api/jobs/generate-monthly-statements` | Generate previous-month statements | `0 2 * * *` |
| `/api/jobs/process-recurring-payments` | Charge due `RecurringPayment` rows | `0 2 * * *` |
| `/api/jobs/send-monthly-statements` | Email statements as PDF | `0 3 * * *` |
| `/api/jobs/wedding-converter` | Child → family conversion on wedding date | `0 4 * * *` |

Legacy CLI scripts (`scripts/generate-monthly-statements.js`, etc.) and
matching `npm run …` aliases remain for local or non-Vercel hosts. Ops
runbooks live in `docs/runbooks/`.

### Vercel Cron (`vercel.json`)

The committed `vercel.json` already lists all five `/api/jobs/*` paths.
Set `CRON_SECRET` in Vercel env vars before enabling production crons.

---

## Stripe — test cards

| Scenario               | Number                |
| ---------------------- | --------------------- |
| Success                | `4242 4242 4242 4242` |
| Decline                | `4000 0000 0000 0002` |
| Requires 3-D Secure    | `4000 0025 0000 3155` |

Use any future expiry, any 3-digit CVC, any 5-digit ZIP. Switch to
live keys (`pk_live_…` / `sk_live_…`) for production.

---

## Deploy

### Vercel (recommended)
1. `npm i -g vercel && vercel` from the project root.
2. Add the env vars from the [Environment variables](#3-environment-variables-envlocal)
   section in **Project Settings → Environment Variables**.
3. Redeploy with `vercel --prod`.

### Anywhere with Node 18+
```bash
npm install
npm run build
npm start    # serves on port 3000
```

### Pre-deploy checklist
- `MONGODB_URI` does **not** contain `tlsAllowInvalidCertificates` /
  `tlsInsecure` (the connection helper strips them in prod and warns,
  but fix the source).
- `NEXTAUTH_SECRET`, `AUTH_SECRET`, `ENCRYPTION_KEY` are real 32+ byte
  random values (not the dev placeholders).
- `NEXTAUTH_URL` is your real public origin.
- Atlas Network Access whitelists your deploy egress IPs.
- Stripe is switched to live keys; webhook secret matches the live
  endpoint — see [Stripe money flow & live webhook checklist](docs/STRIPE_MONEY_FLOW.md#live-webhook-setup-checklist).
- NextAuth stays on the pinned beta unless the [upgrade policy](docs/NEXTAUTH_UPGRADE_POLICY.md) says otherwise.
- Rate limiting is already distributed via MongoDB — safe for multiple
  Node instances out of the box. For sub-millisecond checks at very high
  QPS, consider swapping `lib/rate-limit.ts` for Redis / Upstash.

### Operations docs

| Doc | Purpose |
| --- | ------- |
| [docs/STRIPE_MONEY_FLOW.md](docs/STRIPE_MONEY_FLOW.md) | Platform Stripe account, PCI (SAQ A), org expectations vs Connect, live webhooks |
| [docs/NEXTAUTH_UPGRADE_POLICY.md](docs/NEXTAUTH_UPGRADE_POLICY.md) | Beta pin, monitoring, when to upgrade `next-auth` |
| [docs/NEXTAUTH_V5_MIGRATION.md](docs/NEXTAUTH_V5_MIGRATION.md) | v5 architecture, env vars, full migration notes |

### Post-deploy smoke test
1. `curl https://your-domain/api/health` → `{"status":"ok",...}` with Mongo up.
2. Visit `/` from incognito → redirected to `/login`.
3. `curl https://your-domain/api/families` (no cookie) → 401 JSON.
4. Log in as admin → your org's data loads.
5. Create a second account via `/request-invite` → admin approval →
   `/signup`; verify the new account sees an empty workspace.
6. Invite the second account into your org from
   **Settings → Members**; verify both can now see shared data.
7. Trigger a password reset; verify the reset link works once and is
   one-time-use.

---

## Troubleshooting

**Port 3000 in use** — `npm run dev` will pick the next free port; or
edit the `dev` script in `package.json`.

**Service worker showing blank page** — a stale dev SW was the cause.
`public/sw.js` is now a self-unregistering stub; clear site data once
and reload.

**MongoDB `E11000` on signup** — leftover legacy index. Run
`node scripts/fix-indexes.js` once.

**`Element type is invalid` after a Heroicons import** — clear the
build cache: delete `.next/`, restart `npm run dev`.

**Login looks broken after upgrading from beta NextAuth** — make sure
both `NEXTAUTH_SECRET` *and* `AUTH_SECRET` are set to the same value.

**Hard refresh** — Windows: `Ctrl + Shift + R`, Mac: `Cmd + Shift + R`.

---

## Testing

| Command | What it runs |
| ------- | -------------- |
| `npm test` | Vitest: `lib`, `api-routes`, `route-logic`, `app` (parallel) |
| `npm run test:coverage` | Coverage: **100% lines** on `lib/` + `app/api/**/route.ts` + `lib/route-logic/**` report |
| `npm run test:api-routes` | API route catalog integration only |
| `npm run test:route-logic-coverage` | Full API catalog against `lib/route-logic/**` (implementation coverage) |
| `npm run test:route-logic-coverage:report` | Same + list files still below 100% lines |
| `npm run app-smoke:generate` | Regenerate `app/components/ui/*.smoke.test.tsx` |
| `npm run route-logic:extract` | Move handler bodies from `lib/api-handlers` → `lib/route-logic` |
| `npm run test:coverage:report` | Coverage + list of files still below 100% |
| `npm run test:e2e` | Playwright smoke/regression (`e2e/`) |
| `npm run test:all` | Vitest + Playwright |

**Coverage policy (CI):**

- **`lib/**/*.ts`** — **100% lines** (`vitest.lib.config.ts`), excluding thin
  `lib/api-handlers/**` and `lib/route-logic/**`.
- **`app/api/**/route.ts`** + **`lib/api-handlers/**/handler.ts`** — **100% lines**
  (`vitest.api.config.ts`, per-file). Each file re-exports from **`lib/route-logic/**`**
  where the real handler code lives.
- **`lib/route-logic/**`** — implementation modules under `lib/route-logic/`. Integration
  tests import them directly (`routeSourceToLogicModule` in `lib/test/api-route-harness.ts`).
  Track progress with `npm run test:route-logic-coverage:report` (target **100% lines** per file;
  currently **~80%** aggregate lines). Shared success bodies live in
  `lib/test/catalog-probe-bodies.ts`; add branches in `lib/import-route-logic.integration.test.ts`,
  the sequential block `route-logic row coverage (gap order)` in
  `app/api/api-routes.integration.test.ts`, and `app/api/route-logic-finish.integration.test.ts`
  (gap-order finish pass: workers, cron jobs, families, invites, etc.).
- **`app/components/ui/**`** — smoke render tests (`*.smoke.test.tsx`, `app` Vitest
  project). Regenerate with `npm run app-smoke:generate`. Complex widgets (`DataView`,
  `ImportModal`, …) and page-level `*View.tsx` files are Playwright / manual next.

**API routes:** `app/api/api-routes.integration.test.ts` runs catalog + deep
probes (including multi-type `/api/import` and Stripe webhook events) against
in-memory Mongo (mocked session, Stripe, email, PDF). Sequential block covers
CSV/XLSX import paths and full 2FA enroll. Tests run concurrently with per-worker
`KASA_TEST_DB_NAME`. Regenerate the route inventory with `npm run security:catalog:generate`
when adding routes; re-extract handlers with `npm run api-handlers:extract` /
`npm run route-logic:extract` if logic is inlined into `route.ts` by mistake.

**E2E:** `npm run test:e2e` (Playwright) for full UI flows across pages not yet in Vitest.

---

## Project layout

```
KASA/
├── app/
│   ├── api/
│   │   ├── **/route.ts          Thin re-exports (100% line coverage gate)
│   │   └── (auth, families, payments, statements, …)
│   ├── components/              Shared React components
│   ├── (pages)                  /login, /signup, /families, /tasks, …
│   ├── auth.ts                  NextAuth options
│   ├── auth.config.ts           Session strategy / callbacks
│   └── middleware.ts            CSRF + CSP nonce injection
├── lib/
│   ├── api-handlers/            Thin re-exports → route-logic (mirrors app/api)
│   ├── route-logic/             API route implementations (mirrors app/api)
│   ├── auth-helpers.ts          requireSession / requireOrg
│   ├── audit.ts                 Audit log helper
│   ├── calculations.ts          Income / expense / balance engine
│   ├── client-cache.ts          Per-page fetch cache (TTL + dedupe)
│   ├── database.ts              Mongoose connection
│   ├── encryption.ts            AES-256-GCM helpers
│   ├── html-escape.ts           XSS-safe templating helper
│   ├── models.ts                All Mongoose schemas + indexes
│   ├── platform-admin.ts        PLATFORM_ADMIN_EMAILS check
│   ├── platform-email.ts        Platform SMTP sender
│   ├── rate-limit.ts            MongoDB-backed distributed rate limiter
│   ├── scheduler.ts             Cron orchestration helpers
│   └── …
├── public/                      Static assets + self-destruct sw.js
├── scripts/                     CLI cron + migration utilities
├── middleware.ts                CSRF + CSP (prod)
├── next.config.js               Headers, modularizeImports, etc.
└── package.json
```

---

## License

ISC
