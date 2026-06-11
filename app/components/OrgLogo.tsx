'use client'

import { useOrgBranding } from '@/lib/client/useOrgBranding'

interface OrgLogoProps {
  size?: number
  /** Override the displayed initial when no logo is set. Defaults to org name → 'K'. */
  fallbackChar?: string
  className?: string
  /** Optional explicit alt text. Defaults to '' to keep this purely decorative
   *  in contexts where it sits next to the org name. */
  alt?: string
}

/**
 * Renders the active org's uploaded logo if one exists, otherwise a neutral
 * accent-colored tile with the org's first letter. Sized in CSS pixels.
 *
 * Used in Sidebar header, MobileTopBar, OrgSwitcher, and any other chrome.
 */
export default function OrgLogo({
  size = 32,
  fallbackChar,
  className = '',
  alt = '',
}: OrgLogoProps) {
  const { branding } = useOrgBranding()
  // Prefer the binary, long-cached endpoint over the inline data URL.
  // Falls back to the data URL when an older cached response (or a stale
  // build) doesn't include logoUrl yet.
  const logo = branding.logoUrl || branding.logoDataUrl
  const initial =
    (fallbackChar || branding.name?.trim()?.[0] || 'K').toUpperCase()

  const sizeStyle = { width: size, height: size }
  const fontSize = Math.max(10, Math.round(size * 0.45))

  if (logo) {
    return (
      <img
        src={logo}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={`rounded-md object-cover border border-border bg-surface ${className}`}
        style={sizeStyle}
      />
    )
  }

  return (
    <div
      className={`bg-accent text-accent-fg rounded-md flex items-center justify-center font-semibold ${className}`}
      style={{ ...sizeStyle, fontSize }}
      aria-hidden={alt === ''}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
    >
      {initial}
    </div>
  )
}
