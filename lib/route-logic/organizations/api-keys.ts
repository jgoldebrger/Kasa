/**
 * Org API keys — owner-only CRUD in Settings → Security.
 *
 * GET    /api/organizations/api-keys — list keys (prefix + metadata only)
 * POST   /api/organizations/api-keys — create key (plaintext shown once)
 * DELETE /api/organizations/api-keys?id= — revoke key
 */

import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { OrgApiKey } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { API_KEY_SCOPES } from '@/lib/org-permissions'
import { generateOrgApiKey, hashOrgApiKey } from '@/lib/org-api-key-token'
import { objectId } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z
    .array(z.enum(['families:read', 'payments:read']))
    .min(1)
    .max(API_KEY_SCOPES.length)
    .default(['families:read', 'payments:read']),
})

const deleteQuery = z.object({ id: objectId })

export const GET = handler({
  auth: 'org',
  minRole: 'owner',
  name: 'GET /api/organizations/api-keys',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-api-keys-list',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const keys = await OrgApiKey.find({
      organizationId: ctx!.organizationId,
      revokedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean<
        Array<{
          _id: { toString(): string }
          name: string
          prefix: string
          scopes: string[]
          lastUsedAt?: Date | null
          createdAt: Date
        }>
      >()

    return {
      data: {
        keys: keys.map((k) => ({
          id: k._id.toString(),
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt ?? null,
          createdAt: k.createdAt,
        })),
      },
    }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  body: createBody,
  name: 'POST /api/organizations/api-keys',
  fn: async ({ ctx, body, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-api-keys-create',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const activeCount = await OrgApiKey.countDocuments({
      organizationId: ctx!.organizationId,
      revokedAt: null,
    })
    if (activeCount >= 10) {
      return { status: 400, data: { error: 'Maximum of 10 active API keys per organization' } }
    }

    const { token, prefix } = generateOrgApiKey()
    const doc = await OrgApiKey.create({
      organizationId: ctx!.organizationId,
      name: body.name,
      prefix,
      keyHash: hashOrgApiKey(token),
      scopes: body.scopes,
      createdById: session!.user.id,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'org.api_key.create',
      resourceType: 'OrgApiKey',
      resourceId: doc._id,
      metadata: { name: body.name, prefix, scopes: body.scopes },
      request,
    })

    return {
      status: 201,
      data: {
        key: {
          id: doc._id.toString(),
          name: doc.name,
          prefix: doc.prefix,
          scopes: doc.scopes,
          token,
        },
      },
    }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'owner',
  query: deleteQuery,
  name: 'DELETE /api/organizations/api-keys',
  fn: async ({ ctx, query, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-api-keys-revoke',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const updated = await OrgApiKey.findOneAndUpdate(
      { _id: query.id, organizationId: ctx!.organizationId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { new: true },
    ).lean<{ _id: unknown; name?: string; prefix?: string }>()
    if (!updated) return { status: 404, data: { error: 'API key not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'org.api_key.revoke',
      resourceType: 'OrgApiKey',
      resourceId: updated._id,
      metadata: { name: updated.name, prefix: updated.prefix },
      request,
    })

    return { data: { ok: true } }
  },
})
