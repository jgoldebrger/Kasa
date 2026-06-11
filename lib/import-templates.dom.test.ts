/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  downloadImportTemplate,
  downloadXlsxBlob,
  getImportColumns,
} from './import-templates'

describe('downloadImportTemplate (browser)', () => {
  const click = vi.fn()

  beforeEach(() => {
    click.mockClear()
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
    } as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)
    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloadXlsxBlob triggers anchor download', () => {
    downloadXlsxBlob(new Uint8Array([1, 2]).buffer, 'test.xlsx')
    const anchor = vi.mocked(document.createElement).mock.results[0]?.value as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('test.xlsx')
    expect(click).toHaveBeenCalled()
  })

  it('downloads families template with default filename', async () => {
    await downloadImportTemplate('families')

    const anchor = vi.mocked(document.createElement).mock.results[0]?.value as unknown as HTMLAnchorElement
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(window.URL.createObjectURL).toHaveBeenCalled()
    expect(anchor.download).toBe('families-template.xlsx')
    expect(click).toHaveBeenCalled()
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    expect(getImportColumns('families').some((c) => c.key === 'name')).toBe(true)
  })

  it('downloads payments template bound to family without familyKey columns', async () => {
    await downloadImportTemplate('payments', { boundToFamily: true })

    const anchor = vi.mocked(document.createElement).mock.results[0]?.value as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('payments-template-family.xlsx')
    expect(getImportColumns('payments', { boundToFamily: true }).every((c) => !c.familyKey)).toBe(
      true,
    )
    expect(click).toHaveBeenCalled()
  })

  it('downloads full payments template with currency columns', async () => {
    await downloadImportTemplate('payments')
    const anchor = vi.mocked(document.createElement).mock.results[0]?.value as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('payments-template.xlsx')
    expect(getImportColumns('payments').some((c) => c.type === 'currency')).toBe(true)
  })

  it('downloads members and lifecycle-events templates with date and rtl columns', async () => {
    await downloadImportTemplate('members')
    expect(
      (vi.mocked(document.createElement).mock.results[0]?.value as unknown as HTMLAnchorElement).download,
    ).toBe('members-template.xlsx')

    await downloadImportTemplate('lifecycle-events')
    expect(
      (vi.mocked(document.createElement).mock.results.at(-1)?.value as unknown as HTMLAnchorElement).download,
    ).toBe('lifecycle-events-template.xlsx')
  })
})
