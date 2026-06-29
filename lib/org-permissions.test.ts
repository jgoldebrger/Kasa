import { describe, expect, it } from 'vitest'
import { hasOrgPermission, isPresetOrgRole } from '@/lib/org-permissions'

describe('org-permissions', () => {
  it('treasurer can read payments and reports but not write communications', () => {
    expect(hasOrgPermission('treasurer', 'payments:read')).toBe(true)
    expect(hasOrgPermission('treasurer', 'reports:read')).toBe(true)
    expect(hasOrgPermission('treasurer', 'communications:write')).toBe(false)
  })

  it('communications role can write communications but not payments', () => {
    expect(hasOrgPermission('communications', 'communications:write')).toBe(true)
    expect(hasOrgPermission('communications', 'payments:read')).toBe(false)
  })

  it('admin satisfies any permission', () => {
    expect(hasOrgPermission('admin', 'payments:read')).toBe(true)
    expect(hasOrgPermission('admin', 'communications:write')).toBe(true)
  })

  it('identifies preset roles', () => {
    expect(isPresetOrgRole('treasurer')).toBe(true)
    expect(isPresetOrgRole('owner')).toBe(false)
  })
})
