import { describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { tenantAggregate, tenantMatch } from './tenant-query'

describe('tenantMatch', () => {
  it('scopes queries to org and active rows', () => {
    const orgId = '507f1f77bcf86cd799439011'
    const match = tenantMatch(orgId, { familyId: 'abc' })
    expect(match.organizationId).toBeInstanceOf(Types.ObjectId)
    expect(String(match.organizationId)).toBe(orgId)
    expect(match.deletedAt).toBeNull()
    expect(match.familyId).toBe('abc')
  })
})

describe('tenantAggregate', () => {
  it('returns a $match stage with org ObjectId', () => {
    const stage = tenantAggregate('507f1f77bcf86cd799439011')
    const match = stage.$match as Record<string, unknown>
    expect(match.organizationId).toBeInstanceOf(Types.ObjectId)
    expect(match.deletedAt).toBeNull()
  })
})
