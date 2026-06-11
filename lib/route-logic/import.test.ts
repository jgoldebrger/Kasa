/**
 * lib/route-logic/import.ts parser unit coverage.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/api/handler', () => ({
  handler: (opts: { fn: (...args: unknown[]) => unknown }) => {
    return async (...args: unknown[]) => opts.fn(...(args as []))
  },
}))

describe('import route-logic parsers', () => {
  it('parseCSV handles CRLF row terminators', async () => {
    const { parseCSV } = await import('./import')
    const { headers, rows } = parseCSV('name,weddingDate\r\nAlpha,2018-01-01\r\nBeta,2019-02-02\r\n')
    expect(headers).toEqual(['name', 'weddingDate'])
    expect(rows).toHaveLength(2)
    expect(rows[0][0]).toBe('Alpha')
  })

  it('xlsxCellToString reads hyperlink cells', async () => {
    const { xlsxCellToString } = await import('./import')
    expect(xlsxCellToString({ hyperlink: 'http://x', text: 'Link label' })).toBe('Link label')
  })

  it('parseDate rejects years outside 1900-2200 for non-ISO strings', async () => {
    const { parseDate } = await import('./import')
    expect(parseDate('January 1, 1800')).toBeNull()
  })

  it('parseDate accepts in-range non-ISO date strings', async () => {
    const { parseDate } = await import('./import')
    const d = parseDate('June 15, 2020')
    expect(d).toBeInstanceOf(Date)
    expect(d!.getFullYear()).toBe(2020)
  })

  it('xlsxCellToString uses hyperlink branch when text is absent from first check', async () => {
    const { xlsxCellToString } = await import('./import')
    const obj = Object.create(null) as Record<string, unknown>
    obj.hyperlink = 'http://example.com'
    Object.defineProperty(obj, 'text', { value: 'Display', enumerable: false })
    expect(xlsxCellToString(obj)).toBe('Display')
  })

  it('parseCSV handles bare CR row terminators and closing quotes', async () => {
    const { parseCSV } = await import('./import')
    const bareCr = parseCSV('name,note\rAlpha,"done"\r')
    expect(bareCr.rows[0][0]).toBe('Alpha')
    const closeQuote = parseCSV('name,note\n"done"')
    expect(closeQuote.rows[0][0]).toBe('done')
  })

  it('parseCSV handles doubled-quote escape inside quoted fields', async () => {
    const { parseCSV } = await import('./import')
    const { rows } = parseCSV('name,note\n"O""Brien","x"\n')
    expect(rows[0][0]).toBe('O"Brien')
  })

  it('xlsxCellToString coerces exceljs value shapes', async () => {
    const { xlsxCellToString } = await import('./import')
    expect(xlsxCellToString(null)).toBe('')
    expect(xlsxCellToString(new Date('2021-03-02T12:00:00Z'))).toBe('2021-03-02')
    expect(xlsxCellToString({ text: 'hello' })).toBe('hello')
    expect(xlsxCellToString({ result: 42 })).toBe('42')
    expect(xlsxCellToString({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab')
    expect(xlsxCellToString({ hyperlink: 'http://x', text: 'Link' })).toBe('Link')
  })

  it('normalizeColumnName strips spaces and punctuation', async () => {
    const { normalizeColumnName } = await import('./import')
    expect(normalizeColumnName('Payment Plan ID')).toBe('paymentplanid')
    expect(normalizeColumnName('wedding_date')).toBe('weddingdate')
  })

  it('parseMoneyAmount accepts currency formatting', async () => {
    const { parseMoneyAmount } = await import('./import')
    expect(parseMoneyAmount('$1,234.50')).toBe(1234.5)
    expect(parseMoneyAmount('')).toBeNull()
    expect(parseMoneyAmount('12.345')).toBeNull()
  })
})
