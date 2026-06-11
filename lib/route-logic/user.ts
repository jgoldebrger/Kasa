/**
 * GET   /api/user — return the signed-in user's profile.
 * PATCH /api/user — update display name (and other safe profile fields).
 *
 * Email cannot be changed here on purpose — emails are the primary
 * identity key (used for invite matching, password reset, audit logs).
 * If we ever want to allow email change, it needs its own flow with a
 * verification email and re-issuing of all in-flight tokens.
 */

import { handler } from '@/lib/api/handler'
import { User } from '@/lib/models'
import { audit } from '@/lib/audit'
import { auth as authSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'session',
  name: 'GET /api/user',
  fn: async ({ session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'user-profile-get',
      { limit: 120, windowMs: 60_000 },
      session!.user.id,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const user = await User.findById(session!.user.id)
      .select('name email image twoFactorEnabled createdAt')
      .lean<{
        name?: string
        email?: string
        image?: string
        twoFactorEnabled?: boolean
        createdAt?: Date
      }>()
    if (!user) return { status: 404, data: { error: 'User not found' } }
    return {
      data: {
        name: user.name || '',
        email: user.email || '',
        image: user.image || null,
        twoFactorEnabled: !!user.twoFactorEnabled,
        createdAt: user.createdAt || null,
      },
    }
  },
})

export const PATCH = handler({
  auth: 'session',
  body: authSchemas.updateProfileBody,
  name: 'PATCH /api/user',
  fn: async ({ session, body, request }) => {
    const verdict = await checkRateLimit(
      request,
      'user-profile-update',
      { limit: 10, windowMs: 15 * 60_000 },
      session!.user.id,
    )
    if (!verdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const update: Record<string, unknown> = {}
    if (typeof body.name === 'string') update.name = body.name

    if (Object.keys(update).length === 0) {
      return { status: 400, data: { error: 'Nothing to update.' } }
    }

    const updated = await User.findByIdAndUpdate(
      session!.user.id,
      { $set: update },
      { new: true },
    )
      .select('name email')
      .lean<{ name?: string; email?: string }>()
    if (!updated) return { status: 404, data: { error: 'User not found' } }

    await audit({
      userId: session!.user.id,
      action: 'user.profile.update',
      resourceType: 'User',
      resourceId: session!.user.id,
      metadata: { fields: Object.keys(update) },
      request,
    })

    return { data: { name: updated.name, email: updated.email } }
  },
})
