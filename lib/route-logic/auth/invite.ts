import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { Types } from 'mongoose'
import { Invite, OrgMembership, User, Organization } from '@/lib/models'
import { createPersonalOrganization } from '@/lib/auth-helpers'
import { auth } from '@/app/auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { sendPlatformEmail, isPlatformEmailConfigured } from '@/lib/platform-email'
import { escapeHtml } from '@/lib/html-escape'
import { notifyAdmins } from '@/lib/notify'
import { password as passwordSchema } from '@/lib/schemas/common'
import { auth as authSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'
import { hashInviteToken, findInviteByToken, findInviteByTokenLean } from '@/lib/invite-token'

const INVITE_TTL_DAYS = 7

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: authSchemas.inviteUserBody,
  name: 'POST /api/auth/invite',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'invite-create',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { email, role } = body
    if (role === 'owner' && ctx!.role !== 'owner') {
      return { status: 403, data: { error: 'Only owners can invite other owners' } }
    }

    const existingUser = await User.findOne({ email }).lean<{ _id: any }>()
    if (existingUser) {
      const existingMembership = await OrgMembership.findOne({
        userId: existingUser._id,
        organizationId: ctx!.organizationId,
      })
      if (existingMembership) {
        return { status: 409, data: { error: 'User is already a member of this organization' } }
      }
    }

    await Invite.deleteMany({
      organizationId: ctx!.organizationId,
      email,
      acceptedAt: null,
    })

    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

    const invite = await Invite.create({
      organizationId: ctx!.organizationId,
      email,
      role,
      token: hashInviteToken(token),
      invitedById: ctx!.userId,
      expiresAt,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'invite.create',
      resourceType: 'Invite',
      resourceId: invite._id,
      metadata: { email, role },
    })

    const inviteUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/invite/${token}`

    const [org, inviter] = await Promise.all([
      Organization.findById(ctx!.organizationId).lean<{ name?: string }>(),
      User.findById(ctx!.userId).lean<{ name?: string; email?: string }>(),
    ])
    const orgName = org?.name || 'an organization on Kasa'
    const inviterLabel = inviter?.name || inviter?.email || 'A team member'

    let emailResult: { sent: boolean; reason?: string; error?: string } = {
      sent: false,
      reason: 'not attempted',
    }
    if (isPlatformEmailConfigured()) {
      emailResult = await sendPlatformEmail({
        to: email,
        subject: `You're invited to join ${orgName} on Kasa`,
        text:
          `${inviterLabel} has invited you to join "${orgName}" on Kasa as ${role}.\n\n` +
          `Accept the invite (expires in ${INVITE_TTL_DAYS} days):\n${inviteUrl}\n\n` +
          `If you weren't expecting this, you can safely ignore this email.\n`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; line-height: 1.6; color: #222;">
            <h2 style="margin: 0 0 12px;">You're invited to ${escapeHtml(orgName)}</h2>
            <p>${escapeHtml(inviterLabel)} has invited you to join <strong>${escapeHtml(orgName)}</strong> on Kasa as <strong>${escapeHtml(role)}</strong>.</p>
            <p style="margin: 20px 0;">
              <a href="${escapeHtml(inviteUrl)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Accept invitation</a>
            </p>
            <p style="color:#555;font-size:13px;word-break:break-all;">Or copy this URL: ${escapeHtml(inviteUrl)}</p>
            <p style="color:#888;font-size:12px;margin-top:30px;">This invitation expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can safely ignore the email.</p>
          </div>
        `,
      })
    }

    return {
      data: {
        id: invite._id.toString(),
        email,
        role,
        inviteUrl,
        expiresAt,
        email_result: emailResult,
      },
    }
  },
})

export const GET = handler({
  auth: 'public',
  name: 'GET /api/auth/invite',
  fn: async ({ request }) => {
    const token = request.nextUrl.searchParams.get('token')
    if (!token) return { status: 400, data: { error: 'Token required' } }

    const rateVerdict = await checkRateLimit(request, 'invite-resolve', {
      limit: 30,
      windowMs: 15 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const invite = await findInviteByTokenLean<{
      organizationId: any
      email: string
      role: string
      acceptedAt?: Date
      expiresAt: Date
    }>(token)
    if (!invite) return { status: 404, data: { error: 'Invite not found' } }
    if (invite.acceptedAt) return { status: 410, data: { error: 'Invite already accepted' } }
    if (invite.expiresAt < new Date()) return { status: 410, data: { error: 'Invite expired' } }

    const org = await Organization.findById(invite.organizationId).lean<{ name: string }>()

    return {
      data: {
        email: invite.email,
        role: invite.role,
        organizationName: org?.name || 'Organization',
        organizationId: invite.organizationId.toString(),
      },
    }
  },
})

export const PUT = handler({
  auth: 'public',
  name: 'PUT /api/auth/invite',
  fn: async ({ request }) => {
    const verdict = await checkRateLimit(request, 'invite-accept', {
      limit: 10,
      windowMs: 15 * 60_000,
    })
    if (!verdict.allowed) {
      return {
        status: 429,
        data: { error: 'Too many invite-acceptance attempts. Try again later.' },
      }
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { error: 'Request body required' } }
    }
    const parsed = authSchemas.acceptInviteBody.safeParse(body)
    if (!parsed.success) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      }
    }
    const { token, name: parsedName, password: parsedPassword } = parsed.data

    const invite = await findInviteByToken(token)
    if (!invite) return { status: 404, data: { error: 'Invite not found' } }
    if (invite.acceptedAt) return { status: 410, data: { error: 'Invite already accepted' } }
    if (invite.expiresAt < new Date()) return { status: 410, data: { error: 'Invite expired' } }

    const session = await auth()
    let userId: string

    if (session?.user?.id) {
      const user = await User.findById(session.user.id).lean<{ email: string; _id: any }>()
      if (!user) return { status: 404, data: { error: 'Account not found' } }
      if (user.email !== invite.email) {
        return {
          status: 403,
          data: { error: `This invite is for ${invite.email}. Please sign in as that user.` },
        }
      }
      userId = user._id.toString()
    } else {
      const name = typeof parsedName === 'string' ? parsedName.trim() : ''
      if (!name || name.length < 2 || name.length > 100) {
        return { status: 400, data: { error: 'Name must be 2-100 characters' } }
      }
      const passwordCheck = passwordSchema.safeParse(parsedPassword)
      if (!passwordCheck.success) {
        return {
          status: 400,
          data: { error: passwordCheck.error.issues[0]?.message || 'Invalid password' },
        }
      }
      const password = passwordCheck.data
      const existing = await User.findOne({ email: invite.email }).lean<{ _id: any }>()
      if (existing) {
        return {
          status: 409,
          data: {
            error:
              'An account with this email already exists. Please sign in first, then re-open the invite link.',
          },
        }
      }
      const hashedPassword = await bcrypt.hash(password, 12)
      const user = await User.create({ email: invite.email, hashedPassword, name })
      userId = user._id.toString()

      await createPersonalOrganization(userId, name)
    }

    const marked = await Invite.findOneAndUpdate(
      { _id: invite._id, acceptedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { acceptedAt: new Date() } },
    )
    if (!marked) {
      return { status: 410, data: { error: 'Invite already accepted or expired' } }
    }

    await OrgMembership.findOneAndUpdate(
      { userId, organizationId: invite.organizationId },
      { userId, organizationId: invite.organizationId, role: invite.role },
      { upsert: true, new: true },
    )

    await User.findByIdAndUpdate(userId, { lastActiveOrganizationId: invite.organizationId })

    await audit({
      organizationId: invite.organizationId.toString(),
      userId,
      action: 'invite.accept',
      resourceType: 'OrgMembership',
      metadata: { email: invite.email, role: invite.role },
    })

    await notifyAdmins(invite.organizationId, {
      kind: 'invite.accepted',
      title: `${invite.email} joined the team`,
      body: `Joined as ${invite.role}.`,
      link: '/settings?tab=members',
    })

    return {
      data: {
        ok: true,
        email: invite.email,
        organizationId: invite.organizationId.toString(),
      },
    }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'DELETE /api/auth/invite',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'invite-cancel',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = request.nextUrl.searchParams.get('id')
    if (!id || !Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Valid id required' } }
    }

    const inviteDoc = await Invite.findOne({
      _id: id,
      organizationId: ctx!.organizationId,
    }).select('email role')
    if (!inviteDoc) {
      return { status: 404, data: { error: 'Invite not found' } }
    }
    await Invite.deleteOne({ _id: id, organizationId: ctx!.organizationId })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'invite.cancel',
      resourceType: 'Invite',
      resourceId: id,
      metadata: { email: inviteDoc.email, role: inviteDoc.role },
      request,
    })

    return { data: { ok: true } }
  },
})
