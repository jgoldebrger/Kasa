import crypto from 'crypto'
import { Types } from 'mongoose'
import { InviteRequest } from '@/lib/models'
import {
  sendPlatformEmail,
  isPlatformEmailConfigured,
  sendInviteRequestRejectionEmail,
} from '@/lib/platform-email'
import { escapeHtml } from '@/lib/html-escape'
import { checkRateLimit } from '@/lib/rate-limit'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { handler } from '@/lib/api/handler'

const SIGNUP_CODE_TTL_DAYS = 14

/**
 * GET /api/admin/invite-requests
 * Platform-admin only. Lists all invite requests, newest first.
 * Optional ?status=pending|approved|rejected filter.
 */
export const GET = handler({
  auth: 'admin',
  name: 'GET /api/admin/invite-requests',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-invite-requests-get', {
      limit: 120,
      windowMs: 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const status = request.nextUrl.searchParams.get('status')
    const query: any = {}
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query.status = status
    }

    const requests = await collectCompoundCursorPages(
      (filter, limit) =>
        InviteRequest.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
      query,
      'createdAt',
      -1,
      (last) => ({
        v: last.createdAt ? new Date(last.createdAt as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )

    const baseUrl = process.env.NEXTAUTH_URL || ''

    return {
      data: {
        requests: requests.map((r: any) => ({
          id: r._id.toString(),
          email: r.email,
          name: r.name,
          orgName: r.orgName?.trim() || null,
          message: r.message,
          status: r.status,
          signupCode: r.signupCode || null,
          signupUrl: r.signupCode ? `${baseUrl}/signup?code=${r.signupCode}` : null,
          signupCodeExpiresAt: r.signupCodeExpiresAt || null,
          usedAt: r.usedAt || null,
          rejectReason: r.rejectReason || null,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt || null,
        })),
        emailEnabled: isPlatformEmailConfigured(),
      },
    }
  },
})

/**
 * PATCH /api/admin/invite-requests
 * Body: { id, action: 'approve' | 'reject' | 'reissue', rejectReason? }
 */
export const PATCH = handler({
  auth: 'admin',
  name: 'PATCH /api/admin/invite-requests',
  fn: async ({ session, request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-invite-requests', {
      limit: 20,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { error: 'Request body required' } }
    }
    if (!body?.id || !Types.ObjectId.isValid(body.id)) {
      return { status: 400, data: { error: 'Valid id required' } }
    }
    const action = body.action
    if (!['approve', 'reject', 'reissue'].includes(action)) {
      return { status: 400, data: { error: 'Invalid action' } }
    }

    const req = await InviteRequest.findById(body.id)
    if (!req) return { status: 404, data: { error: 'Not found' } }

    const baseUrl = process.env.NEXTAUTH_URL || ''
    const userId = session!.user.id

    if (action === 'reject') {
      const rejectReason =
        typeof body.rejectReason === 'string' ? body.rejectReason.slice(0, 500) : ''
      req.status = 'rejected'
      req.rejectReason = rejectReason
      req.reviewedById = new Types.ObjectId(userId)
      req.reviewedAt = new Date()
      req.signupCode = undefined
      req.signupCodeExpiresAt = undefined
      await req.save()

      let emailResult: { sent: boolean; reason?: string; error?: string } = {
        sent: false,
        reason: 'not attempted',
      }
      if (isPlatformEmailConfigured()) {
        emailResult = await sendInviteRequestRejectionEmail({
          to: req.email,
          name: req.name,
          rejectReason,
        })
      } else {
        emailResult = { sent: false, reason: 'platform SMTP not configured' }
      }

      return { data: { ok: true, status: req.status, email: emailResult } }
    }

    if (req.usedAt) {
      return {
        status: 409,
        data: { error: 'This request has already been used to create an account' },
      }
    }

    const signupCode = crypto.randomBytes(24).toString('base64url')
    const signupCodeExpiresAt = new Date(Date.now() + SIGNUP_CODE_TTL_DAYS * 24 * 60 * 60 * 1000)

    req.status = 'approved'
    req.signupCode = signupCode
    req.signupCodeExpiresAt = signupCodeExpiresAt
    req.reviewedById = new Types.ObjectId(userId)
    req.reviewedAt = new Date()
    req.rejectReason = undefined
    await req.save()

    const signupUrl = `${baseUrl}/signup?code=${signupCode}`

    let emailResult: { sent: boolean; reason?: string; error?: string }
    if (isPlatformEmailConfigured()) {
      emailResult = await sendPlatformEmail({
        to: req.email,
        subject: 'Your Kasa invitation is ready',
        text:
          `Hi ${req.name},\n\n` +
          `Your invitation to Kasa has been approved. Use the link below to finish creating your account (expires in ${SIGNUP_CODE_TTL_DAYS} days):\n\n` +
          `${signupUrl}\n\n` +
          `If you didn't request this, you can safely ignore this email.\n`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; line-height: 1.6; color: #222;">
            <h2 style="margin: 0 0 12px;">Your Kasa invitation is ready</h2>
            <p>Hi ${escapeHtml(req.name)},</p>
            <p>Your invitation to Kasa has been approved. Click the link below to finish creating your account (expires in ${SIGNUP_CODE_TTL_DAYS} days):</p>
            <p style="margin: 20px 0;">
              <a href="${escapeHtml(signupUrl)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Create your account</a>
            </p>
            <p style="color:#555;font-size:13px;word-break:break-all;">Or copy this URL: ${escapeHtml(signupUrl)}</p>
            <p style="color:#888;font-size:12px;margin-top:30px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      })
    } else {
      emailResult = { sent: false, reason: 'platform SMTP not configured' }
    }

    return {
      data: {
        ok: true,
        status: req.status,
        signupCode,
        signupUrl,
        signupCodeExpiresAt,
        email: emailResult,
      },
    }
  },
})
