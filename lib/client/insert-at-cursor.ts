/** Insert text at the current caret position in an input or textarea. */
export function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  currentValue: string,
  insert: string,
  onChange: (next: string) => void,
) {
  const start = el.selectionStart ?? currentValue.length
  const end = el.selectionEnd ?? currentValue.length
  const next = currentValue.slice(0, start) + insert + currentValue.slice(end)
  onChange(next)
  const pos = start + insert.length
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}
