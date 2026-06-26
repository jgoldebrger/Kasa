/** Insert plain text at the current caret in a contentEditable region. */
export function insertTextInContentEditable(text: string): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  selection.deleteFromDocument()
  const range = selection.getRangeAt(0)
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.setEndAfter(node)
  selection.removeAllRanges()
  selection.addRange(range)
}
