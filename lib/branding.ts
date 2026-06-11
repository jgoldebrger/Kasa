/**
 * Per-org branding helpers.
 *
 * We store the org logo as a base64 data URL on the Organization document
 * itself. This keeps us off any blob-storage dependency at the cost of a
 * little Mongo bloat — capped at ~200KB per org via server-side resize.
 */

import sharp from 'sharp'

/** Max final size (bytes) of the encoded data URL payload (the base64 part). */
const MAX_OUTPUT_BYTES = 200 * 1024
/** Max accepted upload before resize (1.5 MB). Heavier rejections happen below. */
const MAX_INPUT_BYTES = 1.5 * 1024 * 1024
/** Target dimensions for the rendered logo. 256×256 is plenty for sidebar use. */
const TARGET_PX = 256

const DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i

export interface ProcessedLogo {
  dataUrl: string
  bytes: number
  width: number
  height: number
  mime: string
}

export interface BrandingError {
  error: string
}

/**
 * Validate, decode, resize, and re-encode an uploaded logo data URL.
 * Returns either a `ProcessedLogo` (success) or `BrandingError` (4xx-style).
 */
export async function processLogoDataUrl(input: string): Promise<ProcessedLogo | BrandingError> {
  if (typeof input !== 'string' || input.length < 32) {
    return { error: 'Invalid logo data.' }
  }
  if (input.length > MAX_INPUT_BYTES * 1.4) {
    // base64 expands payload by ~33% — reject obviously oversized uploads early.
    return { error: 'Logo is too large. Max 1.5 MB before resize.' }
  }

  const match = DATA_URL_RE.exec(input)
  if (!match) {
    return { error: 'Logo must be a data URL of type png, jpeg, webp, gif, or svg.' }
  }

  const declaredMime = match[1].toLowerCase()
  const b64 = match[2]
  let raw: Buffer
  try {
    raw = Buffer.from(b64, 'base64')
  } catch {
    return { error: 'Could not decode logo data.' }
  }
  if (raw.length === 0) return { error: 'Logo data is empty.' }
  if (raw.length > MAX_INPUT_BYTES) {
    return { error: 'Logo is too large. Max 1.5 MB before resize.' }
  }

  try {
    // sharp handles SVG -> raster via rsvg. For SVG, we still need a sensible
    // base resolution; sharp's defaults are reasonable for 256px output.
    const pipeline = sharp(raw, { failOn: 'none', limitInputPixels: 64_000_000 })
      .resize(TARGET_PX, TARGET_PX, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })

    let out = await pipeline.toBuffer()
    // If the resized PNG still exceeds the cap, retry at lower target size.
    if (out.length > MAX_OUTPUT_BYTES) {
      out = await sharp(raw, { failOn: 'none', limitInputPixels: 64_000_000 })
        .resize(128, 128, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer()
    }
    if (out.length > MAX_OUTPUT_BYTES) {
      return { error: 'Logo could not be compressed below 200KB. Try a simpler image.' }
    }

    const meta = await sharp(out).metadata()
    const dataUrl = `data:image/png;base64,${out.toString('base64')}`
    return {
      dataUrl,
      bytes: out.length,
      width: meta.width || TARGET_PX,
      height: meta.height || TARGET_PX,
      mime: 'image/png',
    }
  } catch (err: any) {
    // Surface a generic message; details go to the server log via handler().
    return { error: `Could not process logo (${declaredMime}). It may be malformed.` }
  }
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function validateAccentColor(input: unknown): string | null | { error: string } {
  if (input === null || input === undefined || input === '') return null
  if (typeof input !== 'string') return { error: 'Accent color must be a hex string.' }
  const v = input.trim()
  if (!HEX_RE.test(v)) return { error: 'Accent color must be a hex like #4f46e5.' }
  return v.toLowerCase()
}
