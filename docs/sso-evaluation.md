# SSO Evaluation for Kasa (Institution Tier)

**Date:** June 23, 2026  
**Status:** OIDC foundation implemented (env-configured); SAML not implemented  
**Audience:** Product and engineering planning for enterprise (Institution) customers

## Executive summary

Kasa uses **credentials-based authentication** via NextAuth v5 (email + password, JWT sessions, optional TOTP 2FA). **OIDC SSO** is available when platform env vars are set (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`). **SAML 2.0 is not implemented.** Per-organization IdP configuration in Settings is planned for a follow-up.

**Recommendation:** Use the env-configured OIDC path for the first Institution customer; add per-org Settings UI when a second IdP is needed. Add **SAML 2.0** only if a customer requires it.

Estimated effort remaining: **2–4 engineering weeks** for per-org OIDC config + enforced SSO; **+2–3 weeks** for SAML and SCIM directory sync.

---

## Current authentication architecture

| Component  | Implementation                                                        |
| ---------- | --------------------------------------------------------------------- |
| Provider   | NextAuth v5 (`Credentials` + optional env-configured `OIDC`)          |
| Session    | JWT, 7-day max, 24h sliding refresh                                   |
| 2FA        | TOTP + backup codes (optional per user, required for platform admins) |
| User model | Global `User` with `OrgMembership` pivot                              |
| Multi-org  | Users can belong to multiple organizations                            |
| OIDC JIT   | Pending invite or `OIDC_DOMAIN_ORG_MAP` domain→org slug               |

Relevant files:

- `app/auth.config.ts` — NextAuth edge configuration
- `app/auth.ts` — Credentials + OIDC providers, JIT provisioning hook
- `lib/oidc-config.ts` — env parsing (`OIDC_*`)
- `lib/oidc-provisioning.ts` — User + OrgMembership on first SSO login
- `lib/auth-helpers.ts` — `requireOrg()`, role checks
- `lib/models/user.ts`, `lib/models/org-membership.ts`

---

## Enterprise buyer requirements (typical)

| Requirement                     | Priority                           | Kasa today          |
| ------------------------------- | ---------------------------------- | ------------------- |
| SAML 2.0 SSO                    | High for universities, federations | Not supported       |
| OIDC (Google / Microsoft)       | High for modern IT                 | Env-configured (v1) |
| SCIM provisioning               | Medium                             | Not supported       |
| Enforced SSO (disable password) | Medium                             | Not supported       |
| Domain verification             | Medium                             | Not supported       |
| Per-org IdP configuration       | High                               | Not supported       |

---

## Recommended approach

### Phase A — OIDC (preferred first ship)

**Status (June 2026):** v1 foundation shipped — platform env vars only.

**Environment variables:**

| Variable              | Required | Description                                         |
| --------------------- | -------- | --------------------------------------------------- |
| `OIDC_ISSUER`         | Yes      | IdP issuer URL (e.g. `https://accounts.google.com`) |
| `OIDC_CLIENT_ID`      | Yes      | OAuth client ID                                     |
| `OIDC_CLIENT_SECRET`  | Yes      | OAuth client secret                                 |
| `OIDC_PROVIDER_NAME`  | No       | Login button label (default: `SSO`)                 |
| `OIDC_DOMAIN_ORG_MAP` | No       | `domain:org-slug` pairs for JIT provisioning        |

**Login flow:**

1. User opens `/login` → "Sign in with {provider}" when OIDC env is complete.
2. NextAuth redirects to the IdP (`openid email profile`).
3. On callback, `provisionOidcUser` runs:
   - **Existing user** with org membership → sign in.
   - **Pending invite** for email → create/link user, accept invite, assign invite role.
   - **Domain map** match → create/link user, add `member` role on mapped org.
   - **Otherwise** → reject (`AccessDenied`); credentials login still works for provisioned users.
4. JWT session is issued; org memberships refresh on the same path as credentials login.

**Why OIDC first:** Most kehilla IT stacks use Google Workspace or Microsoft 365. NextAuth supports OIDC providers natively. SAML often requires a bridge (e.g., BoxyHQ Jackson, WorkOS, or custom `samlify`).

**Remaining scope (v2):**

1. Per-organization IdP settings on `Organization`:
   - `ssoEnabled`, `ssoProvider` (`oidc`), `oidcIssuer`, `oidcClientId`, encrypted `oidcClientSecret`
   - `ssoEnforced` (disable password login for org members)
   - `ssoAllowedDomains` (e.g., `@kehilla.org`)
2. Admin UI in Settings → Security (owner-only) to configure and test per-org SSO
3. Login page: domain-aware SSO button when org IdP is configured

**Dependencies:**

- NextAuth upgrade path from beta (documented in README)
- `ENCRYPTION_KEY` for client secrets (already exists)
- Audit log events for SSO login / config changes

### Phase B — SAML 2.0

**Options:**

| Option                          | Pros                           | Cons                             |
| ------------------------------- | ------------------------------ | -------------------------------- |
| **WorkOS / BoxyHQ Jackson**     | Faster SAML + SCIM, maintained | Monthly cost, vendor dependency  |
| **Custom `samlify` + NextAuth** | No per-seat vendor fee         | High maintenance, XML edge cases |
| **Auth0 / Clerk migration**     | Full enterprise IAM            | Major auth rewrite, pricing      |

**Recommendation:** Use **WorkOS** or **BoxyHQ Jackson** as a SAML/OIDC bridge if a paying Institution customer requires SAML within 90 days. Avoid bespoke SAML unless cost is prohibitive.

### Phase C — SCIM (optional)

SCIM 2.0 enables automatic user provision/deprovision from Entra ID or Okta. Required only for customers with 50+ staff accounts. Implement after SSO adoption proves demand.

---

## Security considerations

- **Session binding:** SSO sessions must respect existing JWT refresh and org-switcher cookie model
- **Account linking:** Define policy when email matches existing credentials user (link vs. reject duplicate)
- **Owner lockout:** Require break-glass local admin or platform support path when `ssoEnforced` is true
- **Audit:** Log `auth.sso.login`, `auth.sso.config_change` in `AuditLog`
- **Tenant isolation:** IdP config is per-organization; never share client secrets across tenants

---

## Cost estimate

| Item                        | Estimate                      |
| --------------------------- | ----------------------------- |
| OIDC + per-org config + JIT | 4–6 weeks                     |
| SAML via bridge service     | +2–3 weeks integration        |
| SCIM provisioning           | +3–4 weeks                    |
| WorkOS / similar (if used)  | ~$100–500/mo depending on MAU |

---

## Decision matrix

| Scenario                                    | Action                                            |
| ------------------------------------------- | ------------------------------------------------- |
| Starter / Community customers               | No SSO needed; credentials + 2FA sufficient       |
| Institution prospect asks about SSO         | Share this doc; offer timeline post-contract      |
| Institution contract signed with SSO clause | Phase A (OIDC) minimum; Phase B if SAML specified |
| Federation / multi-site org                 | Prioritize SAML + SCIM                            |

---

## Alternatives considered

1. **Migrate entire auth to Clerk/Auth0** — Best long-term enterprise features but high migration cost and recurring fees. Not recommended until SSO revenue justifies it.
2. **Password + mandatory 2FA only** — Acceptable for small kehillos; insufficient for enterprise procurement.
3. **SAML-only without OIDC** — Covers legacy IdPs but misses Google/Microsoft OIDC path; OIDC should ship first.

---

## Next steps (when triggered by customer demand)

1. Confirm IdP type with prospect (Google, Entra, Okta, custom SAML)
2. Choose build vs. buy (WorkOS/Jackson vs. native OIDC)
3. Add `Organization.sso` schema fields and migration
4. Implement OIDC login flow and Settings admin UI
5. Update Trust page and security questionnaire
6. Add E2E tests for SSO login and enforced-SSO policy

---

## Contact

Product questions: support@kasa.com  
Security review: privacy@kasa.com
