import { handler } from '@/lib/api/handler'
import { InviteRequest, User } from '@/lib/models'
import { notifyPlatformAdminsOfInviteRequest } from '@/lib/platform-email'
import { checkRateLimit } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/auth/request-invite
 * Body: { email, name, message? }
 *
 * Public endpoint. Creates an InviteRequest in `pending` state which a
 * platform admin can later approve. Returns a generic OK regardless of
 * whether the email already has an account or a pending request, so this
 * endpoint can't be used for user enumeration either.
 */
export const POST = handler({
  auth: 'public',
  name: 'POST /api/auth/request-invite',
  fn: async ({ request }) => {
    const ipVerdict = await checkRateLimit(request, 'request-invite', {
      limit: 5,
      windowMs: 15 * 60_000,
    })
    if (!ipVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests. Try again later.' } }
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { error: 'Invalid body' } }
    }

    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : ''
    const orgName = typeof body.orgName === 'string' ? body.orgName.trim().slice(0, 200) : ''

    if (!name || name.length < 2 || name.length > 100) {
      return { status: 400, data: { error: 'Name must be 2-100 characters' } }
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return { status: 400, data: { error: 'Invalid email address' } }
    }
    if (!orgName || orgName.length < 2) {
      return { status: 400, data: { error: 'Organization name must be 2-200 characters' } }
    }

    // Per-email cap so an attacker rotating IPs can't churn requests for
    // a single inbox.
    const emailVerdict = await checkRateLimit(
      request,
      'request-invite-email',
      { limit: 2, windowMs: 60 * 60_000 },
      email,
    )
    if (!emailVerdict.allowed) {
      // Mimic success to avoid leaking that this email has hit the cap.
      return { data: { ok: true } }
    }

    // If they already have a real account, silently no-op. We don't reveal
    // that fact in the response.
    const existingUser = await User.findOne({ email }).select('_id').lean()
    if (existingUser) {
      return { data: { ok: true } }
    }

    // If they already have a pending or approved request, update the name +
    // message in place rather than spawning duplicates. Don't reset the
    // status of an already-approved request.
    const existing = await InviteRequest.findOne({
      email,
      status: { $in: ['pending', 'approved'] },
    })
    if (existing) {
      if (existing.status === 'pending') {
        existing.name = name
        existing.orgName = orgName
        existing.message = message
        await existing.save()
      }
      return { data: { ok: true } }
    }

    await InviteRequest.create({ email, name, orgName, message, status: 'pending' })

    await notifyPlatformAdminsOfInviteRequest({
      name,
      email,
      orgName: orgName || undefined,
    })

    return { data: { ok: true } }
  },
})
