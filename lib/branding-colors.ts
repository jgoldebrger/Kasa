const ACCENT_CSS_VARS = ['--c-accent', '--c-accent-hover', '--c-accent-soft'] as const

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Parse a `#rgb` or `#rrggbb` hex string into RGB channels. */
export function hexToRgb(hex: string): Rgb | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null

  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized

  const n = parseInt(expanded, 16)
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  }
}

/** Format channels as a CSS RGB triplet (`"79 70 229"`). */
export function rgbTriplet({ r, g, b }: Rgb): string {
  return `${r} ${g} ${b}`
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function mix(from: number, to: number, t: number): number {
  return clamp(from + (to - from) * t)
}

/** Slightly darker in light mode, lighter in dark mode — matches globals.css defaults. */
export function accentHoverRgb(rgb: Rgb, isDark: boolean): Rgb {
  if (isDark) {
    return {
      r: mix(rgb.r, 255, 0.2),
      g: mix(rgb.g, 255, 0.2),
      b: mix(rgb.b, 255, 0.2),
    }
  }
  return {
    r: mix(rgb.r, 0, 0.15),
    g: mix(rgb.g, 0, 0.15),
    b: mix(rgb.b, 0, 0.15),
  }
}

/** Tinted background for accent badges / highlights. */
export function accentSoftRgb(rgb: Rgb, isDark: boolean): Rgb {
  if (isDark) {
    return {
      r: mix(rgb.r, 10, 0.7),
      g: mix(rgb.g, 10, 0.7),
      b: mix(rgb.b, 10, 0.7),
    }
  }
  return {
    r: mix(rgb.r, 255, 0.92),
    g: mix(rgb.g, 255, 0.92),
    b: mix(rgb.b, 255, 0.92),
  }
}

export function applyAccentCssVars(
  accentColor: string,
  isDark: boolean,
  root: HTMLElement = document.documentElement,
): void {
  const rgb = hexToRgb(accentColor)
  if (!rgb) return

  const hover = accentHoverRgb(rgb, isDark)
  const soft = accentSoftRgb(rgb, isDark)

  root.style.setProperty('--c-accent', rgbTriplet(rgb))
  root.style.setProperty('--c-accent-hover', rgbTriplet(hover))
  root.style.setProperty('--c-accent-soft', rgbTriplet(soft))
}

export function clearAccentCssVars(root: HTMLElement = document.documentElement): void {
  for (const v of ACCENT_CSS_VARS) {
    root.style.removeProperty(v)
  }
}
