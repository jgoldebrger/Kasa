import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/auth-helpers', () => ({ requireOrg: vi.fn() }))
vi.mock('@/lib/database', () => ({ default: vi.fn(async () => ({})) }))

import {
  normalizeColumnName,
  parseCSV,
  parseDate,
  parseMoneyAmount,
  xlsxCellToString,
} from './route-logic/import'

describe('import-csv parsers', () => {
  it('parseCSV handles BOM, quoted commas, and embedded newlines', () => {
    const csv = '\uFEFFname,weddingDate\n"Family, Inc","2020-06-01"\n"Line2\nField",2019-01-01\n'
    const { headers, rows } = parseCSV(csv)
    expect(headers).toEqual(['name', 'weddingDate'])
    expect(rows).toHaveLength(2)
    expect(rows[0][0]).toBe('Family, Inc')
    expect(rows[1][0]).toBe('Line2\nField')
  })

  it('parseCSV treats doubled quotes inside quoted fields as a literal quote', () => {
    const { rows } = parseCSV('name,note\n"O""Brien","said ""hi"""\n')
    expect(rows[0][0]).toBe('O"Brien')
    expect(rows[0][1]).toBe('said "hi"')
  })

  it('normalizeColumnName strips spaces and punctuation', () => {
    expect(normalizeColumnName('Payment Plan ID')).toBe('paymentplanid')
    expect(normalizeColumnName('wedding_date')).toBe('weddingdate')
  })

  it('parseDate uses local midnight for YYYY-MM-DD', () => {
    const d = parseDate('2020-06-15')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2020)
    expect(d!.getMonth()).toBe(5)
    expect(d!.getDate()).toBe(15)
  })

  it('parseDate rejects unparseable input', () => {
    expect(parseDate('')).toBeNull()
    expect(parseDate('not-a-date')).toBeNull()
  })

  it('parseMoneyAmount accepts currency formatting', () => {
    expect(parseMoneyAmount('$1,234.50')).toBe(1234.5)
    expect(parseMoneyAmount('')).toBeNull()
    expect(parseMoneyAmount('12.345')).toBeNull()
  })

  it('xlsxCellToString coerces exceljs value shapes', () => {
    expect(xlsxCellToString(null)).toBe('')
    expect(xlsxCellToString(new Date('2021-03-02T12:00:00Z'))).toBe('2021-03-02')
    expect(xlsxCellToString({ text: 'hello' })).toBe('hello')
    expect(xlsxCellToString({ result: 42 })).toBe('42')
    expect(
      xlsxCellToString({ richText: [{ text: 'a' }, { text: 'b' }] }),
    ).toBe('ab')
  })
})
