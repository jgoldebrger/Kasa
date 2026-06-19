import bcrypt from 'bcryptjs'
import { User, InviteRequest } from '@/lib/models'
import { createPersonalOrganization } from '@/lib/auth-helpers'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { auth as authSchemas } from '@/lib/schemas'
import { z } from 'zod'
import { logError } from '@/lib/log'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const codeQuery = z.object({
  code: z.string().trim().min(1).max(120),
})

/**
 * GET /api/auth/signup?code=XXX — validate an invite code and return the
 * prefilled email/name so the signup form can display them.
 */
export const GET = handler({
  auth: 'public',
  query: codeQuery,
  name: 'GET /api/auth/signup',
  fn: async ({ query, request }) => {
    const verdict = await checkRateLimit(request, 'signup-code-lookup', {
      limit: 20,
      windowMs: 60 * 60_000,
    })
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const req = await InviteRequest.findOne({
      signupCode: query.code,
      status: 'approved',
    }).lean<any>()

    // Collapse all failure modes into a single opaque verdict. An
    // attacker enumerating signup codes shouldn't be able to distinguish
    // "valid code, just expired/used" (= keep trying) from "no such
    // code" (= move on). The signup form only needs valid/invalid.
    if (
      !req ||
      req.usedAt ||
      (req.signupCodeExpiresAt && new Date(req.signupCodeExpiresAt) < new Date())
    ) {
      return { data: { valid: false } }
    }
    return {
      data: {
        valid: true,
        email: req.email,
        name: req.name,
        orgName: req.orgName?.trim() || null,
      },
    }
  },
})

// Body excludes email; the authoritative email comes from the approved
// InviteRequest matched by inviteCode, not from form input. This
// prevents code theft from being used to register under a different
// email than the platform approved.
const signupBody = authSchemas.signupBody.omit({ email: true })

/**
 * POST /api/auth/signup — invite-gated signup.
 */
export const POST = handler({
  auth: 'public',
  body: signupBody,
  name: 'POST /api/auth/signup',
  fn: async ({ body, request }) => {
    const verdict = await checkRateLimit(request, 'signup', { limit: 5, windowMs: 15 * 60_000 })
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many signup attempts. Try again later.' } }
    }

    const req = await InviteRequest.findOne({
      signupCode: body.inviteCode,
      status: 'approved',
    })
    if (!req) return { status: 400, data: { error: 'Invalid or expired invitation code' } }
    if (req.usedAt) return { status: 409, data: { error: 'This invitation has already been used' } }
    if (req.signupCodeExpiresAt && new Date(req.signupCodeExpiresAt) < new Date()) {
      return { status: 410, data: { error: 'This invitation has expired' } }
    }

    const email = req.email
    if (!EMAIL_RE.test(email)) {
      return { status: 400, data: { error: 'Invitation has a malformed email' } }
    }

    const existing = await User.findOne({ email }).lean()
    if (existing) {
      return {
        status: 409,
        data: { error: 'An account with the invited email already exists. Please log in.' },
      }
    }

    const hashedPassword = await bcrypt.hash(body.password, 12)
    const user = await User.create({ email, hashedPassword, name: body.name })

    const orgName = req.orgName?.trim() || undefined
    let createdOrgName: string | undefined
    try {
      const org = await createPersonalOrganization(user._id.toString(), body.name, orgName)
      createdOrgName = org.name
    } catch (orgErr) {
      logError(orgErr, { module: 'signup', phase: 'createPersonalOrganization' })
    }

    req.usedAt = new Date()
    req.signupCode = undefined
    req.signupCodeExpiresAt = undefined
    await req.save()

    await audit({
      userId: user._id.toString(),
      action: 'auth.signup',
      resourceType: 'User',
      resourceId: user._id,
      metadata: { email, inviteRequestId: req._id?.toString() },
      request,
    })

    return { data: { ok: true, email, orgName: createdOrgName || orgName || null } }
  },
})
