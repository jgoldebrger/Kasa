import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'
import { UPLOAD_FIXTURES } from '../security/payloads/upload'

const orgId = new Types.ObjectId().toString()
const userId = new Types.ObjectId().toString()

vi.mock('@/lib/auth-helpers', () => ({
  requireOrg: vi.fn(),
}))

function importRequest(form: FormData): NextRequest {
  return new NextRequest('http://localhost:3000/api/import', {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
    },
    body: form,
  })
}

describe('import-csv POST (integration)', () => {
  beforeAll(async () => {
    await setupMongo()
    const { requireOrg } = await import('./auth-helpers')
    vi.mocked(requireOrg).mockResolvedValue({
      organizationId: orgId,
      userId,
      role: 'owner',
    } as never)
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Family, PaymentPlan, Organization } = await import('./models')
    await Promise.all([
      Family.deleteMany({ organizationId: orgId }),
      PaymentPlan.deleteMany({ organizationId: orgId }),
      Organization.deleteMany({ _id: new Types.ObjectId(orgId) }),
    ])
  })

  async function seedOrgWithPlan() {
    const { Organization, PaymentPlan } = await import('./models')
    await Organization.create({
      _id: new Types.ObjectId(orgId),
      name: 'Import Test Org',
      slug: `import-org-${orgId.slice(-6)}`,
      ownerId: new Types.ObjectId(userId),
      timezone: 'UTC',
    })
    await PaymentPlan.create({
      organizationId: orgId,
      name: 'Default',
      planNumber: 1,
      yearlyPrice: 100,
    })
  }

  it('imports families from allowed CSV', async () => {
    await seedOrgWithPlan()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'families')
    const csv = UPLOAD_FIXTURES.allowedCsv
    form.set('file', new Blob([csv.content], { type: csv.mime }), 'families.csv')

    const res = await POST(importRequest(form))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.imported).toBeGreaterThanOrEqual(1)

    const { Family } = await import('./models')
    const count = await Family.countDocuments({ organizationId: orgId })
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('returns 400 when file is missing', async () => {
    await seedOrgWithPlan()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'families')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })

  it('imports members bound to familyId', async () => {
    await seedOrgWithPlan()
    const { Family } = await import('./models')
    const family = await Family.create({
      organizationId: orgId,
      name: 'API Route Marker Family',
      weddingDate: new Date('2015-06-01'),
    })
    const { POST } = await import('./route-logic/import')
    const { buildImportProbeRequest } = await import('./test/import-route-probes')
    const request = await buildImportProbeRequest('members-bound', {
      familyId: family!._id.toString(),
    })
    const res = await POST(request)
    expect(res.status).toBeLessThan(500)
    expect(res.status).not.toBe(401)
  })

  it('returns 400 for unknown import type', async () => {
    await seedOrgWithPlan()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'not-a-type')
    const csv = UPLOAD_FIXTURES.allowedCsv
    form.set('file', new Blob([csv.content], { type: csv.mime }), 'f.csv')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })
})
