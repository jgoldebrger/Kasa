import type { APIResponse, Page, Request, Response } from '@playwright/test'
import { findSessionCookie } from '../auth/bootstrap'

export interface CapturedRequest {
  id: string
  timestamp: string
  method: string
  url: string
  resourceType: string
  headers: Record<string, string>
  postData?: string
}

export interface CapturedResponse {
  id: string
  requestId: string
  timestamp: string
  status: number
  statusText: string
  headers: Record<string, string>
  bodyPreview?: string
  bodySize?: number
}

export interface CapturedCookie {
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

export interface SessionSnapshot {
  timestamp: string
  cookies: CapturedCookie[]
  sessionToken?: { name: string; valuePreview: string }
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}

export interface TrafficLog {
  startedAt: string
  requests: CapturedRequest[]
  responses: CapturedResponse[]
  sessions: SessionSnapshot[]
}

let globalTraffic: TrafficLog = createEmptyLog()

function createEmptyLog(): TrafficLog {
  return { startedAt: new Date().toISOString(), requests: [], responses: [], sessions: [] }
}

function headersToRecord(headers: Array<{ name: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of headers) out[h.name.toLowerCase()] = h.value
  return out
}

let seq = 0

/** Attach request/response listeners to a page for security auditing. */
export function attachTrafficCapture(page: Page, opts?: { maxBodyPreview?: number }): void {
  const maxPreview = opts?.maxBodyPreview ?? 4096
  const pending = new Map<string, string>()

  page.on('request', (req: Request) => {
    const id = `req-${++seq}`
    pending.set(req.url() + req.method(), id)
    globalTraffic.requests.push({
      id,
      timestamp: new Date().toISOString(),
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      headers: req.headers(),
      postData: req.postData() ?? undefined,
    })
  })

  page.on('response', async (res: Response) => {
    const req = res.request()
    const requestId =
      pending.get(req.url() + req.method()) ?? `req-${seq}`
    let bodyPreview: string | undefined
    let bodySize: number | undefined
    try {
      const ct = res.headers()['content-type'] ?? ''
      if (ct.includes('json') || ct.includes('text') || ct.includes('html')) {
        const buf = await res.body()
        bodySize = buf.length
        bodyPreview = buf.slice(0, maxPreview).toString('utf8')
      }
    } catch {
      /* aborted */
    }
    globalTraffic.responses.push({
      id: `res-${++seq}`,
      requestId,
      timestamp: new Date().toISOString(),
      status: res.status(),
      statusText: res.statusText(),
      headers: res.headers(),
      bodyPreview,
      bodySize,
    })
  })
}

export async function snapshotSession(page: Page): Promise<SessionSnapshot> {
  const cookies = await page.context().cookies()
  const url = page.url()
  if (!url.startsWith('http')) {
    return {
      timestamp: new Date().toISOString(),
      cookies,
      localStorage: {},
      sessionStorage: {},
    }
  }
  const storage = await page.evaluate(() => {
    const ls: Record<string, string> = {}
    const ss: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k) ls[k] = localStorage.getItem(k) ?? ''
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k) ss[k] = sessionStorage.getItem(k) ?? ''
    }
    return { localStorage: ls, sessionStorage: ss }
  })

  const sessionCookie = findSessionCookie(cookies)
  const snap: SessionSnapshot = {
    timestamp: new Date().toISOString(),
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    })),
    sessionToken: sessionCookie
      ? { name: sessionCookie.name, valuePreview: sessionCookie.value.slice(0, 48) + '…' }
      : undefined,
    localStorage: storage.localStorage,
    sessionStorage: storage.sessionStorage,
  }
  globalTraffic.sessions.push(snap)
  return snap
}

export function getTrafficLog(): TrafficLog {
  return globalTraffic
}

export function resetTrafficLog(): void {
  globalTraffic = createEmptyLog()
  seq = 0
}

export async function captureApiExchange(
  response: APIResponse,
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const headers = response.headers()
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = await response.text()
  }
  return { status: response.status(), headers, body }
}
