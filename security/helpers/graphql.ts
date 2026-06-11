import type { APIRequestContext } from '@playwright/test'
import { mutateRequest } from './request-mutation'

export interface GraphQLProbeResult {
  test: string
  passed: boolean
  detail: string
}

/**
 * KASA is REST-only. These probes verify GraphQL/introspection endpoints
 * are not accidentally exposed — a common misconfiguration vector.
 */
const GRAPHQL_PATHS = [
  '/graphql',
  '/api/graphql',
  '/v1/graphql',
  '/query',
  '/api/query',
]

const INTROSPECTION_QUERY = {
  query: '{ __schema { types { name } } }',
}

function looksLikeGraphQLResponse(status: number, contentType: string, body: string): boolean {
  if (status === 404 || status === 405) return false
  const ct = contentType.toLowerCase()
  if (ct.includes('text/html')) return false
  if (body.includes('GraphiQL') || body.includes('graphiql')) return true
  if (ct.includes('application/json') || ct.includes('application/graphql')) {
    return (
      body.includes('__schema') ||
      body.includes('"data"') && body.includes('__typename') ||
      (body.includes('errors') && body.includes('query'))
    )
  }
  return false
}

export async function probeGraphQLExposure(
  request: APIRequestContext,
): Promise<GraphQLProbeResult[]> {
  const results: GraphQLProbeResult[] = []

  for (const path of GRAPHQL_PATHS) {
    const getRes = await mutateRequest(request, { method: 'GET', path })
    const getBody = await getRes.text()
    const getCt = getRes.headers()['content-type'] ?? ''
    const getExposed = looksLikeGraphQLResponse(getRes.status(), getCt, getBody)
    results.push({
      test: `GET ${path}`,
      passed: !getExposed,
      detail: getExposed
        ? `GraphQL-like response on ${path} (${getRes.status()})`
        : `No GraphQL surface (${getRes.status()})`,
    })

    const postRes = await mutateRequest(request, {
      method: 'POST',
      path,
      data: INTROSPECTION_QUERY,
    })
    const body = await postRes.text()
    const postCt = postRes.headers()['content-type'] ?? ''
    const introspectionLeaked = looksLikeGraphQLResponse(postRes.status(), postCt, body)
    results.push({
      test: `POST introspection ${path}`,
      passed: !introspectionLeaked,
      detail: introspectionLeaked
        ? 'GraphQL introspection may be enabled'
        : `No introspection (${postRes.status()})`,
    })
  }

  return results
}
