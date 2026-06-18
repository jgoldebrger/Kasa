# NextAuth v5 Stable Upgrade Plan (KASA)

> **Status:** Research complete — no code changes applied yet.  
> **As of:** 2026-06-09  
> **Current version:** `next-auth@5.0.0-beta.31` (pinned)  
> **Operational policy:** [NEXTAUTH_UPGRADE_POLICY.md](./NEXTAUTH_UPGRADE_POLICY.md) (pin, monitoring, upgrade criteria)

## Executive summary

KASA **already runs Auth.js / NextAuth v5** using the recommended split-config pattern. There is **no stable v5 release on npm** today: `latest` remains `4.24.14`, and `beta` points to `5.0.0-beta.31` (the highest published v5 build). The practical upgrade path is therefore **not v4 → v5**, but **beta.31 → 5.0.0 stable** when (if) it ships, plus incremental beta bumps and env-var cleanup.

Auth.js maintenance transferred to the Better Auth team (Sept 2025). Expect **security and critical fixes only**; a stable `5.0.0` tag is not guaranteed on any timeline.

---

## Current dependencies

| Package      | Version                  | Notes                                                                               |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------- |
| `next-auth`  | `5.0.0-beta.31` (pinned) | Transitive `@auth/core@0.41.2`                                                      |
| `nodemailer` | `9.0.1`                  | Pinned via overrides for audit; used for platform SMTP, not NextAuth email provider |
| `next`       | `^14.2.33`               | App Router; compatible with v5                                                      |
| `bcryptjs`   | `^2.4.3`                 | Credentials `authorize()` only                                                      |

No `@auth/*-adapter` packages — JWT strategy, no database sessions.

---

## Current auth architecture (already v5-native)

```
app/auth.config.ts   → Edge-safe config (session, pages, authorized, base jwt/session)
app/auth.ts          → Full NextAuth({ ...authConfig, providers, jwt/session overrides })
middleware.ts        → NextAuth(authConfig) wrapper + CSRF + CSP
app/api/auth/[...nextauth]/route.ts → re-exports handlers from lib/route-logic
lib/auth-helpers.ts  → requireSession / requireOrg via auth()
lib/auth-server.ts   → getCachedAuth / getServerOrgContext via auth()
```

**Exports used:** `handlers`, `auth`, `signIn`, `signOut` from `NextAuth()` in `app/auth.ts`.

**Provider:** Credentials only (bcrypt + mongoose + TOTP in `authorize()`).

**Session strategy:** JWT (`maxAge` 7d, `updateAge` 24h).

**Custom JWT claims:** `id`, `isPlatformAdmin`, `memberships`, `pwdCheckedAt`.

**Cookie names (v5):** `authjs.session-token` / `__Secure-authjs.session-token` (see `security/auth/bootstrap.ts`).

---

## Release status (npm + maintainer signals)

| Dist-tag          | Version          | Meaning                            |
| ----------------- | ---------------- | ---------------------------------- |
| `latest`          | `4.24.14`        | v4 maintenance line                |
| `beta`            | `5.0.0-beta.31`  | **Newest v5 build** (KASA is here) |
| `canary` / `next` | 3.x / 4.0.0-next | Unrelated legacy tags              |

- v5 betas run `5.0.0-beta.0` … `5.0.0-beta.31` with **no RC or stable `5.0.0`** published.
- GitHub releases for `5.0.0-beta.31` (Apr 2025) are mostly `@auth/core` dependency bumps and provider fixes.
- Maintainers (now Better Auth team) state v5 is production-used but **no stable tag ETA**; new greenfield projects are steered toward Better Auth. Existing v5 apps should keep working with security patches.

**Implication for KASA:** Treat `5.0.0-beta.31` as the production baseline until a stable tag appears. The “upgrade” is low urgency unless a security advisory targets an older beta.

---

## Breaking changes reference

### v4 → v5 (already absorbed by KASA)

| v4                                                          | v5 (current KASA)                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `getServerSession(authOptions)`                             | `auth()` from `app/auth.ts`                                        |
| `[...nextauth].ts` default export / `NextAuth(authOptions)` | `export const { handlers, auth, signIn, signOut } = NextAuth(...)` |
| `next-auth/middleware`                                      | `NextAuth(authConfig)` middleware wrapper                          |
| `NEXTAUTH_*` env prefix                                     | `AUTH_*` preferred; `NEXTAUTH_*` still accepted                    |
| `next-auth.session-token` cookie                            | `authjs.session-token`                                             |
| Monolithic `authOptions`                                    | Split `auth.config.ts` (edge) + `auth.ts` (Node providers)         |

KASA has **no remaining v4 APIs** (`getServerSession`, `withAuth`, `NextAuthOptions`, `next-auth/middleware`).

### beta.31 → stable 5.0.0 (watch at upgrade time)

Review the [next-auth changelog](https://github.com/nextauthjs/next-auth/releases) between pinned beta and stable for:

- `@auth/core` major/minor bumps (JWT encoding, cookie names, CSRF behavior)
- `authorized` callback signature or redirect semantics
- Credentials `authorize(credentials, request)` typing
- Module augmentation paths (`next-auth/jwt`, `@auth/core/jwt`, `@auth/core/types`)
- Default cookie `secure` / `sameSite` changes in production
- Peer dependency changes (e.g. `nodemailer`, `next` minimum)

---

## Environment variables

### Today (`.env.example` / `.env.local`)

| Variable                | Role                                                      | v5 canonical?                       |
| ----------------------- | --------------------------------------------------------- | ----------------------------------- |
| `AUTH_SECRET`           | JWT signing                                               | **Yes** (v5 primary)                |
| `NEXTAUTH_SECRET`       | JWT signing fallback                                      | Legacy alias; still read by Auth.js |
| `NEXTAUTH_URL`          | Canonical app URL                                         | Legacy; v5 also accepts `AUTH_URL`  |
| `PLATFORM_ADMIN_EMAILS` | Custom; read in jwt callback                              | App-specific                        |
| `ENCRYPTION_KEY`        | TOTP/SMTP encryption; dev fallback uses `NEXTAUTH_SECRET` | App-specific                        |

### Recommended cleanup (non-breaking, post-stable)

1. Set **`AUTH_SECRET`** and **`AUTH_URL`** as primary in deployment config.
2. Keep **`NEXTAUTH_SECRET`** and **`NEXTAUTH_URL`** duplicated during one release cycle for:
   - `lib/encryption.ts` dev fallback
   - `lib/jobs.ts` / `lib/route-logic/admin/invite-requests.ts` base URL
   - `security/config/environments.ts`
   - `e2e/start-dev.ts`
3. After code sweep, document `AUTH_*` only in `.env.example`; remove `NEXTAUTH_*` reads in app code (not required for NextAuth itself).

**No env rename is required for the beta → stable package bump** if both secret aliases remain set.

---

## Session / JWT behavior to preserve

Custom logic in `app/auth.ts` must survive any library bump:

1. **Password revocation:** `passwordChangedAt` vs token `iat` (strict `>` comparison).
2. **Membership cache:** `token.memberships` refreshed every `TOKEN_REFRESH_TTL_SEC` (30s).
3. **Fail-closed:** Mongo errors during revocation check delete `token.id`.
4. **2FA:** TOTP replay guard + atomic backup-code consume in `authorize()`.
5. **Platform admin:** `isPlatformAdmin` from `PLATFORM_ADMIN_EMAILS` in edge jwt callback.
6. **Session projection:** `session.user.memberships` from token in session callback.

**Upgrade validation:** After any `next-auth` bump, run login → API call → password reset → confirm forced re-login → org switch → platform-admin route access.

---

## Test impact matrix

| Area                                 | Files                                                                                           | Action on upgrade                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Unit / integration (mocked `auth()`) | `lib/auth-helpers.integration.test.ts`, `lib/auth-server.test.ts`, `lib/auth-cron.unit.test.ts` | **No changes expected** — mocks `@/app/auth`, not NextAuth internals |
| Vitest global env                    | `vitest.setup.ts`                                                                               | Already sets `AUTH_SECRET` + `NEXTAUTH_SECRET`                       |
| Route-logic / api-routes harness     | `app/api/api-routes.integration.test.ts`, `vitest.route-logic.setup.ts`                         | **Do not edit** per workstream rules; mocks `auth`                   |
| E2E login                            | `e2e/auth.setup.ts`, `security/auth/bootstrap.ts`                                               | Re-run after bump; UI flow unchanged                                 |
| Security probes                      | `security/helpers/auth-testing.ts`                                                              | Verify cookie tamper still 401s; cookie names already v5             |
| CSRF allow-list                      | `lib/csrf.ts`, `middleware.ts`                                                                  | Confirm `/api/auth/*` paths still exempt                             |

**Suggested commands after package bump:**

```bash
npm run typecheck
npm run test -- lib/auth-helpers.integration.test.ts lib/auth-server.test.ts lib/auth-cron.unit.test.ts
npm run test:e2e -- e2e/auth.setup.ts
npm run security:test:safe   # if staging available
```

---

## Rollout plan

### Phase 0 — Now (no package change)

- [x] Confirm v5-native architecture (done).
- [ ] Subscribe to [next-auth releases](https://github.com/nextauthjs/next-auth/releases) and security advisories.
- [ ] Document pin rationale in `package.json` comment (already present).

### Phase 1 — When `5.0.0` stable (or newer beta with security fix) ships

1. Read changelog `5.0.0-beta.31…target`.
2. Bump `next-auth` in a dedicated branch; run `npm ci`.
3. Run validation commands above + manual login/2FA/password-reset smoke.
4. Deploy to staging; soak 24h.
5. Deploy production in low-traffic window.

### Phase 2 — Optional hardening (separate PRs)

- Migrate app code from `NEXTAUTH_URL` → `AUTH_URL` (dual-read transition).
- Add a thin `lib/auth-env.ts` helper for secret/URL resolution.
- Evaluate long-term Auth.js vs Better Auth (strategic; not blocking).

---

## Rollback plan

1. Revert `package.json` / `package-lock.json` to `next-auth@5.0.0-beta.31`.
2. `npm ci` and redeploy previous build artifact.
3. **Sessions:** JWT cookies signed with the same `AUTH_SECRET` should remain valid across adjacent 5.0.0 betas/stable **unless** the release notes mention JWT/cookie breaking changes. If they do, plan a forced logout (secret rotation or `updateAge` zero) during maintenance.

**Rollback trigger:** login failures, middleware redirect loops, 401 spikes on authenticated APIs, 2FA regressions, or CSRF false positives on `/api/auth/*`.

---

## Risk summary

| Risk                            | Likelihood | Mitigation                                           |
| ------------------------------- | ---------- | ---------------------------------------------------- |
| Stable `5.0.0` never ships      | Medium     | Stay pinned; security patches on beta line           |
| Breaking change in final stable | Low–medium | Staged rollout + changelog review                    |
| Auth.js maintenance stagnation  | Medium     | Monitor advisories; long-term Better Auth evaluation |
| Session invalidation on bump    | Low        | Staging soak; keep secrets unchanged                 |

---

## Decision

**Do not upgrade package.json today.** KASA is on the latest v5 beta with a correct v5 architecture. The next actionable step is **watch for `5.0.0` stable or a security advisory**, then bump with the validation checklist above. Env-var consolidation (`AUTH_*` primary) is independent and can ship as a small follow-up.
