/**
 * Shared zod primitives for request validation.
 *
 * Reuse these everywhere so we get consistent error messages and avoid
 * hand-rolling the same checks (objectId, email, password) across files.
 */

import { z } from 'zod'

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id')

export const email = z.string().trim().toLowerCase().email('Invalid email address').max(254)

/**
 * Password policy.
 *
 * Length 10+ (NIST SP 800-63B picks 8 as the floor; we bump to 10 to
 * account for accounts that grant admin privileges over money +
 * children's personal data — the threat model is small but motivated).
 *
 * Composition rule: at least three of {lowercase, uppercase, digit,
 * symbol}. Permissive enough that a typed-out passphrase still passes
 * ("correct horse battery staple!") while rejecting the obvious
 * "Password1" / "12345678" floor.
 *
 * Reject the most common weak passwords up front so the breach-check
 * service we may bolt on later doesn't have to. A real Pwned-Passwords
 * k-anonymity check is the right long-term answer.
 */
const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456789',
  '12345678',
  'qwertyuiop',
  'letmein',
  'welcome',
  'welcome1',
  'iloveyou',
  'admin',
  'admin123',
  'kasa',
  'kasa1234',
])

export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password too long')
  .refine(
    (s) => {
      let classes = 0
      if (/[a-z]/.test(s)) classes += 1
      if (/[A-Z]/.test(s)) classes += 1
      if (/[0-9]/.test(s)) classes += 1
      if (/[^A-Za-z0-9]/.test(s)) classes += 1
      return classes >= 3
    },
    {
      message: 'Password must include at least three of: lowercase, uppercase, number, symbol.',
    },
  )
  .refine((s) => !WEAK_PASSWORDS.has(s.trim().toLowerCase()), {
    message: 'That password is too common. Please pick something less guessable.',
  })

/** A non-empty trimmed string, capped to a sane length. */
export const nonEmptyString = (max = 500) =>
  z.string().trim().min(1, 'Required').max(max, `Must be ${max} chars or fewer`)

/** Trimmed display name — min 1 char, max 200. Use for family/plan/event/task titles. */
export const trimmedName = nonEmptyString(200)

/** Optional trimmed string — empty/null/undefined normalised to undefined. */
export const optionalTrimmedString = (max = 1000) =>
  z
    .union([z.string().trim().max(max), z.literal('')])
    .nullish()
    .transform((v) => (v ? v : undefined))

/** Calendar year query/body param (1900–2200). */
export const yearParam = z.coerce.number().int().min(1900).max(2200)

/** Positive integer (for limits, counts, etc.). */
export const positiveInt = z.coerce.number().int().min(1)

/** A string that may be empty, undefined, or null — normalised to undefined.
 *
 * Zod v4 changed how `z.undefined()` works inside a union — it no longer
 * makes the field itself omittable. The field has to be marked `.optional()`
 * (or `.nullish()`) explicitly, or zod rejects the missing key as
 * "expected nonoptional, received undefined". */
export const optionalString = (max = 1000) =>
  z
    .union([z.string().trim().max(max), z.literal('')])
    .nullish()
    .transform((v) => (v ? v : undefined))

/** Coerce strings <-> dates so JSON bodies (with ISO strings) just work. */
export const isoDate = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Invalid date')

/** Money value. Two decimal places max; bounded for sanity. */
export const moneyAmount = z
  .number()
  .finite('Must be a finite number')
  .nonnegative('Must be ≥ 0')
  .lte(10_000_000, 'Amount too large')
  // Reject sub-cent precision (eg `10.999`). Without this the value
  // survives validation, then Math.round(amount * 100) silently
  // truncates and the Stripe charge total no longer matches the ledger
  // entry by 1¢. Use a tiny epsilon to absorb the usual binary-FP
  // representation error (.1 + .2 etc).
  .refine(
    (n) => {
      const cents = n * 100
      return Math.abs(cents - Math.round(cents)) < 1e-6
    },
    { message: 'Amount must have at most 2 decimal places' },
  )

export const role = z.enum(['owner', 'admin', 'member', 'treasurer', 'communications'])

/**
 * Cursor pagination primitives used by list endpoints.
 *
 * - `limit` caps the number of rows returned (server enforces 1..500). When
 *   absent, the endpoint applies the unbounded-path ceiling below so a
 *   single request can never pull the entire collection.
 * - `cursor` is the ObjectId of the last row from the previous page; the
 *   route filters with `_id <op> cursor` based on its sort direction.
 */
export const paginationLimit = positiveInt.max(500).optional()

/**
 * Server-side ceiling applied when a list endpoint is called without an
 * explicit `?limit=`. Legacy callers expect a flat array of "everything",
 * so we keep that shape but silently bound the worst case — without it,
 * any authenticated org member could DoS the API by GET-ing
 * /api/payments and force the serverless runtime to materialise every
 * payment in the org.
 *
 * Chosen high enough (1,000) that no real UI screen hits it in practice;
 * orgs that genuinely need more rows should opt in to `?limit=&cursor=`
 * pagination.
 */
export const UNBOUNDED_LIST_CAP = 1000

/** Max family IDs per scoped GET /api/families/balances request. */
export const FAMILY_BALANCES_IDS_CAP = 100

export const paginationCursor = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'Invalid cursor')
  .optional()
