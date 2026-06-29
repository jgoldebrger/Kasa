import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { blockReadOnlySupportMutation } from './support-mode-readonly-guard'
import type { OrgContext } from '@/lib/auth-helpers'

function req(method: string, path: string) {
  return new NextRequest(new URL(`http://localhost${path}`), { method })
}

const readOnlyCtx = {
  isPlatformImpersonationReadOnly: true,
} as OrgContext

describe('blockReadOnlySupportMutation', () => {
  it('allows GET requests', () => {
    expect(blockReadOnlySupportMutation(req('GET', '/api/families'), readOnlyCtx)).toBeNull()
  })

  it('blocks POST mutations', () => {
    const res = blockReadOnlySupportMutation(req('POST', '/api/families'), readOnlyCtx)
    expect(res?.status).toBe(403)
  })

  it('allows preview POST endpoints', () => {
    expect(
      blockReadOnlySupportMutation(
        req('POST', '/api/email-automation-rules/abc/preview'),
        readOnlyCtx,
      ),
    ).toBeNull()
  })

  it('allows when not read-only support', () => {
    expect(
      blockReadOnlySupportMutation(req('POST', '/api/families'), {
        isPlatformImpersonation: true,
      } as OrgContext),
    ).toBeNull()
  })
})
