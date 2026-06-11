import { describe, expect, it } from 'vitest'
import {
  sanitizeUploadFilename,
  validateEmailAttachmentFile,
  validateImportFile,
} from './upload-validation'

function file(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('sanitizeUploadFilename', () => {
  it('strips path segments and null bytes', () => {
    expect(sanitizeUploadFilename('foo\\bar\\..\0evil.csv')).toBe('evil.csv')
  })

  it('strips leading dots and falls back to upload', () => {
    expect(sanitizeUploadFilename('...hidden.csv')).toBe('hidden.csv')
    expect(sanitizeUploadFilename('')).toBe('upload')
  })
})

describe('validateImportFile', () => {
  it('accepts csv and xlsx', () => {
    expect(validateImportFile(file('data.csv', 'text/csv')).ok).toBe(true)
    expect(
      validateImportFile(
        file(
          'data.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).ok,
    ).toBe(true)
  })

  it('rejects path traversal in names', () => {
    const res = validateImportFile(file('../secrets.csv', 'text/csv'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(400)
  })

  it('rejects blocked mime types', () => {
    const res = validateImportFile(file('malware.exe', 'application/x-msdownload'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(415)
  })

  it('rejects unknown extensions', () => {
    const res = validateImportFile(file('notes.pdf', 'application/pdf'))
    expect(res.ok).toBe(false)
  })

  it('rejects blocked mime prefixes', () => {
    const res = validateImportFile(file('blob.bin', 'application/octet-stream'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(415)
  })

  it('rejects exact blocked mime types even with csv extension', () => {
    const res = validateImportFile(file('evil.csv', 'application/java-archive'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(415)
  })

  it('rejects csv when mime looks executable', () => {
    const res = validateImportFile(file('data.csv', 'model/vnd.executable'))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(415)
      expect(res.error).toMatch(/MIME type does not match/)
    }
  })

  it('accepts csv with legacy excel mime', () => {
    expect(validateImportFile(file('data.csv', 'application/vnd.ms-excel')).ok).toBe(true)
  })
})

describe('validateEmailAttachmentFile', () => {
  it('rejects svg attachments', () => {
    const res = validateEmailAttachmentFile(file('img.svg', 'image/svg+xml'))
    expect(res.ok).toBe(false)
  })

  it('accepts typical pdf attachments', () => {
    expect(validateEmailAttachmentFile(file('receipt.pdf', 'application/pdf')).ok).toBe(true)
  })

  it('rejects blocked attachment mime types', () => {
    const res = validateEmailAttachmentFile(file('app.apk', 'application/vnd.android.package-archive'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(415)
  })
})
