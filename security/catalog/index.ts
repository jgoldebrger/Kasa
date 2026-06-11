import fs from 'fs'
import path from 'path'
import type { ApiRouteCatalog, ApiRouteEntry, RouteAuthMode } from './types'

export * from './types'

const CATALOG_PATH = path.join(__dirname, 'api-routes.json')

let cached: ApiRouteCatalog | null = null

export function loadApiRouteCatalog(): ApiRouteCatalog {
  if (!cached) {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8')
    cached = JSON.parse(raw) as ApiRouteCatalog
  }
  return cached
}

export function getCatalogRoutes(filter?: (r: ApiRouteEntry) => boolean): ApiRouteEntry[] {
  const routes = loadApiRouteCatalog().routes
  return filter ? routes.filter(filter) : routes
}

export function isProtectedRoute(route: ApiRouteEntry): boolean {
  return !(['public', 'webhook', 'nextauth'] as RouteAuthMode[]).includes(route.auth)
}

export function routeKey(route: ApiRouteEntry): string {
  return `${route.method} ${route.path}`
}
