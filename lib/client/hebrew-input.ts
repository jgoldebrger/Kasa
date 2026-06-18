import type React from 'react'

/** QWERTY → Hebrew keyboard mapping for phonetic typing in Hebrew fields. */
export const qwertyToHebrew: Record<string, string> = {
  q: '/',
  w: "'",
  e: 'ק',
  r: 'ר',
  t: 'א',
  y: 'ט',
  u: 'ו',
  i: 'ן',
  o: 'ם',
  p: 'פ',
  a: 'ש',
  s: 'ד',
  d: 'ג',
  f: 'כ',
  g: 'ע',
  h: 'י',
  j: 'ח',
  k: 'ל',
  l: 'ך',
  z: 'ז',
  x: 'ס',
  c: 'ב',
  v: 'ה',
  b: 'נ',
  n: 'מ',
  m: 'צ',
  Q: '/',
  W: "'",
  E: 'ק',
  R: 'ר',
  T: 'א',
  Y: 'ט',
  U: 'ו',
  I: 'ן',
  O: 'ם',
  P: 'פ',
  A: 'ש',
  S: 'ד',
  D: 'ג',
  F: 'כ',
  G: 'ע',
  H: 'י',
  J: 'ח',
  K: 'ל',
  L: 'ך',
  Z: 'ז',
  X: 'ס',
  C: 'ב',
  V: 'ה',
  B: 'נ',
  N: 'מ',
  M: 'צ',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '0': '0',
  '-': '-',
  '=': '=',
  '[': ']',
  ']': '[',
  '\\': '\\',
  ';': 'ף',
  "'": ',',
  ',': 'ת',
  '.': 'ץ',
  '/': '.',
  ' ': ' ',
}

/** Map QWERTY keystrokes to Hebrew characters at the cursor in a controlled input. */
export function handleHebrewInput(
  e: React.KeyboardEvent<HTMLInputElement>,
  setValue: React.Dispatch<React.SetStateAction<string>>,
) {
  const input = e.currentTarget
  const cursorPosition = input.selectionStart ?? 0

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    const hebrewChar = qwertyToHebrew[e.key] ?? e.key
    setValue((currentValue) => {
      const next =
        currentValue.slice(0, cursorPosition) + hebrewChar + currentValue.slice(cursorPosition)
      return next
    })
    const nextPos = cursorPosition + 1
    requestAnimationFrame(() => {
      input.setSelectionRange(nextPos, nextPos)
    })
  }
}
