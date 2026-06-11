import type { NextRequest, NextResponse } from 'next/server'
import type { ApiRouteEntry } from '../../security/catalog/types'
import type { ApiTestContext } from './api-route-fixtures'
import type { DeepProbe } from './api-route-deep-probes'
import { resolveDeepProbeParams } from './api-route-deep-probes'
import { expectRouteStatus, invokeApiRoute } from './api-route-harness'
export type DeepProbeResult = {
  response: NextResponse
  params: Record<string, string>
  path: string
}

export async function runDeepProbe(
  route: ApiRouteEntry,
  probe: DeepProbe,
  ctx: ApiTestContext,
): Promise<DeepProbeResult> {
  const request = await Promise.resolve(probe.buildRequest(ctx))
  const params = probe.params ?? resolveDeepProbeParams(route, ctx, request)

  const path = request.nextUrl.pathname
  const response = await invokeApiRoute(route, request, params)
  return { response, params, path }
}

export async function runDeepProbeExpectOk(
  route: ApiRouteEntry,
  probe: DeepProbe,
  ctx: ApiTestContext,
): Promise<DeepProbeResult> {
  const result = await runDeepProbe(route, probe, ctx)
  expectRouteStatus(route, result.response)
  return result
}
