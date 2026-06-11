# Security notes

## CRON_SECRET blast radius

`CRON_SECRET` is a shared bearer token used by scheduled jobs (Vercel Cron and similar) to call certain API routes without a user session.

**What a valid secret grants**

- Middleware (`app/auth.config.ts`) treats a request with a matching `x-cron-secret` or `Authorization: Bearer` value as authenticated for `/api/*` routes that are not already on the public allow-list.
- Route helpers (`requireOrgOrCron` in `lib/auth-cron.ts`) synthesize an **owner-level** org context for any valid MongoDB `organizationId` query parameter—no membership check, no user record.

**Impact if leaked**

An attacker with `CRON_SECRET` can invoke cron-capable endpoints for **any organization** by supplying `?organizationId=<id>`, with the same privileges as an org owner for those code paths (e.g. bulk jobs, statement runs—whatever each handler exposes to cron).

**Mitigations in place**

- Secret comparison is constant-time (`lib/auth-cron-verify.ts`); middleware rejects invalid secrets (no header-presence bypass).
- CSRF middleware skips origin checks only when the secret matches (`lib/csrf.ts`).
- Handlers should still call `isCronRequest()` / `requireOrgOrCron` and must require a valid `organizationId` for cross-org cron calls.

**Operational guidance**

- Generate a long random value (32+ bytes); rotate if exposed.
- Do not commit `CRON_SECRET` to git or log it in request traces.
- Scope cron handlers narrowly; prefer org-specific automation with audit logging where possible.
