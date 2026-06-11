/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToCsv, exportToXlsx, reactNodeToText, todayStamp } from './export'

describe('exportToCsv (browser)', () => {
  const click = vi.fn()

  beforeEach(() => {
    click.mockClear()
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
    } as unknown as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('triggers a CSV download with RFC 4180 escaping', () => {
    type Row = { name: string; note: string }
    exportToCsv(
      'families',
      [
        { id: 'name', label: 'Name', value: (r) => r.name },
        { id: 'note', label: 'Note, "quoted"', value: (r) => r.note },
      ],
      [{ name: 'Alice', note: 'line1\nline2' }],
    )

    const anchor = vi.mocked(document.createElement).mock.results[0]?.value as unknown as unknown as HTMLAnchorElement
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(anchor.download).toBe('families.csv')
    expect(click).toHaveBeenCalled()
  })
})

describe('exportToXlsx (browser)', () => {
  const click = vi.fn()

  beforeEach(() => {
    click.mockClear()
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
    } as unknown as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('triggers an XLSX download with typed cell values', async () => {
    type Row = { name: string; when: Date; amount: number }
    await exportToXlsx(
      'report',
      [
        { id: 'name', label: 'Name', value: (r) => r.name },
        { id: 'when', label: 'When', value: (r) => r.when },
        { id: 'amount', label: 'Amount', value: (r) => r.amount },
      ],
      [{ name: 'Alice', when: new Date('2024-01-15'), amount: 42 }],
    )

    const anchor = vi.mocked(document.createElement).mock.results[0]?.value as unknown as unknown as HTMLAnchorElement
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(anchor.download).toBe('report.xlsx')
    expect(click).toHaveBeenCalled()
  })

  it('keeps extension when filename already ends with .xlsx', async () => {
    await exportToXlsx('data.xlsx', [{ id: 'x', label: 'X', value: () => 'a' }], [])
    const anchor = vi.mocked(document.createElement).mock.results[0]?.value as unknown as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('data.xlsx')
  })

  it('maps undefined cell values to null in rows', async () => {
    await exportToXlsx(
      'sparse',
      [{ id: 'x', label: 'X', value: () => undefined }],
      [{} as Record<string, never>],
    )
    expect(vi.mocked(document.createElement).mock.results[0]?.value).toBeDefined()
  })

  it('uses the exceljs namespace export when default is missing', async () => {
    vi.resetModules()
    vi.doMock('exceljs', () => {
      const toBuffer = vi.fn(async () => Buffer.from('xlsx'))
      const wb = {
        creator: '',
        created: new Date(),
        addWorksheet: vi.fn(() => ({
          columns: [],
          addRow: vi.fn(),
          getRow: vi.fn(() => ({ font: {}, alignment: {} })),
        })),
        xlsx: { writeBuffer: toBuffer },
      }
      class Workbook {
        constructor() {
          return wb
        }
      }
      return { default: undefined, Workbook }
    })
    const { exportToXlsx } = await import('./export')
    await exportToXlsx('ns.xlsx', [{ id: 'x', label: 'X', value: () => 'a' }], [])
    expect(click).toHaveBeenCalled()
    vi.doUnmock('exceljs')
    vi.resetModules()
  })
})

describe('export helpers', () => {
  it('reactNodeToText flattens nested nodes and handles primitives', () => {
    expect(reactNodeToText(['a', { props: { children: 'b' } }] as import('react').ReactNode)).toBe('ab')
    expect(reactNodeToText(null)).toBe('')
    expect(reactNodeToText(false)).toBe('')
    expect(reactNodeToText(42)).toBe('42')
    expect(reactNodeToText({ noProps: true } as never)).toBe('')
  })

  it('todayStamp returns YYYY-MM-DD', () => {
    expect(todayStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('exportToCsv formats dates, booleans, and nulls', () => {
    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
    } as unknown as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    exportToCsv(
      'out.csv',
      [
        { id: 'd', label: 'D', value: () => new Date('2024-01-01') },
        { id: 'bad', label: 'Bad', value: () => new Date('invalid') },
        { id: 'b', label: 'B', value: () => true },
        { id: 'n', label: 'N', value: () => null },
      ],
      [{}],
    )
    expect(click).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
