# SSO Evaluation for Kasa (Institution Tier)

**Date:** June 23, 2026  
**Status:** Evaluation complete — not implemented  
**Audience:** Product and engineering planning for enterprise (Institution) customers

## Executive summary

Kasa currently uses **credentials-based authentication** via NextAuth v5 (email + password, JWT sessions, optional TOTP 2FA). **SSO (SAML 2.0 / OIDC) is not implemented.** For Institution-tier buyers and larger kehillos with IT departments, SSO is frequently a procurement requirement.

**Recommendation:** Defer SSO until the first Institution customer with a firm requirement. When needed, implement **OIDC first** (faster integration with Google Workspace and Microsoft Entra ID), then add **SAML 2.0** if a customer requires it.

Estimated effort: **4–6 engineering weeks** for OIDC + JIT provisioning; **+2–3 weeks** for SAML and SCIM directory sync.

---

## Current authentication architecture

| Component  | Implementation                                                        |
| ---------- | --------------------------------------------------------------------- |
| Provider   | NextAuth v5 beta (`Credentials` provider only)                        |
| Session    | JWT, 7-day max, 24h sliding refresh                                   |
| 2FA        | TOTP + backup codes (optional per user, required for platform admins) |
| User model | Global `User` with `OrgMembership` pivot                              |
| Multi-org  | Users can belong to multiple organizations                            |

Relevant files:

- `app/auth.config.ts` — NextAuth configuration
- `lib/auth-helpers.ts` — `requireOrg()`, role checks
- `lib/models/user.ts`, `lib/models/org-membership.ts`

---

## Enterprise buyer requirements (typical)

| Requirement                     | Priority                           | Kasa today    |
| ------------------------------- | ---------------------------------- | ------------- |
| SAML 2.0 SSO                    | High for universities, federations | Not supported |
| OIDC (Google / Microsoft)       | High for modern IT                 | Not supported |
| SCIM provisioning               | Medium                             | Not supported |
| Enforced SSO (disable password) | Medium                             | Not supported |
| Domain verification             | Medium                             | Not supported |
| Per-org IdP configuration       | High                               | Not supported |

---

## Recommended approach

### Phase A — OIDC (preferred first ship)

**Why OIDC first:** Most kehilla IT stacks use Google Workspace or Microsoft 365. NextAuth supports OIDC providers natively. SAML often requires a bridge (e.g., BoxyHQ Jackson, WorkOS, or custom `samlify`).

**Scope:**

1. Add `OidcProvider` (or per-org dynamic OIDC) to NextAuth
2. Store per-organization IdP settings on `Organization`:
   - `ssoEnabled`, `ssoProvider` (`oidc`), `oidcIssuer`, `oidcClientId`, encrypted `oidcClientSecret`
   - `ssoEnforced` (disable password login for org members)
   - `ssoAllowedDomains` (e.g., `@kehilla.org`)
3. JIT provisioning: on first SSO login, create `User` + `OrgMembership` with default `member` role (admin promotes in Settings)
4. Admin UI in Settings → Security (owner-only) to configure and test SSO
5. Login page: "Sign in with SSO" when email domain matches configured org

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
