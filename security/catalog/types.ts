export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type RouteAuthMode =
  | 'public'
  | 'session'
  | 'org'
  | 'admin'
  | 'cron'
  | 'org-or-cron'
  | 'platform-admin'
  | 'webhook'
  | 'nextauth'

export interface ApiRouteEntry {
  path: string
  method: HttpMethod
  auth: RouteAuthMode
  minRole?: 'member' | 'admin' | 'owner'
  csrf: boolean
  tenantScoped: boolean
  dynamicParams: string[]
  source: string
}

export interface ApiRouteCatalog {
  generatedAt: string
  summary: {
    total: number
    byAuth: Record<string, number>
    mutating: number
    tenantScoped: number
  }
  routes: ApiRouteEntry[]
}
