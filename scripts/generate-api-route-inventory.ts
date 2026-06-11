#!/usr/bin/env npx tsx
/** Scan app/api route handlers and emit security/catalog/api-routes.json */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const API_DIR = path.join(ROOT, 'app', 'api')
const OUT_FILE = path.join(ROOT, 'security', 'catalog', 'api-routes.json')

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
type AuthMode =
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
  auth: AuthMode
  minRole?: 'member' | 'admin' | 'owner'
  csrf: boolean
  tenantScoped: boolean
  dynamicParams: string[]
  source: string
}

const METHOD_RE =
  /export\s+(?:async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)|const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=)/g

const HANDLER_AUTH_RE =
  /auth:\s*['"](public|session|org|admin|cron|org-or-cron)['"]/g
const HANDLER_MIN_ROLE_RE = /minRole:\s*['"](member|admin|owner)['"]/

function fileToApiPath(file: string): string {
  const rel = path.relative(API_DIR, file).replace(/\\/g, '/')
  const segments = rel.replace(/\/route\.ts$/, '').split('/')
  const apiPath =
    '/api/' +
    segments
      .map((s) => (s.startsWith('[') && s.endsWith(']') ? `:${s.slice(1, -1)}` : s))
      .join('/')
  return apiPath.replace(/\/+/g, '/')
}

function extractDynamicParams(apiPath: string): string[] {
  const params: string[] = []
  for (const part of apiPath.split('/')) {
    if (part.startsWith(':')) params.push(part.slice(1))
  }
  return params
}

function isCsrfExempt(apiPath: string, method: HttpMethod, auth: AuthMode): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  if (auth === 'webhook' || auth === 'nextauth' || auth === 'public') return true
  if (apiPath === '/api/stripe/webhook') return true
  const p = apiPath
  const nextAuthOwned =
    p === '/api/auth/signin' ||
    p.startsWith('/api/auth/signin/') ||
    p === '/api/auth/signout' ||
    p.startsWith('/api/auth/signout/') ||
    p.startsWith('/api/auth/callback/') ||
    p === '/api/auth/csrf' ||
    p === '/api/auth/session' ||
    p === '/api/auth/providers' ||
    p === '/api/auth/error'
  if (nextAuthOwned) return true
  return false
}

function extractMethodBlocks(content: string): Map<HttpMethod, string> {
  const blocks = new Map<HttpMethod, string>()
  const exportRe =
    /^export\s+(?:async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)|const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=)/gm
  const matches: Array<{ method: HttpMethod; index: number }> = []
  let m: RegExpExecArray | null
  while ((m = exportRe.exec(content)) !== null) {
    matches.push({ method: (m[1] || m[2]) as HttpMethod, index: m.index })
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length
    blocks.set(matches[i].method, content.slice(start, end))
  }
  return blocks
}

const HTTP_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])

function resolveTsImport(importPath: string): string | null {
  let rel = importPath.replace(/^@\//, '').replace(/\\/g, '/')
  if (!rel.endsWith('.ts')) rel += '.ts'
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) return null
  return fs.readFileSync(full, 'utf8')
}

/** Follow thin re-export chain (route → api-handlers → route-logic) for auth hints. */
function resolveAuthContent(fileContent: string): string {
  let combined = fileContent
  const seen = new Set<string>()
  let current = fileContent
  for (let depth = 0; depth < 4; depth++) {
    const fromMatch = current.match(/from\s+['"]([^'"]+)['"]/)
    if (!fromMatch) break
    const importPath = fromMatch[1]
    if (seen.has(importPath)) break
    seen.add(importPath)
    const next = resolveTsImport(importPath)
    if (!next) break
    combined += `\n${next}`
    current = next
  }
  return combined
}

function extractExportedMethods(content: string): Set<HttpMethod> {
  const methods = new Set<HttpMethod>()
  let m: RegExpExecArray | null
  METHOD_RE.lastIndex = 0
  while ((m = METHOD_RE.exec(content)) !== null) {
    methods.add((m[1] || m[2]) as HttpMethod)
  }
  const reExport = content.match(/export\s*\{([^}]+)\}/)
  if (reExport) {
    for (const part of reExport[1].split(',')) {
      const name = part.trim()
      if (HTTP_METHODS.has(name as HttpMethod)) {
        methods.add(name as HttpMethod)
      }
    }
  }
  if (content.includes('export const GET = POST')) {
    methods.add('GET')
    methods.add('POST')
  }
  return methods
}

function classifyAuth(fileContent: string, apiPath: string): {
  auth: AuthMode
  minRole?: 'member' | 'admin' | 'owner'
} {
  if (apiPath.includes('/api/auth/[...nextauth]')) {
    return { auth: 'nextauth' }
  }
  if (apiPath === '/api/stripe/webhook') {
    return { auth: 'webhook' }
  }
  if (apiPath === '/api/health') {
    return { auth: 'public' }
  }
  if (fileContent.includes('requirePlatformAdmin')) {
    return { auth: 'platform-admin' }
  }

  const handlerAuths = [...fileContent.matchAll(HANDLER_AUTH_RE)].map((m) => m[1])
  const minRoleMatch = fileContent.match(HANDLER_MIN_ROLE_RE)

  if (handlerAuths.includes('public')) {
    return { auth: 'public' }
  }
  if (handlerAuths.includes('cron')) {
    return { auth: 'cron' }
  }
  if (handlerAuths.includes('org-or-cron')) {
    return { auth: 'org-or-cron', minRole: minRoleMatch?.[1] as 'admin' | undefined }
  }
  if (handlerAuths.includes('admin')) {
    return { auth: 'admin' }
  }
  if (handlerAuths.includes('session')) {
    return { auth: 'session' }
  }
  if (handlerAuths.includes('org')) {
    return {
      auth: 'org',
      minRole: (minRoleMatch?.[1] as 'member' | 'admin' | 'owner') ?? 'member',
    }
  }

  if (fileContent.includes('isCronRequest') && !fileContent.includes('requireOrg(request')) {
    return { auth: 'cron' }
  }
  if (fileContent.includes('requireOrgOrCron')) {
    const admin = fileContent.includes("minRole: 'admin'") || fileContent.includes('minRole: "admin"')
    return { auth: 'org-or-cron', minRole: admin ? 'admin' : 'member' }
  }
  if (fileContent.includes('requireOrg')) {
    const admin =
      fileContent.includes("minRole: 'admin'") ||
      fileContent.includes('minRole: "admin"') ||
      fileContent.includes('{ minRole: admin')
    return { auth: 'org', minRole: admin ? 'admin' : 'member' }
  }
  if (fileContent.includes('requireSession')) {
    return { auth: 'session' }
  }

  if (
    apiPath.startsWith('/api/auth/') &&
    (apiPath.includes('signup') ||
      apiPath.includes('reset-password') ||
      apiPath.includes('precheck-2fa') ||
      apiPath.includes('request-invite'))
  ) {
    return { auth: 'public' }
  }

  return { auth: 'org', minRole: 'member' }
}

function scanFile(file: string): ApiRouteEntry[] {
  const content = fs.readFileSync(file, 'utf8')
  const apiPath = fileToApiPath(file)
  const relSource = path.relative(ROOT, file).replace(/\\/g, '/')
  const authContent = resolveAuthContent(content)
  const fileAuth = classifyAuth(authContent, apiPath)
  const methodBlocks = extractMethodBlocks(authContent)
  const dynamicParams = extractDynamicParams(apiPath)

  const entries: ApiRouteEntry[] = []
  const methods = extractExportedMethods(content)

  for (const method of methods) {
    const block = methodBlocks.get(method) ?? authContent
    const { auth, minRole } = classifyAuth(block, apiPath)
    const effectiveAuth = auth === 'org' && fileAuth.auth !== 'org' ? fileAuth.auth : auth
    const effectiveMinRole =
      effectiveAuth === 'org' || effectiveAuth === 'org-or-cron'
        ? minRole ?? fileAuth.minRole ?? 'member'
        : undefined
    const tenantScoped =
      effectiveAuth === 'org' ||
      effectiveAuth === 'org-or-cron' ||
      effectiveAuth === 'admin' ||
      effectiveAuth === 'platform-admin'
    const csrf =
      effectiveAuth !== 'public' && !isCsrfExempt(apiPath, method, effectiveAuth)
    entries.push({
      path: apiPath,
      method,
      auth: effectiveAuth,
      minRole: effectiveMinRole,
      csrf,
      tenantScoped,
      dynamicParams,
      source: relSource,
    })
  }

  return entries
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) files.push(...walk(full))
    else if (name === 'route.ts') files.push(full)
  }
  return files
}

function main(): void {
  const files = walk(API_DIR)
  const routes = files.flatMap(scanFile).sort((a, b) => {
    const k = a.path.localeCompare(b.path)
    return k !== 0 ? k : a.method.localeCompare(b.method)
  })

  const summary = {
    total: routes.length,
    byAuth: {} as Record<string, number>,
    mutating: routes.filter((r) => r.csrf).length,
    tenantScoped: routes.filter((r) => r.tenantScoped).length,
  }
  for (const r of routes) {
    summary.byAuth[r.auth] = (summary.byAuth[r.auth] ?? 0) + 1
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, routes }, null, 2),
    'utf8',
  )

  console.log(`[security:catalog] Wrote ${routes.length} route entries → ${OUT_FILE}`)
  console.log('[security:catalog] Summary:', summary)
}

main()
