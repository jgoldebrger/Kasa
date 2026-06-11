import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { ACTIVE_ORG_COOKIE } from '@/lib/auth-helpers'
import { OrgMembership, Organization, User } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { organization as organizationSchemas } from '@/lib/schemas'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'

// GET /api/organizations
// Returns all organizations the current user is a member of.
export const GET = handler({
  auth: 'session',
  name: 'GET /api/organizations',
  fn: async ({ session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-list',
      { limit: 120, windowMs: 60_000 },
      session!.user.id,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const memberships = await loadAllByIdCursor<any>(
      (filter, limit) =>
        OrgMembership.find(filter)
          .populate('organizationId', 'name slug')
          .sort({ createdAt: 1, _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      { userId: session!.user.id },
    )

    const user = await User.findById(session!.user.id).select('lastActiveOrganizationId').lean<{
      lastActiveOrganizationId?: Types.ObjectId
    }>()

    return {
      data: {
        organizations: memberships
          .filter((m) => m.organizationId)
          .map((m) => ({
            id: m.organizationId._id.toString(),
            name: m.organizationId.name,
            slug: m.organizationId.slug,
            role: m.role,
          })),
        activeOrgId: user?.lastActiveOrganizationId?.toString() || null,
      },
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})

// PATCH /api/organizations
// Body: { activeOrgId }
// Switch the active organization. Sets a cookie + updates lastActiveOrganizationId.
export const PATCH = handler({
  auth: 'session',
  body: organizationSchemas.organizationSwitchBody,
  name: 'PATCH /api/organizations',
  fn: async ({ session, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-switch',
      { limit: 30, windowMs: 60 * 60_000 },
      session!.user.id,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = body.activeOrgId

    const membership = await OrgMembership.findOne({
      userId: session!.user.id,
      organizationId: orgId,
    })
    if (!membership) {
      return { status: 403, data: { error: 'You are not a member of that organization' } }
    }

    await User.findByIdAndUpdate(session!.user.id, { lastActiveOrganizationId: orgId })

    const res = NextResponse.json({ ok: true, activeOrgId: orgId })
    res.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return res
  },
})

// POST /api/organizations
// Body: { name }
// Create a brand-new organization owned by the current user.
export const POST = handler({
  auth: 'session',
  body: organizationSchemas.organizationCreateBody,
  name: 'POST /api/organizations',
  fn: async ({ session, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-create',
      { limit: 5, windowMs: 60 * 60_000 },
      session!.user.id,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const name = body.name

    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'org'

    let slug = baseSlug
    let suffix = 0
    while (await Organization.exists({ slug })) {
      suffix++
      slug = `${baseSlug}-${suffix}`
    }

    const org = await Organization.create({
      name,
      slug,
      ownerId: session!.user.id,
    })

    await OrgMembership.create({
      userId: session!.user.id,
      organizationId: org._id,
      role: 'owner',
    })

    await audit({
      organizationId: org._id.toString(),
      userId: session!.user.id,
      action: 'organization.create',
      resourceType: 'Organization',
      resourceId: org._id,
      metadata: { name, slug },
    })

    return {
      data: {
        id: org._id.toString(),
        name: org.name,
        slug: org.slug,
      },
    }
  },
})
