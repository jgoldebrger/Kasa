export type TextAlign = 'start' | 'end' | 'center' | 'left' | 'right'

export function textAlignClass(align?: TextAlign): string {
  if (align === 'center') return 'text-center'
  if (align === 'end' || align === 'right') return 'text-end'
  return 'text-start'
}
