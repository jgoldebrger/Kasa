import { describe, expect, it, vi } from 'vitest'

const { outBuffer, toBuffer, metadata, png, resize, sharpMock } = vi.hoisted(() => {
  const outBuffer = Buffer.from([137, 80, 78, 71])
  const toBuffer = vi.fn(async () => outBuffer)
  const metadata = vi.fn(async () => ({ width: 1, height: 1 }))
  const png = vi.fn(() => ({ toBuffer }))
  const resize = vi.fn(() => ({ png }))
  const sharpMock = vi.fn((input?: Buffer) => {
    if (input && input.equals(outBuffer)) {
      return { metadata }
    }
    return { resize }
  })
  return { outBuffer, toBuffer, metadata, png, resize, sharpMock }
})

vi.mock('sharp', () => ({
  default: sharpMock,
}))

import { processLogoDataUrl, validateAccentColor } from './branding'

/** Minimal valid 1×1 PNG data URL. */
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('processLogoDataUrl', () => {
  it('rejects non-string or too-short input', async () => {
    expect(await processLogoDataUrl(null as unknown as string)).toEqual({
      error: 'Invalid logo data.',
    })
    expect(await processLogoDataUrl('short')).toEqual({ error: 'Invalid logo data.' })
  })

  it('rejects oversized string before decode', async () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(2.1 * 1024 * 1024)
    expect(await processLogoDataUrl(huge)).toEqual({
      error: 'Logo is too large. Max 1.5 MB before resize.',
    })
  })

  it('rejects non-data-url input', async () => {
    expect(
      await processLogoDataUrl('https://example.com/assets/org-logo-v2.png'),
    ).toEqual({
      error: 'Logo must be a data URL of type png, jpeg, webp, gif, or svg.',
    })
  })

  it('rejects unsupported mime in data URL', async () => {
    const badMime =
      'data:image/bmp;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    expect(await processLogoDataUrl(badMime)).toEqual({
      error: 'Logo must be a data URL of type png, jpeg, webp, gif, or svg.',
    })
  })

  it('processes a valid png data URL', async () => {
    toBuffer.mockClear()
    metadata.mockClear()
    const result = await processLogoDataUrl(TINY_PNG_DATA_URL)
    expect(result).toMatchObject({
      mime: 'image/png',
      width: 1,
      height: 1,
      bytes: outBuffer.length,
    })
    expect('dataUrl' in result && result.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(resize).toHaveBeenCalledWith(256, 256, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    expect(png).toHaveBeenCalled()
    expect(toBuffer).toHaveBeenCalled()
    expect(metadata).toHaveBeenCalled()
  })

  it('retries at 128px when the first resize exceeds the output cap', async () => {
    const huge = Buffer.alloc(210 * 1024, 1)
    toBuffer
      .mockResolvedValueOnce(huge)
      .mockResolvedValueOnce(outBuffer)
    resize.mockClear()

    const result = await processLogoDataUrl(TINY_PNG_DATA_URL)
    expect(result).toMatchObject({ mime: 'image/png', bytes: outBuffer.length })
    expect(resize).toHaveBeenCalledTimes(2)
    expect(resize).toHaveBeenNthCalledWith(2, 128, 128, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  })

  it('rejects when base64 payload cannot be decoded', async () => {
    const fromSpy = vi.spyOn(Buffer, 'from').mockImplementationOnce(() => {
      throw new Error('invalid base64')
    })
    expect(await processLogoDataUrl(TINY_PNG_DATA_URL)).toEqual({
      error: 'Could not decode logo data.',
    })
    fromSpy.mockRestore()
  })

  it('rejects decoded payload larger than 1.5 MB', async () => {
    const big = Buffer.alloc(1.5 * 1024 * 1024 + 1, 1)
    const dataUrl = `data:image/png;base64,${big.toString('base64')}`
    expect(await processLogoDataUrl(dataUrl)).toEqual({
      error: 'Logo is too large. Max 1.5 MB before resize.',
    })
  })

  it('rejects when compression cannot get below 200KB', async () => {
    const huge = Buffer.alloc(210 * 1024, 1)
    toBuffer.mockResolvedValueOnce(huge).mockResolvedValueOnce(huge)

    expect(await processLogoDataUrl(TINY_PNG_DATA_URL)).toEqual({
      error: 'Logo could not be compressed below 200KB. Try a simpler image.',
    })
  })

  it('returns a generic error when sharp fails', async () => {
    toBuffer.mockRejectedValueOnce(new Error('sharp boom'))

    const result = await processLogoDataUrl(TINY_PNG_DATA_URL)
    expect(result).toEqual({
      error: 'Could not process logo (png). It may be malformed.',
    })
  })
})

describe('validateAccentColor', () => {
  it('accepts valid hex, nullish, and rejects invalid values', () => {
    expect(validateAccentColor(null)).toBeNull()
    expect(validateAccentColor(undefined)).toBeNull()
    expect(validateAccentColor('')).toBeNull()
    expect(validateAccentColor('#4F46E5')).toBe('#4f46e5')
    expect(validateAccentColor('#abc')).toBe('#abc')
    expect(validateAccentColor(42)).toEqual({ error: 'Accent color must be a hex string.' })
    expect(validateAccentColor('blue')).toEqual({
      error: 'Accent color must be a hex like #4f46e5.',
    })
  })
})
