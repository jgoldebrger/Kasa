/**
 * Shared route handler HOF.
 *
 * Centralizes: auth (session/org/cron/admin/public), connectDB(), body+
 * query parsing via zod, try/catch with production-safe error format,
 * structured logging via lib/log, and unwrapping plain returns into
 * NextResponse.json.
 *
 * A 60-line route becomes ~10 lines. Migrate opportunistically.
 *
 * Example:
 *
 *   export const POST = handler({
 *     auth: 'org',
 *     minRole: 'admin',
 *     body: family.familyBody,
 *     fn: async ({ body, ctx }) => {
 *       const fam = await Family.create({ ...body, organizationId: ctx.organizationId })
 *       return { status: 201, data: { family: fam } }
 *     },
 *   })
 */

import { NextRequest, NextResponse } from 'next/server'
import { ZodError, ZodSchema } from 'zod'
import { Types } from 'mongoose'
import connectDB from '@/lib/database'
import {
  requireSession,
  requireOrg,
  hasMinRole,
  type AuthedSession,
  type OrgContext,
  type Role,
} from '@/lib/auth-helpers'
import { enforcePlatformAccountAccess, isSubscriptionExemptApi } from '@/lib/billing/account-access'
import { assertPlatformAdminTwoFactor, isPlatformAdminEmail } from '@/lib/platform-admin'
import { isCronRequest, requireOrgOrCron } from '@/lib/auth-cron'
import { verifyCronJob } from '@/lib/auth-cron-job'
import { logError } from '@/lib/log'
import { verifyApiCsrf } from '@/lib/csrf'
import { blockReadOnlySupportMutation } from '@/lib/support-mode-readonly-guard'

export type AuthMode = 'public' | 'session' | 'org' | 'admin' | 'cron' | 'org-or-cron'

export interface HandlerCtx<TBody, TQuery> {
  request: NextRequest
  params: Record<string, string | string[]>
  body: TBody
  query: TQuery
  /** Present when auth = 'session' | 'org' | 'admin' | 'org-or-cron'. */
  session?: AuthedSession
  /** Present when auth = 'org' | 'admin' | 'org-or-cron'. */
  ctx?: OrgContext
}

export type HandlerReturn =
  | NextResponse
  | { status?: number; data?: unknown; headers?: Record<string, string> }
  | { status: number }
  | Record<string, unknown>
  | void

export interface HandlerOptions<TBody, TQuery> {
  auth: AuthMode
  /** For 'org' / 'admin' / 'org-or-cron': min role required. */
  minRole?: Role
  body?: ZodSchema<TBody>
  query?: ZodSchema<TQuery>
  /**
   * Path params that must be valid Mongo ObjectIds. Listed names are
   * validated BEFORE `fn` runs; anything malformed returns 400 instead
   * of hitting Mongoose where a bad string would either throw a
   * CastError (500) or — worse for `find` — be silently coerced and
   * potentially match unintended documents.
   */
  idParams?: string[]
  /** Skip connectDB() if this route doesn't touch Mongo. */
  noDb?: boolean
  /** Logical name for log/Sentry breadcrumbs (eg "POST /api/families"). */
  name?: string
  /** For `auth: 'cron'`: job name for per-job HMAC token verification. */
  cronJobName?: string
  /**
   * For `auth: 'admin'`: require TOTP on the platform admin account (default false).
   * Set true to opt in on sensitive routes.
   */
  platformAdminTwoFactor?: boolean
  fn: (input: HandlerCtx<TBody, TQuery>) => Promise<HandlerReturn>
}

/** Context shape Next.js 15 passes to route handlers (params may be sync in tests). */
export type NextRouteContext = {
  params: Promise<Record<string, string | string[]>> | Record<string, string | string[]>
}

/** Permissive context for direct handler calls in tests and legacy callers. */
export type RouteContext = {
  params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]>
}

export type AppRouteHandler = {
  (request: NextRequest, context: NextRouteContext): Promise<NextResponse>
  (request: NextRequest): Promise<NextResponse>
}

export function handler<TBody = unknown, TQuery = unknown>(opts: HandlerOptions<TBody, TQuery>) {
  async function run(request: NextRequest, context: RouteContext = {}): Promise<NextResponse> {
    const startedAt = Date.now()
    const routeParams: Record<string, string | string[]> = await Promise.resolve(
      context?.params ?? {},
    )
    try {
      const csrfBlock = verifyApiCsrf(request)
      if (csrfBlock) return csrfBlock

      // --- auth ------------------------------------------------------------
      let session: AuthedSession | undefined
      let ctx: OrgContext | undefined

      switch (opts.auth) {
        case 'public':
          break
        case 'cron':
          if (opts.cronJobName) {
            if (!verifyCronJob(request, opts.cronJobName)) {
              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
          } else if (!isCronRequest(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
          break
        case 'session': {
          const r = await requireSession()
          if (r instanceof NextResponse) return r
          session = r
          break
        }
        case 'org': {
          if (isCronRequest(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
          const r = await requireOrg(request, { minRole: opts.minRole })
          if (r instanceof NextResponse) return r
          ctx = r
          session = r.session
          break
        }
        case 'org-or-cron': {
          const r = await requireOrgOrCron(request, { minRole: opts.minRole })
          if (r instanceof NextResponse) return r
          if (!r.isCron && opts.minRole && !hasMinRole(r.role, opts.minRole)) {
            return NextResponse.json({ error: `Requires ${opts.minRole} role` }, { status: 403 })
          }
          ctx = r
          session = r.session
          break
        }
        case 'admin': {
          const r = await requireSession()
          if (r instanceof NextResponse) return r
          if (!isPlatformAdminEmail(r.user.email)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
          if (opts.platformAdminTwoFactor === true) {
            const tfaBlock = await assertPlatformAdminTwoFactor(r.user.id)
            if (tfaBlock) return tfaBlock
          }
          session = r
          break
        }
      }

      // --- id-param validation --------------------------------------------
      // Reject malformed IDs at the boundary so handlers don't have to.
      if (opts.idParams && opts.idParams.length > 0) {
        for (const name of opts.idParams) {
          const raw = routeParams[name]
          const value = Array.isArray(raw) ? raw[0] : raw
          if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
            return NextResponse.json({ error: `Invalid ${name}` }, { status: 400 })
          }
        }
      }

      // --- db --------------------------------------------------------------
      if (!opts.noDb) await connectDB()

      if (opts.auth === 'org' && ctx) {
        const readOnlyBlock = blockReadOnlySupportMutation(request, ctx)
        if (readOnlyBlock) return readOnlyBlock
      }

      // Block org API calls when billing is enforced and the workspace has no
      // active platform subscription (owners subscribe via /pricing or Settings).
      if (opts.auth === 'org' && ctx) {
        const apiPath = new URL(request.url).pathname
        if (!isSubscriptionExemptApi(apiPath) && !ctx.isPlatformImpersonation) {
          const gate = await enforcePlatformAccountAccess(ctx.organizationId)
          if (!gate.ok) {
            return NextResponse.json({ error: gate.error }, { status: gate.status })
          }
        }
      }

      // --- body parse ------------------------------------------------------
      let body: TBody = undefined as unknown as TBody
      if (opts.body) {
        const method = request.method.toUpperCase()
        if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
          const raw = await request.json().catch(() => null)
          const parsed = opts.body.safeParse(raw)
          if (!parsed.success) return validationError(parsed.error, opts.name)
          body = parsed.data as TBody
        }
      }

      // --- query parse -----------------------------------------------------
      let query: TQuery = undefined as unknown as TQuery
      if (opts.query) {
        const obj: Record<string, string> = {}
        new URL(request.url).searchParams.forEach((v, k) => {
          obj[k] = v
        })
        const parsed = opts.query.safeParse(obj)
        if (!parsed.success) return validationError(parsed.error, opts.name)
        query = parsed.data as TQuery
      }

      // --- run -------------------------------------------------------------
      const result = await opts.fn({
        request,
        params: routeParams,
        body,
        query,
        session,
        ctx,
      })

      return toResponse(result)
    } catch (err: any) {
      logError(err, {
        module: 'api',
        route: opts.name || `${request.method} ${new URL(request.url).pathname}`,
        durationMs: Date.now() - startedAt,
      })
      return NextResponse.json(
        {
          error: 'Internal server error',
          ...(process.env.NODE_ENV !== 'production' && { details: err?.message }),
        },
        { status: 500 },
      )
    }
  }

  async function routeHandler(request: NextRequest): Promise<NextResponse>
  async function routeHandler(request: NextRequest, context?: RouteContext): Promise<NextResponse>
  async function routeHandler(
    request: NextRequest,
    context: RouteContext = {},
  ): Promise<NextResponse> {
    return run(request, context)
  }

  return routeHandler as AppRouteHandler
}

function validationError(err: ZodError, routeName?: string): NextResponse {
  // Keep field-level details — they're useful to the caller AND don't
  // expose any secret beyond the field names the caller just sent.
  const issues = err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }))
  // Surface validation failures in dev terminal so we can spot client/server
  // schema mismatches without breaking out the network tab.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[validation] ${routeName || 'route'} rejected:`,
      issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; '),
    )
  }
  return NextResponse.json({ error: 'Validation failed', issues }, { status: 400 })
}

function toResponse(result: HandlerReturn): NextResponse {
  if (result instanceof NextResponse) return result
  if (result == null) return NextResponse.json({ ok: true })

  // Treat as wrapper { status, data, headers } if any of those keys present;
  // otherwise serialize as the data itself with 200.
  if (
    typeof result === 'object' &&
    ('status' in result || 'data' in result || 'headers' in result)
  ) {
    const r = result as { status?: number; data?: unknown; headers?: Record<string, string> }
    const body = r.data !== undefined ? r.data : { ok: true }
    const init: ResponseInit = { status: r.status ?? 200 }
    if (r.headers) init.headers = r.headers
    return NextResponse.json(body, init)
  }
  return NextResponse.json(result)
}
