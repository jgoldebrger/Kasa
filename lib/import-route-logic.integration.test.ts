/**
 * Additional /api/import branches (validation, limits, bound family, success paths).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'
import { UPLOAD_FIXTURES } from '../security/payloads/upload'
import { IMPORT_CSV_FIXTURES } from '../security/payloads/import-fixtures'

const orgId = new Types.ObjectId().toString()
const userId = new Types.ObjectId().toString()

vi.mock('@/lib/auth-helpers', () => ({
  requireOrg: vi.fn(),
}))

function importRequest(form: FormData): NextRequest {
  return new NextRequest('http://localhost:3000/api/import', {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    body: form,
  })
}

function csvForm(type: string, content: string, filename: string, extra?: Record<string, string>): FormData {
  const form = new FormData()
  form.set('type', type)
  form.set('file', new Blob([content], { type: 'text/csv' }), filename)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) form.set(k, v)
  }
  return form
}

describe('import route-logic branches', () => {
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
    const {
      Family,
      PaymentPlan,
      Organization,
      FamilyMember,
      Payment,
      LifecycleEventPayment,
      LifecycleEvent,
    } = await import('./models')
    await Promise.all([
      LifecycleEventPayment.deleteMany({ organizationId: orgId }),
      Payment.deleteMany({ organizationId: orgId }),
      FamilyMember.deleteMany({ organizationId: orgId }),
      LifecycleEvent.deleteMany({ organizationId: orgId }),
      Family.deleteMany({ organizationId: orgId }),
      PaymentPlan.deleteMany({ organizationId: orgId }),
      Organization.deleteMany({ _id: new Types.ObjectId(orgId) }),
    ])
  })

  async function seedOrg() {
    const { Organization, PaymentPlan } = await import('./models')
    await Organization.create({
      _id: new Types.ObjectId(orgId),
      name: 'Import Branch Org',
      slug: `import-br-${orgId.slice(-6)}`,
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

  async function seedMarkerFamily() {
    const { Family, LifecycleEvent } = await import('./models')
    const family = await Family.create({
      organizationId: orgId,
      name: 'API Route Marker Family',
      weddingDate: new Date('2010-01-01'),
      email: 'marker-family@import.test',
    })
    await LifecycleEvent.create({
      organizationId: orgId,
      type: 'bar_mitzvah',
      name: 'Bar Mitzvah',
      amount: 500,
    })
    return family
  }

  it('rejects oversize upload', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'families')
    const big = new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'text/csv' })
    form.set('file', big, 'big.csv')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(413)
  })

  it('rejects familyId binding on families import', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'families')
    form.set('familyId', new Types.ObjectId().toString())
    const csv = UPLOAD_FIXTURES.allowedCsv
    form.set('file', new Blob([csv.content], { type: csv.mime }), 'f.csv')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })

  it('rejects invalid bound familyId for members import', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'members')
    form.set('familyId', 'not-an-object-id')
    const csv = UPLOAD_FIXTURES.allowedCsv
    form.set('file', new Blob([csv.content], { type: csv.mime }), 'm.csv')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })

  it('rejects unknown import type', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'not-a-real-type')
    const csv = UPLOAD_FIXTURES.allowedCsv
    form.set('file', new Blob([csv.content], { type: csv.mime }), 'bad.csv')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })

  it('rejects import with no file field', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'families')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })

  it('rejects disallowed file extension', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('type', 'families')
    form.set('file', new Blob(['x'], { type: 'application/pdf' }), 'data.pdf')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(415)
  })

  it('accepts header-only CSV with zero imports', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const res = await POST(
      importRequest(csvForm('families', 'name,weddingDate\n', 'empty.csv')),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(0)
    expect(body.failed).toBe(0)
  })

  it('rejects memberId without familyId', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = csvForm('members', IMPORT_CSV_FIXTURES.members.content, 'm.csv')
    form.set('memberId', new Types.ObjectId().toString())
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })

  it('returns 404 when bound family does not exist', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const missingId = new Types.ObjectId().toString()
    const res = await POST(
      importRequest(
        csvForm('members', IMPORT_CSV_FIXTURES.members.content, 'm.csv', {
          familyId: missingId,
        }),
      ),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when bound member is not in the family', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const res = await POST(
      importRequest(
        csvForm('members', IMPORT_CSV_FIXTURES.members.content, 'm.csv', {
          familyId: family._id.toString(),
          memberId: new Types.ObjectId().toString(),
        }),
      ),
    )
    expect(res.status).toBe(404)
  })

  it('imports families from CSV', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const { Family } = await import('./models')
    const res = await POST(
      importRequest(
        csvForm('families', IMPORT_CSV_FIXTURES.families.content, IMPORT_CSV_FIXTURES.families.filename),
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.imported).toBeGreaterThanOrEqual(1)
    const count = await Family.countDocuments({ organizationId: orgId, name: /Import Family/i })
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('imports members when family exists', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const { FamilyMember } = await import('./models')
    const res = await POST(
      importRequest(
        csvForm('members', IMPORT_CSV_FIXTURES.members.content, IMPORT_CSV_FIXTURES.members.filename),
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBeGreaterThanOrEqual(1)
    const member = await FamilyMember.findOne({ organizationId: orgId, firstName: 'Import' })
    expect(member).toBeTruthy()
  })

  it('imports members bound to a family (skips per-row lookup)', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv =
      'firstName,lastName,birthDate,gender\nBound,Member,2013-01-15,male'
    const res = await POST(
      importRequest(csvForm('members', csv, 'bound.csv', { familyId: family._id.toString() })),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
  })

  it('imports payments for a known family', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const { Payment } = await import('./models')
    const res = await POST(
      importRequest(
        csvForm('payments', IMPORT_CSV_FIXTURES.payments.content, IMPORT_CSV_FIXTURES.payments.filename),
      ),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBeGreaterThanOrEqual(1)
    const pay = await Payment.findOne({ organizationId: orgId, amount: 75 })
    expect(pay).toBeTruthy()
  })

  it('imports lifecycle events for a known family', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const { LifecycleEventPayment } = await import('./models')
    const res = await POST(
      importRequest(
        csvForm(
          'lifecycle-events',
          IMPORT_CSV_FIXTURES.lifecycleEvents.content,
          IMPORT_CSV_FIXTURES.lifecycleEvents.filename,
        ),
      ),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBeGreaterThanOrEqual(1)
    const ev = await LifecycleEventPayment.findOne({ organizationId: orgId, eventType: 'bar_mitzvah' })
    expect(ev).toBeTruthy()
  })

  it('collects row-level validation errors without failing the request', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'name,weddingDate',
      ',2018-01-01',
      'Bad Date Family,not-a-date',
      'Good Family,2019-06-01',
    ].join('\n')
    const res = await POST(importRequest(csvForm('families', csv, 'errors.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toBeGreaterThanOrEqual(2)
    expect(body.imported).toBeGreaterThanOrEqual(1)
    expect(body.errors.length).toBeGreaterThan(0)
  })

  it('warns on duplicate family name and invalid plan id', async () => {
    await seedOrg()
    const { PaymentPlan } = await import('./models')
    const plan = await PaymentPlan.findOne({ organizationId: orgId })
    const planId = plan!._id.toString()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'name,weddingDate,paymentPlanId,paymentPlanNumber',
      `Dup Family,2018-01-01,${new Types.ObjectId()},99`,
      `Dup Family,2019-02-02,${planId},1`,
    ].join('\n')
    const res = await POST(importRequest(csvForm('families', csv, 'dup.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings.length).toBeGreaterThan(0)
    expect(body.imported).toBeGreaterThanOrEqual(1)
  })

  it('rejects payment row with refundedAmount exceeding amount', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'familyName,amount,paymentDate,type,paymentMethod,refundedAmount',
      'API Route Marker Family,50,2024-06-15,membership,check,100',
    ].join('\n')
    const res = await POST(importRequest(csvForm('payments', csv, 'refund.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toBeGreaterThanOrEqual(1)
    expect(body.errors.some((e: string) => e.includes('refundedAmount'))).toBe(true)
  })

  it('reports member import errors when family is missing', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const csv = 'familyName,firstName,lastName\nNo Such Family,X,Y'
    const res = await POST(importRequest(csvForm('members', csv, 'nomatch.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toBeGreaterThanOrEqual(1)
  })

  it('imports families from XLSX', async () => {
    await seedOrg()
    const { buildImportProbeRequest } = await import('./test/import-route-probes')
    const { POST } = await import('./route-logic/import')
    const { Family } = await import('./models')
    const req = await buildImportProbeRequest('families-xlsx')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBeGreaterThanOrEqual(1)
    const count = await Family.countDocuments({ organizationId: orgId, name: /Xlsx Import Family/i })
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('imports lifecycle event amount from org event type when amount column omitted', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = 'familyName,eventType,eventDate\nAPI Route Marker Family,bar_mitzvah,2024-08-01'
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-no-amt.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
  })

  it('imports bound payments attributed to a member', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { FamilyMember } = await import('./models')
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: family._id,
      firstName: 'Pay',
      lastName: 'Target',
    })
    const { POST } = await import('./route-logic/import')
    const csv = 'amount,paymentDate,type,paymentMethod\n40,2024-07-01,membership,check'
    const res = await POST(
      importRequest(
        csvForm('payments', csv, 'bound-pay.csv', {
          familyId: family._id.toString(),
          memberId: member._id.toString(),
        }),
      ),
    )
    expect(res.status).toBe(200)
    const { Payment } = await import('./models')
    const pay = await Payment.findOne({
      organizationId: orgId,
      familyId: family._id,
      memberId: member._id,
      amount: 40,
    })
    expect(pay).toBeTruthy()
  })

  it('matches families by email when importing members', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv =
      'familyEmail,firstName,lastName,birthDate\nmarker-family@import.test,Email,Child,2014-05-01'
    const res = await POST(importRequest(csvForm('members', csv, 'by-email.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
    const { FamilyMember } = await import('./models')
    const m = await FamilyMember.findOne({ organizationId: orgId, familyId: family._id, firstName: 'Email' })
    expect(m).toBeTruthy()
  })

  it('rejects lifecycle row when event type is unknown and amount is missing', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv =
      'familyName,eventType,eventDate\nAPI Route Marker Family,not_a_real_event,2024-08-01'
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-unknown.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toBeGreaterThanOrEqual(1)
    expect(body.errors.some((e: string) => e.includes('not found'))).toBe(true)
  })

  it('rejects import when type field is missing', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const form = new FormData()
    form.set('file', new Blob([IMPORT_CSV_FIXTURES.families.content], { type: 'text/csv' }), 'f.csv')
    const res = await POST(importRequest(form))
    expect(res.status).toBe(400)
  })

  it('rejects payment row with invalid row memberId', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'familyName,amount,paymentDate,memberId',
      'API Route Marker Family,10,2024-06-01,not-valid',
    ].join('\n')
    const res = await POST(importRequest(csvForm('payments', csv, 'bad-member.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects payment rows with invalid year or refundedAmount', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'familyName,amount,paymentDate,year,refundedAmount',
      'API Route Marker Family,50,2024-06-15,1800,',
      'API Route Marker Family,50,2024-06-15,,not-money',
    ].join('\n')
    const res = await POST(importRequest(csvForm('payments', csv, 'pay-bad-fields.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toBeGreaterThanOrEqual(2)
  })

  it('imports payment via familyId column', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = 'familyId,amount,paymentDate,type\n' + `${family._id},55,2024-08-10,membership`
    const res = await POST(importRequest(csvForm('payments', csv, 'by-id.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
  })

  it('records row errors when family create throws', async () => {
    await seedOrg()
    const { Family } = await import('./models')
    const { POST } = await import('./route-logic/import')
    const spy = vi.spyOn(Family, 'create').mockRejectedValueOnce(new Error('Simulated DB error'))
    const csv = 'name,weddingDate\nThrow Family,2019-04-01'
    try {
      const res = await POST(importRequest(csvForm('families', csv, 'throw.csv')))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.failed).toBeGreaterThanOrEqual(1)
      expect(body.errors[0]).toMatch(/Simulated DB error|Failed to import family/)
    } finally {
      spy.mockRestore()
    }
  })

  it('imports lifecycle events with row memberId', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { FamilyMember } = await import('./models')
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: family._id,
      firstName: 'Life',
      lastName: 'Cycle',
    })
    const { POST } = await import('./route-logic/import')
    const csv = [
      'familyName,eventType,eventDate,memberId,amount',
      `API Route Marker Family,bar_mitzvah,2024-09-01,${member._id},250`,
    ].join('\n')
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-member.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
    const { LifecycleEventPayment } = await import('./models')
    const ev = await LifecycleEventPayment.findOne({
      organizationId: orgId,
      familyId: family._id,
      memberId: member._id,
    })
    expect(ev).toBeTruthy()
  })

  it('imports bound lifecycle events with memberId', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { FamilyMember } = await import('./models')
    const member = await FamilyMember.create({
      organizationId: orgId,
      familyId: family._id,
      firstName: 'Bound',
      lastName: 'Event',
    })
    const { POST } = await import('./route-logic/import')
    const csv = 'eventType,eventDate,amount\nbar_mitzvah,2024-10-01,300'
    const res = await POST(
      importRequest(
        csvForm('lifecycle-events', csv, 'le-bound.csv', {
          familyId: family._id.toString(),
          memberId: member._id.toString(),
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
  })

  it('rejects lifecycle rows with invalid year', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv =
      'familyName,eventType,eventDate,year\nAPI Route Marker Family,bar_mitzvah,2024-08-01,1700'
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-year.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects lifecycle row when memberId is not in the family', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'familyName,eventType,eventDate,memberId,amount',
      `API Route Marker Family,bar_mitzvah,2024-08-01,${new Types.ObjectId()},100`,
    ].join('\n')
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-bad-member.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('imports payment with a partial refund amount', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'familyName,amount,paymentDate,type,paymentMethod,refundedAmount',
      'API Route Marker Family,100,2024-06-15,membership,check,25',
    ].join('\n')
    const res = await POST(importRequest(csvForm('payments', csv, 'partial-refund.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
    const { Payment } = await import('./models')
    const pay = await Payment.findOne({ organizationId: orgId, amount: 100 })
    expect(pay?.refundedAmount).toBe(25)
  })

  it('imports families using paymentPlanNumber column', async () => {
    await seedOrg()
    const { PaymentPlan } = await import('./models')
    const plan = await PaymentPlan.findOne({ organizationId: orgId })
    const { POST } = await import('./route-logic/import')
    const csv = [
      'name,weddingDate,paymentPlanNumber',
      `Plan Number Family,2019-07-01,${plan!.planNumber}`,
    ].join('\n')
    const res = await POST(importRequest(csvForm('families', csv, 'plan-num.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
  })

  it('records lifecycle import errors when create throws', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { LifecycleEventPayment } = await import('./models')
    const { POST } = await import('./route-logic/import')
    const spy = vi
      .spyOn(LifecycleEventPayment, 'create')
      .mockRejectedValueOnce(new Error('Lifecycle DB error'))
    const csv = 'familyName,eventType,eventDate,amount\nAPI Route Marker Family,bar_mitzvah,2024-08-01,100'
    try {
      const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-throw.csv')))
      expect(res.status).toBe(200)
      expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects lifecycle import when familyId column is invalid ObjectId', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const csv = 'familyId,eventType,eventDate,amount\nnot-valid,bar_mitzvah,2024-08-01,50'
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-bad-fid.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects lifecycle import when family name does not exist', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const csv = 'familyName,eventType,eventDate,amount\nNo Such Family,bar_mitzvah,2024-08-01,50'
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-no-family.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects lifecycle import when familyId belongs to another org', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const otherFamilyId = new Types.ObjectId().toString()
    const csv = `familyId,eventType,eventDate,amount\n${otherFamilyId},bar_mitzvah,2024-08-01,50`
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-wrong-org.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects lifecycle rows with invalid amount and unknown event type', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')

    const badAmount = await POST(
      importRequest(
        csvForm(
          'lifecycle-events',
          'familyName,eventType,eventDate,amount\nAPI Route Marker Family,bar_mitzvah,2024-08-01,not-money',
          'le-bad-amount.csv',
        ),
      ),
    )
    expect(badAmount.status).toBe(200)
    expect((await badAmount.json()).failed).toBeGreaterThanOrEqual(1)

    const noType = await POST(
      importRequest(
        csvForm(
          'lifecycle-events',
          'familyName,eventType,eventDate\nAPI Route Marker Family,unknown_event_xyz,2024-08-01',
          'le-unknown-type.csv',
        ),
      ),
    )
    expect(noType.status).toBe(200)
    expect((await noType.json()).failed).toBeGreaterThanOrEqual(1)

    const negative = await POST(
      importRequest(
        csvForm(
          'lifecycle-events',
          'familyName,eventType,eventDate,amount\nAPI Route Marker Family,bar_mitzvah,2024-08-01,-5',
          'le-negative.csv',
        ),
      ),
    )
    expect(negative.status).toBe(200)
    expect((await negative.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects lifecycle import when family identifier is missing', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const csv = 'eventType,eventDate,amount\nbar_mitzvah,2024-08-01,50'
    const res = await POST(importRequest(csvForm('lifecycle-events', csv, 'le-no-id.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects payment import when refund exceeds amount', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv = [
      'familyName,amount,paymentDate,type,paymentMethod,refundedAmount',
      'API Route Marker Family,50,2024-06-15,membership,check,100',
    ].join('\n')
    const res = await POST(importRequest(csvForm('payments', csv, 'refund-too-high.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('rejects families import with invalid wedding date', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const csv = 'name,weddingDate\nBad Wedding Date,not-a-date'
    const res = await POST(importRequest(csvForm('families', csv, 'bad-wedding.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('warns when families import references an unknown paymentPlanNumber', async () => {
    await seedOrg()
    const { POST } = await import('./route-logic/import')
    const csv = 'name,weddingDate,paymentPlanNumber\nUnknown Plan Family,2019-07-01,99999'
    const res = await POST(importRequest(csvForm('families', csv, 'bad-plan-num.csv')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(JSON.stringify(body.warnings ?? [])).toMatch(/payment plan 99999 not found/i)
  })

  it('rejects payment import with invalid refundedAmount', async () => {
    await seedOrg()
    await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv =
      'familyName,amount,paymentDate,type,paymentMethod,refundedAmount\nAPI Route Marker Family,50,2024-06-15,membership,check,not-money'
    const res = await POST(importRequest(csvForm('payments', csv, 'bad-refund.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).failed).toBeGreaterThanOrEqual(1)
  })

  it('matches family by name and email together when both are provided', async () => {
    await seedOrg()
    const family = await seedMarkerFamily()
    const { POST } = await import('./route-logic/import')
    const csv =
      'familyName,familyEmail,firstName,lastName\nAPI Route Marker Family,marker-family@import.test,Both,Match'
    const res = await POST(importRequest(csvForm('members', csv, 'both-match.csv')))
    expect(res.status).toBe(200)
    expect((await res.json()).imported).toBe(1)
    const { FamilyMember } = await import('./models')
    const m = await FamilyMember.findOne({ organizationId: orgId, familyId: family._id, firstName: 'Both' })
    expect(m).toBeTruthy()
  })
})
