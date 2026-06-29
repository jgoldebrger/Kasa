import { NextRequest, NextResponse } from 'next/server'
import connectDB from '@/lib/database'
import { OrgApiKey } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { findOrgApiKeyByToken, parseBearerOrgApiKey } from '@/lib/org-api-key-token'
import type { OrgPermission } from '@/types/auth'

export interface OrgApiKeyContext {
  organizationId: string
  apiKeyId: string
  scopes: OrgPermission[]
  isApiKey: true
}

export type OrgOrApiKeyContext = OrgApiKeyContext

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

const API_KEY_RATE = { limit: 120, windowMs: 60_000 }

/**
 * Authenticate a Bearer org API key. Returns context or a NextResponse error.
 * Rate-limited per key id.
 */
export async function requireOrgApiKey(
  request: NextRequest,
  options: { permission?: OrgPermission } = {},
): Promise<OrgApiKeyContext | NextResponse> {
  const token = parseBearerOrgApiKey(request.headers.get('authorization'))
  if (!token) return unauthorized('Missing or invalid API key')

  await connectDB()
  const row = await findOrgApiKeyByToken(token)
  if (!row) return unauthorized('Invalid API key')

  const apiKeyId = row._id.toString()
  const rateVerdict = await checkRateLimit(request, 'org-api-key', API_KEY_RATE, apiKeyId)
  if (!rateVerdict.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const scopes = (row.scopes || []) as OrgPermission[]
  if (options.permission && !scopes.includes(options.permission)) {
    return forbidden('API key lacks required scope')
  }

  void OrgApiKey.updateOne({ _id: row._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {})

  return {
    organizationId: row.organizationId.toString(),
    apiKeyId,
    scopes,
    isApiKey: true,
  }
}

/** Resolve org id from session OrgContext or API key context. */
export function resolveOrganizationId(ctx: { organizationId: string } | OrgApiKeyContext): string {
  return ctx.organizationId
}
