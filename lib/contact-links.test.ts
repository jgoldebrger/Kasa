import { describe, expect, it } from 'vitest'
import { mailtoHref, phoneTelHref } from './contact-links'

describe('contact-links', () => {
  it('builds tel href for US numbers', () => {
    expect(phoneTelHref('5551234567')).toBe('tel:+15551234567')
    expect(phoneTelHref('(555) 123-4567')).toBe('tel:+15551234567')
    expect(phoneTelHref('15551234567')).toBe('tel:+15551234567')
  })

  it('builds mailto href', () => {
    expect(mailtoHref(' family@example.com ')).toBe('mailto:family@example.com')
    expect(mailtoHref('')).toBe('')
  })
})
