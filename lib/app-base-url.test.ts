import { describe, expect, it, afterEach } from 'vitest'
import { resolveAppBaseUrl } from './app-base-url'

describe('resolveAppBaseUrl', () => {
  const prev = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_URL: process.env.AUTH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('prefers APP_BASE_URL', () => {
    process.env.APP_BASE_URL = 'https://app.example.com/'
    delete process.env.NEXTAUTH_URL
    expect(resolveAppBaseUrl()).toBe('https://app.example.com')
  })

  it('falls back to VERCEL_URL', () => {
    delete process.env.APP_BASE_URL
    delete process.env.NEXTAUTH_URL
    process.env.VERCEL_URL = 'kasa-preview.vercel.app'
    expect(resolveAppBaseUrl()).toBe('https://kasa-preview.vercel.app')
  })
})
