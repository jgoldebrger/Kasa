import { describe, it, expect } from 'vitest'
import { validateImpersonateBody } from './organization-impersonate'

describe('validateImpersonateBody', () => {
  it('accepts a valid reason and readOnly flag', () => {
    expect(validateImpersonateBody({ reason: 'Customer billing issue', readOnly: true })).toEqual({
      ok: true,
      reason: 'Customer billing issue',
      readOnly: true,
    })
  })

  it('defaults readOnly to false', () => {
    expect(validateImpersonateBody({ reason: 'Help desk ticket' })).toEqual({
      ok: true,
      reason: 'Help desk ticket',
      readOnly: false,
    })
  })

  it('rejects missing body', () => {
    expect(validateImpersonateBody(null)).toEqual({
      ok: false,
      error: 'Request body required',
    })
  })

  it('rejects missing reason', () => {
    expect(validateImpersonateBody({})).toEqual({
      ok: false,
      error: 'Reason is required',
    })
  })

  it('rejects reason shorter than 3 characters', () => {
    expect(validateImpersonateBody({ reason: 'ab' })).toEqual({
      ok: false,
      error: 'Reason must be at least 3 characters',
    })
  })

  it('rejects reason longer than 500 characters', () => {
    expect(validateImpersonateBody({ reason: 'x'.repeat(501) })).toEqual({
      ok: false,
      error: 'Reason must be at most 500 characters',
    })
  })
})
