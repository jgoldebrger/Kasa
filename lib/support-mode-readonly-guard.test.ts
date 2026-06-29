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

  it('blocks POST mutations', async () => {
    const res = blockReadOnlySupportMutation(req('POST', '/api/families'), readOnlyCtx)
    expect(res?.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toMatch(/read-only/i)
  })

  it('blocks PUT, PATCH, and DELETE', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const res = blockReadOnlySupportMutation(req(method, '/api/families/abc'), readOnlyCtx)
      expect(res?.status).toBe(403)
    }
  })

  it('blocks bypass worker routes that mutate outside the handler', () => {
    const workerPaths = [
      '/api/emails/send-bulk/worker',
      '/api/statements/send-emails/worker',
      '/api/tax-receipts/email/worker',
    ]
    for (const path of workerPaths) {
      const res = blockReadOnlySupportMutation(req('POST', path), readOnlyCtx)
      expect(res?.status).toBe(403)
    }
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

  it('allows when ctx is undefined', () => {
    expect(blockReadOnlySupportMutation(req('POST', '/api/families'), undefined)).toBeNull()
  })
})
