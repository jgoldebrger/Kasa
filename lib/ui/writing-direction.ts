export type WritingDirection = 'ltr' | 'rtl'

export function getWritingDirection(node?: Element | null): WritingDirection {
  if (typeof document === 'undefined') return 'ltr'
  const raw =
    (node && (node.closest('[dir]') as HTMLElement | null)?.dir) ||
    document.documentElement.getAttribute('dir') ||
    'ltr'
  return raw === 'rtl' ? 'rtl' : 'ltr'
}

export function horizontalNavDelta(key: string, dir: WritingDirection): -1 | 0 | 1 {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0
  const forward = key === 'ArrowRight' ? 1 : -1
  return (dir === 'rtl' ? -forward : forward) as -1 | 1
}
