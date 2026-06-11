/**
 * Isolated import coverage for exceljs namespace fallback (no default export).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'

const mockAuth = vi.hoisted(() => vi.fn())
const mockCookieGet = vi.hoisted(() => vi.fn())
const familyName = vi.hoisted(() => `NsXlsx ${Date.now()}`)
const rows = vi.hoisted(() => [
  ['name', 'weddingDate'],
  [familyName, '2019-03-01'],
] as string[][])

vi.mock('@/app/auth', () => ({ auth: mockAuth }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookieGet })),
}))
vi.mock('exceljs', () => {
  const ws = {
    getRow: (rowNum: number) => ({
      eachCell: (
        _opts: { includeEmpty: boolean },
        cb: (cell: { value: unknown }, col: number) => void,
      ) => {
        const row = rows[rowNum - 1] || []
        row.forEach((val, i) => cb({ value: val }, i + 1))
      },
    }),
    eachRow: (
      _opts: { includeEmpty: boolean },
      cb: (row: { getCell: (col: number) => { value: unknown } }, rowNum: number) => void,
    ) => {
      for (let i = 1; i < rows.length; i++) {
        cb(
          {
            getCell: (col: number) => ({ value: rows[i][col - 1] ?? '' }),
          },
          i + 1,
        )
      }
    },
  }
  const wb = {
    worksheets: [ws],
    xlsx: { load: vi.fn().mockResolvedValue(undefined) },
  }
  class Workbook {
    constructor() {
      return wb
    }
  }
  return { default: undefined, Workbook }
})

const API_ORIGIN = 'http://localhost:3000'
let ctx: ApiTestContext

function bindSession(c: ApiTestContext) {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [{ o: c.orgId, r: 'owner' }],
    },
  } as never)
  mockCookieGet.mockImplementation((name: string) =>
    name === 'kasa_active_org' ? { value: c.orgId } : undefined,
  )
}

function importReq(form: FormData): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/import`, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: API_ORIGIN,
      'x-organization-id': ctx.orgId,
    },
    body: form,
  })
}

describe.sequential('import exceljs namespace fallback', () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  it('parseXlsx uses exceljs namespace when default export is missing', async () => {
    bindSession(ctx)
    const { POST } = await import('@/lib/route-logic/import')
    const form = new FormData()
    form.set('type', 'families')
    form.set(
      'file',
      new Blob([Buffer.from('xlsx')], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'families.xlsx',
    )
    const res = await POST(importReq(form))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBeGreaterThanOrEqual(1)
    const { Family } = await import('@/lib/models')
    await Family.deleteMany({ organizationId: ctx.orgId, name: familyName })
  })
})
