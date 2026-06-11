# KASA Security Testing Framework

Production-grade security testing for the KASA SaaS app using **Playwright**, optional **Burp-compatible proxy** routing, and **OWASP ZAP** Docker integration.

## Architecture

```
security/
├── auth/           # Session bootstrap, role helpers, Playwright setup project
├── config/         # Typed Zod config loaded from environment
├── helpers/        # Reusable attack probes (XSS, IDOR, CSRF, JWT, …)
├── payloads/       # Attack payload libraries
├── playwright/     # Fixtures, global setup/teardown, traffic capture
├── reports/        # JSON + HTML report generation
├── scanners/       # OWASP ZAP Docker integration
├── catalog/        # Generated API route inventory (role/tenant/CSRF matrix)
└── tests/          # Security specs including full API matrix
```

Traffic from Playwright browsers can be routed through Burp Suite, OWASP ZAP, or any HTTP(S) proxy. All requests, responses, headers, cookies, JWT/session artifacts, and storage snapshots are captured for reporting.

## Quick start (local)

```bash
# Install deps + Chromium (if not already)
npm ci
npx playwright install chromium

# Run full security suite against local dev server (auto-starts via e2e/start-dev.ts)
npm run security:test

# Interactive UI
npm run security:test:ui

# Guest-only probes (auth bypass, direct API access)
npm run security:test:guest

# Destructive probes disabled (staging-safe)
npm run security:test:safe
```

Reports are written to `security/reports/output/` (JSON + HTML) after the run completes.

## Environment configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SECURITY_ENV` | `local` | `local` \| `staging` \| `production-like` |
| `SECURITY_TARGET_URL` | `http://127.0.0.1:3000` | Base URL for all probes |
| `SECURITY_OWNER_EMAIL` | `e2e@kasa.test` | Owner login (matches e2e seed) |
| `SECURITY_OWNER_PASSWORD` | `E2eTestPass123!` | Owner password |
| `SECURITY_MEMBER_EMAIL` | `e2e-member@kasa.test` | Org member (RBAC tests) |
| `SECURITY_MEMBER_PASSWORD` | `E2eMemberPass123!` | Member password |
| `SECURITY_ORG_ALPHA` | `E2E Org Alpha` | Primary tenant for isolation tests |
| `SECURITY_ORG_BETA` | `E2E Org Beta` | Foreign tenant for IDOR tests |
| `SECURITY_ALLOW_DESTRUCTIVE` | `true` (local) | Stored XSS, upload abuse, API fuzzing |
| `SECURITY_PROXY_ENABLED` | auto if URL set | Route browser traffic through proxy |
| `SECURITY_PROXY_URL` | — | e.g. `http://127.0.0.1:8080` (Burp/ZAP) |
| `SECURITY_PROXY_IGNORE_TLS_ERRORS` | `true` | Required for MITM proxies |
| `SECURITY_ZAP_ENABLED` | `false` | Enable ZAP Docker helpers |
| `SECURITY_CAPTURE_HAR` | `true` | Write HAR files per authed page fixture |
| `SECURITY_REPORT_DIR` | `security/reports/output` | Report output directory |
| `CRON_SECRET` | — | Used to verify cron endpoint protection |

### Staging / production-like

```bash
SECURITY_ENV=staging \
SECURITY_TARGET_URL=https://staging.yourapp.com \
SECURITY_OWNER_EMAIL=sec-test@yourcompany.com \
SECURITY_OWNER_PASSWORD='...' \
SECURITY_ALLOW_DESTRUCTIVE=false \
npm run security:test:safe
```

Never enable destructive tests against production-like environments unless you have explicit authorization and isolated test data.

## Burp Suite integration

1. Start Burp and listen on `127.0.0.1:8080`.
2. Export Burp CA if needed: `security/certs/burp-ca.pem`
3. Run tests with proxy:

```bash
SECURITY_PROXY_URL=http://127.0.0.1:8080 \
SECURITY_PROXY_ENABLED=true \
npm run security:test
```

All Playwright browser contexts inherit the proxy. Inspect and replay traffic in Burp's HTTP history.

## OWASP ZAP integration

```bash
# Start ZAP daemon container (API :8080, proxy :8090)
npm run security:zap:up

# Point Playwright through ZAP proxy
SECURITY_PROXY_URL=http://127.0.0.1:8090 SECURITY_PROXY_ENABLED=true npm run security:test

# Passive baseline scan (requires app running)
npm run security:zap:baseline

# Active full scan — spider + active rules (authorized targets only)
npm run security:zap:full

# Stop container
npm run security:zap:down
```

Reports land in `security/reports/output/zap/`. In GitHub Actions, trigger **security** workflow with `run_zap_full: true` for active scanning.

## SAST (CodeQL + Semgrep)

| Tool | Workflow | Purpose |
|------|----------|---------|
| [CodeQL](.github/workflows/codeql.yml) | Push/PR + weekly | Deep JS/TS analysis, security queries |
| [Semgrep](.github/workflows/semgrep.yml) | Push/PR | Fast policy checks + custom rules in `.semgrep.yml` |

Local Semgrep (optional):

```bash
pip install semgrep
semgrep scan --config p/typescript --config p/nodejs --config .semgrep.yml --exclude node_modules --exclude .next
```

## RBAC role matrix

Seeded users (see `e2e/seed.ts`):

| User | Email | Alpha org | Beta org |
|------|-------|-----------|----------|
| Owner | `e2e@kasa.test` | owner | owner |
| Member | `e2e-member@kasa.test` | member | — |

`security/tests/rbac-matrix.spec.ts` verifies:

- Members cannot access admin-only routes (static list + catalog `minRole: admin`)
- Members can access member-level routes (`/api/families`, `/api/search`, …)
- Owners retain admin access

Credentials default from `SECURITY_MEMBER_*` env vars (see `.env.example`).

## API route catalog (full surface)

Every `app/api/**/route.ts` handler is scanned into `security/catalog/api-routes.json` with auth mode, min role, CSRF flag, and tenant scope.

```bash
# Regenerate after adding/changing API routes
npm run security:catalog:generate
```

`security/tests/api-route-matrix.spec.ts` runs five matrix checks against all **144** catalogued endpoints:

| Matrix | What it verifies |
|--------|------------------|
| Guest denied | Protected routes return 401/403 without session |
| Owner GET | Authenticated owner can reach org/session GET routes (<500, not 401) |
| CSRF missing Origin | All mutating routes reject requests with no Origin |
| CSRF evil Origin | All mutating routes reject cross-site Origin |
| Tenant header | Org-scoped GET routes reject non-member `x-organization-id` |

Dynamic path params (`:id`, `:memberId`, …) are resolved from E2E seed fixtures at runtime.

## Test categories

| Spec | Coverage |
|------|----------|
| `xss-reflected.spec.ts` | Search API + welcome page reflection |
| `xss-stored.spec.ts` | Task API stored XSS canary |
| `idor-cross-tenant.spec.ts` | Cross-tenant family access, org header spoofing |
| `admin-route-protection.spec.ts` | Admin API/UI gates, platform admin routes |
| `jwt-tampering.spec.ts` | Session cookie tampering, cleared session |
| `api-direct-access.spec.ts` | Unauthenticated API/page access, cron secret |
| `csrf.spec.ts` | Missing/evil Origin on state-changing requests |
| `rate-limit.spec.ts` | Concurrent `/api/search` burst (MongoDB-backed limiter in `lib/rate-limit.ts`) |
| `upload-and-fuzz.spec.ts` | Import/email upload abuse, API fuzzing |
| `tenant-isolation.spec.ts` | UI org scoping on `/families` |
| `api-route-matrix.spec.ts` | Full API catalog: auth, CSRF, tenant matrices |
| `rbac-matrix.spec.ts` | Owner vs member role enforcement |

## Helpers reference

Import from `security/helpers/`:

- **XSS** — `probeReflectedXss`, `probeStoredXssViaTask`
- **IDOR** — `testCrossTenantResourceAccess`, `testOrgHeaderSpoofing`
- **Auth** — `testUnauthenticatedAccess`, `testSessionTampering`
- **JWT/Session** — `testEncryptedSessionTampering`
- **CSRF** — `testMissingOriginBlocked`, `testEvilOriginBlocked`
- **Upload** — `runUploadAbuseSuite`
- **SSRF** — `probeSsrfInputs`
- **Rate limit** — `testRateLimitConcurrency` (shared counters in Mongo `RateLimit` collection)
- **Tenant** — `runTenantIsolationBattery`
- **Fuzzing** — `runDefaultFuzzSuite`
- **GraphQL** — `probeGraphQLExposure`
- **Mutation** — `mutateRequest`, `withOrgHeader`, `tamperCookieValue`
- **Capture** — `attachTrafficCapture`, `snapshotSession`

## Playwright fixtures

```typescript
import { test, assertSecurityPassed } from '../playwright/fixtures'

test('example', async ({ ownerContext, guestRequest, authedPage, secConfig }) => {
  // ownerContext — authenticated API/browser context (owner role)
  // guestRequest — unauthenticated APIRequestContext
  // authedPage — page with traffic capture + HAR
  // secConfig — typed SecurityConfig
})
```

Use `@guest-only` in test titles for probes that must run without a session.

## CI

| Workflow | When | What |
|----------|------|------|
| [security.yml](.github/workflows/security.yml) | PR + dispatch | Playwright suite, API catalog, RBAC matrix |
| [codeql.yml](.github/workflows/codeql.yml) | PR + weekly | CodeQL analysis |
| [semgrep.yml](.github/workflows/semgrep.yml) | PR | Semgrep SAST |
| [ci.yml](.github/workflows/ci.yml) | PR | Unit tests + build |

**security** workflow_dispatch inputs: `run_zap_full`, `allow_destructive`, `target_env`.

## Secrets handling

- Credentials come from environment variables or GitHub Actions secrets — never committed.
- `.env` is gitignored; copy `.env.example` and add `SECURITY_*` vars locally.
- Auth storage state is written to `security/playwright/.auth/` (gitignored).

## Prerequisites

- Node 18+
- Docker (for ZAP integration)
- Seeded E2E data (`e2e/seed.ts`) for cross-tenant tests — Alpha/Beta orgs with marker families
