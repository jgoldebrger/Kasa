import { afterEach, describe, expect, it } from 'vitest'
import {
  getOidcConfig,
  getOidcPublicStatus,
  isOidcConfigured,
  parseOidcDomainOrgMap,
} from './oidc-config'

describe('oidc-config', () => {
  const prev = { ...process.env }

  afterEach(() => {
    process.env = { ...prev }
  })

  describe('parseOidcDomainOrgMap', () => {
    it('returns an empty map for blank input', () => {
      expect(parseOidcDomainOrgMap(undefined).size).toBe(0)
      expect(parseOidcDomainOrgMap('').size).toBe(0)
      expect(parseOidcDomainOrgMap('  ,  ').size).toBe(0)
    })

    it('parses domain:slug pairs with normalization', () => {
      const map = parseOidcDomainOrgMap(' Example.COM : My-Org , other.org:beta ')
      expect(map.get('example.com')).toBe('my-org')
      expect(map.get('other.org')).toBe('beta')
    })

    it('skips malformed entries', () => {
      const map = parseOidcDomainOrgMap('nodomain, :slug, domain:, valid.org:ok')
      expect(map.size).toBe(1)
      expect(map.get('valid.org')).toBe('ok')
    })
  })

  describe('getOidcConfig', () => {
    it('returns null when any required var is missing', () => {
      delete process.env.OIDC_ISSUER
      delete process.env.OIDC_CLIENT_ID
      delete process.env.OIDC_CLIENT_SECRET
      expect(getOidcConfig()).toBeNull()

      process.env.OIDC_ISSUER = 'https://accounts.google.com'
      process.env.OIDC_CLIENT_ID = 'client'
      expect(getOidcConfig()).toBeNull()
    })

    it('returns config when issuer, client id, and secret are set', () => {
      process.env.OIDC_ISSUER = ' https://idp.example.com '
      process.env.OIDC_CLIENT_ID = ' app-client '
      process.env.OIDC_CLIENT_SECRET = ' secret '
      process.env.OIDC_PROVIDER_NAME = ' Google Workspace '
      process.env.OIDC_DOMAIN_ORG_MAP = 'example.com:acme'

      const config = getOidcConfig()
      expect(config).toEqual({
        issuer: 'https://idp.example.com',
        clientId: 'app-client',
        clientSecret: 'secret',
        providerName: 'Google Workspace',
        domainOrgMap: new Map([['example.com', 'acme']]),
      })
    })
  })

  describe('isOidcConfigured / getOidcPublicStatus', () => {
    it('reports disabled when OIDC is not fully configured', () => {
      delete process.env.OIDC_ISSUER
      delete process.env.OIDC_CLIENT_ID
      delete process.env.OIDC_CLIENT_SECRET
      expect(isOidcConfigured()).toBe(false)
      expect(getOidcPublicStatus()).toEqual({
        enabled: false,
        providerName: 'SSO',
        hasDomainMapping: false,
      })
    })

    it('reports enabled public status without secrets', () => {
      process.env.OIDC_ISSUER = 'https://accounts.google.com'
      process.env.OIDC_CLIENT_ID = 'client'
      process.env.OIDC_CLIENT_SECRET = 'secret'
      process.env.OIDC_DOMAIN_ORG_MAP = 'example.com:acme'

      expect(isOidcConfigured()).toBe(true)
      expect(getOidcPublicStatus()).toEqual({
        enabled: true,
        providerName: 'SSO',
        hasDomainMapping: true,
      })
    })
  })
})
