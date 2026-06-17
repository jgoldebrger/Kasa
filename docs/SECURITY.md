# Security notes

## CRON_SECRET blast radius

`CRON_SECRET` is a shared bearer token used by scheduled jobs (Vercel Cron and similar) to call certain API routes without a user session.

**What a valid secret grants**

- Middleware (`app/auth.config.ts`) treats a request with a matching `x-cron-secret` or `Authorization: Bearer` value as authenticated **only** on routes listed in `CRON_API_PREFIXES` (e.g. `/api/jobs/*`, `/api/statements/auto-generate`, worker endpoints). Other `/api/*` routes still require a user session even with a valid cron secret.
- Route helpers (`requireOrgOrCron` in `lib/auth-cron.ts`) synthesize a **cron-scoped** org context (`isCron: true`, `role: 'member'`) for a valid MongoDB `organizationId` query parameter — no membership check, no user record. This context is **not** owner or admin.
- Cron auth is accepted only on handlers declared with `auth: 'cron'` or `auth: 'org-or-cron'`. Regular `auth: 'org'` routes reject cron requests at the handler boundary.

**Impact if leaked**

An attacker with `CRON_SECRET` can invoke cron-capable endpoints for **any organization** by supplying `?organizationId=<id>`, limited to the narrow surface area of cron-marked routes (scheduled jobs, statement generation, recurring payment processing, email workers — not general admin APIs).

**Mitigations in place**

- Secret comparison is constant-time (`lib/auth-cron-verify.ts`); middleware rejects invalid secrets (no header-presence bypass).
- Cron middleware bypass is path-scoped (`CRON_API_PREFIXES`), not blanket `/api/*`.
- Cron synthetic context uses `isCron: true` and does not satisfy `minRole: 'admin'` / `'owner'` on org-only routes; `contextHasMinRole()` returns false for cron callers.
- CSRF middleware skips origin checks only when the secret matches (`lib/csrf.ts`).
- Handlers re-verify via `isCronRequest()` / `requireOrgOrCron` and require a valid `organizationId` for cross-org cron calls.

## Per-job cron tokens (`/api/jobs/*`)

Chunked cron jobs self-call continuation URLs (next org batch, family worker batches). Those internal requests use **per-job HMAC tokens** (`lib/auth-cron-job.ts`) instead of the global bearer alone.

**Token format**

- Signed with HMAC-SHA256 keyed by `CRON_SECRET`.
- Payload: `{ jobName, organizationId?, exp }` (base64url JSON + signature).
- Passed as `x-cron-job-token` header or `jobToken` query parameter.
- Default TTL: 1 hour (`DEFAULT_CRON_JOB_TOKEN_TTL_MS`).

**Verification (`verifyCronJob`)**

1. Valid global `x-cron-secret` or `Authorization: Bearer <CRON_SECRET>` still accepts the request (Vercel Cron initial triggers).
2. Otherwise require a valid job token whose `jobName` matches the handler (e.g. `process-recurring-payments`).
3. When the URL includes `?organizationId=`, the token payload must carry the same `organizationId` — a leaked global secret cannot pivot continuation URLs to another tenant without forging a new signature.

**Operational guidance (per-job tokens)**

- Vercel Cron in `vercel.json` continues to send the global secret; no change required for scheduled ticks.
- Internal continuations from `lib/jobs.ts` attach signed job tokens automatically.
- Rotate `CRON_SECRET` if exposed; both global auth and job tokens derive from the same key.

**Operational guidance (global secret)**

- Generate a long random value (32+ bytes); rotate if exposed.
- Do not commit `CRON_SECRET` to git or log it in request traces.
- Scope cron handlers narrowly; prefer org-specific automation with audit logging where possible.

## Production environment variables

At server boot (`instrumentation.ts`) and on first DB connect, production validates:

| Variable                           | Requirement                                      |
| ---------------------------------- | ------------------------------------------------ |
| `CRON_SECRET`                      | Set, minimum 32 characters                       |
| `NEXTAUTH_SECRET` or `AUTH_SECRET` | Set, minimum 16 characters                       |
| `MONGODB_URI`                      | Set                                              |
| `ENCRYPTION_KEY`                   | Set (dedicated key; do not reuse session secret) |

Validation runs only when `NODE_ENV=production`. Development, test, and Vitest use placeholders from `vitest.setup.ts` and are unaffected.

## Encrypting legacy plaintext secrets

Older rows may store SMTP passwords and 2FA secrets as plaintext (`enc:v1:` prefix absent). `decrypt()` still reads them, but production logs a one-time warning when plaintext is encountered.

**Affected fields**

- `EmailConfig.password` (org SMTP credentials)
- `User.twoFactorSecret` (TOTP enrollment secret)

**Migration script**

Run against production (or staging) with `ENCRYPTION_KEY` set to the same value the app uses:

```bash
# Preview counts — no writes
npx tsx scripts/encrypt-legacy-secrets.ts --dry-run

# Encrypt in place
npx tsx scripts/encrypt-legacy-secrets.ts
```

The script connects via `MONGODB_URI` (from `.env.local` or the shell), finds documents whose values lack the `enc:v1:` prefix, encrypts them with `lib/encryption.ts`, and prints JSON counts only (no secret values). Re-run `--dry-run` after migration; both counts should be zero.

**Post-migration hardening (optional)**

After all legacy rows are encrypted, set `REJECT_LEGACY_PLAINTEXT_2FA=true` in production to refuse plaintext `twoFactorSecret` values at login and 2FA routes (clear error pointing to this doc). SMTP passwords continue to warn via `safeDecrypt()` until re-saved or migrated.

Ensure `ENCRYPTION_KEY` is set before migrating. After migration, rotating `NEXTAUTH_SECRET` no longer risks those at-rest values.

## JWT membership staleness

Session JWTs carry a compact org membership list refreshed on a ~30s interval. For elevated authorization:

- `requireOrg` always hits `OrgMembership` in the database when `minRole` is `'admin'` or `'owner'`, so role demotions and promotions take effect immediately on privileged routes.
- Member-level routes may still use the JWT fast path to avoid per-request DB lookups.
