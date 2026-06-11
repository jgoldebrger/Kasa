# NextAuth upgrade policy (KASA)

> **Status:** Active operational policy  
> **As of:** 2026-06-09  
> **Package pin:** `next-auth@5.0.0-beta.31` (exact version, no caret)

This document defines **when and how** KASA upgrades Auth.js / NextAuth. For architecture, env vars, and migration history, see [NEXTAUTH_V5_MIGRATION.md](./NEXTAUTH_V5_MIGRATION.md).

---

## Why we pin the beta

- npm **`latest`** for `next-auth` is still **v4**; KASA runs **v5** (Auth.js).
- The highest published v5 build is **`5.0.0-beta.31`**, which matches our pin.
- There is **no stable `5.0.0`** tag yet. Auth.js maintenance moved to the Better Auth team with **security/critical fixes** emphasis; a stable release is not guaranteed on a fixed timeline.
- KASA already uses the v5-native split config (`app/auth.config.ts` + `app/auth.ts`). The remaining work is **beta → stable** (or security patches), not v4 → v5.

**Policy:** Keep `next-auth` pinned to an **exact** version in `package.json` (no `^` or `~`). Document the pin in the `//peer-deps` comment. Do not bump casually on `npm update`.

---

## Monitoring

### Continuous

| Signal | Action |
|--------|--------|
| [next-auth GitHub releases](https://github.com/nextauthjs/next-auth/releases) | Watch for `5.0.0` stable, new betas, security advisories |
| [GitHub Security Advisories](https://github.com/nextauthjs/next-auth/security/advisories) | Treat **any** advisory affecting our pin as **P0** |
| `npm audit` in CI / locally | Investigate `next-auth` / `@auth/core` findings; cross-check maintainer guidance |
| Production auth metrics | Login error rate, 401 spikes on `/api/*`, middleware redirect loops, 2FA failures |

### Quarterly (lightweight)

- Confirm pinned version is still the **newest v5 beta** on npm (`npm view next-auth versions --json`).
- Re-read maintainer notes (Better Auth / Auth.js) for deprecation or EOL signals.
- Verify `AUTH_SECRET` and `NEXTAUTH_SECRET` remain set and identical in all deploy environments.

### Subscriptions (recommended)

- GitHub **Watch → Custom → Releases** on `nextauthjs/next-auth`.
- Optional: Dependabot or Renovate with **manual merge only** for `next-auth` (auto-merge disabled).

---

## Upgrade criteria

### Upgrade required (do within days)

1. **Security advisory** affecting `next-auth` or `@auth/core` at or below our pin → bump to the **patched** version named in the advisory.
2. **Exploit in the wild** against JWT session handling, CSRF, or credentials flow used by KASA → same-day assessment; patch or mitigate.

### Upgrade allowed (planned release)

1. **`5.0.0` stable** (or official RC with release notes) ships on npm → dedicated upgrade branch, full validation, staged deploy.
2. **Newer beta** that is explicitly recommended by maintainers for production and includes fixes we need (not cosmetic).

### Do not upgrade

- Routine `npm outdated` noise without a security or stable release reason.
- **Major** jumps without reading changelog (`beta.31` → hypothetical `6.x`).
- During freeze windows (e.g. year-end billing) unless security-critical.

---

## Upgrade procedure

1. **Branch:** `chore/next-auth-<version>` only — no unrelated changes.
2. **Changelog:** Read `5.0.0-beta.31…<target>` release notes; note `@auth/core`, cookie, JWT, or `authorized` callback changes.
3. **Bump:** Update `package.json` pin and run `npm ci`.
4. **Validate:**

```bash
npm run typecheck
npm run test -- lib/auth-helpers.integration.test.ts lib/auth-server.test.ts lib/auth-cron.unit.test.ts
npm run test:e2e -- e2e/auth.setup.ts
```

5. **Manual smoke:** Login → API call with session → org switch → password reset (forced re-login) → 2FA enroll/verify → platform-admin route.
6. **Staging:** Deploy; soak **24 hours** minimum.
7. **Production:** Low-traffic window; monitor login and 401 rates for 1 hour.

### Rollback triggers

Revert the pin and redeploy if any of the following appear after deploy:

- Widespread login failures or session loss
- Middleware redirect loops
- Authenticated APIs returning 401
- 2FA or password-reset regressions
- CSRF false positives on `/api/auth/*`

**Sessions:** Keep `AUTH_SECRET` unchanged across adjacent 5.0.0 betas/stable unless release notes require rotation.

---

## Custom logic that must survive bumps

Documented in [NEXTAUTH_V5_MIGRATION.md § Session / JWT behavior](./NEXTAUTH_V5_MIGRATION.md#session--jwt-behavior-to-preserve). Any upgrade PR must explicitly confirm these still pass integration tests and manual smoke.

---

## Strategic note (non-blocking)

Long-term, evaluate **Better Auth** or continued Auth.js support only as a **separate initiative**. This policy does not require migration off NextAuth v5 beta for normal operations.

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-06-09 | Stay on `5.0.0-beta.31` until stable `5.0.0` or security advisory |
| 2026-06-09 | Publish this policy; link from README deploy section |
