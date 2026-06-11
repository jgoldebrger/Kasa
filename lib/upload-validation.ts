/**
 * Shared upload validation for import and email-attachment endpoints.
 */

const BLOCKED_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/vnd.microsoft.portable-executable',
  'application/octet-stream',
]

const BLOCKED_MIME_EXACT = new Set([
  'application/x-msdownload',
  'application/java-archive',
  'application/vnd.android.package-archive',
])

export function sanitizeUploadFilename(name: string): string {
  const stripped = name.replace(/\0/g, '').replace(/\\/g, '/')
  const base = stripped.split('/').pop() || 'upload'
  return base.replace(/^\.+/, '') || 'upload'
}

export function validateImportFile(file: File): { ok: true } | { ok: false; error: string; status: number } {
  const name = (file.name || '').toLowerCase()
  const type = (file.type || '').toLowerCase().trim()

  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return { ok: false, error: 'Invalid file name', status: 400 }
  }

  if (type && BLOCKED_MIME_EXACT.has(type)) {
    return { ok: false, error: 'File type not allowed', status: 415 }
  }
  if (type && BLOCKED_MIME_PREFIXES.some((p) => type.startsWith(p))) {
    return { ok: false, error: 'File type not allowed', status: 415 }
  }

  const isCsv =
    name.endsWith('.csv') ||
    type === 'text/csv' ||
    type === 'application/csv' ||
    type === 'text/plain'
  const isXlsx =
    name.endsWith('.xlsx') ||
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  if (!isCsv && !isXlsx) {
    return { ok: false, error: 'Only CSV and XLSX files are allowed', status: 415 }
  }

  if (isCsv && type && !isCsvMime(type) && isExecutableMime(type)) {
    return { ok: false, error: 'MIME type does not match file extension', status: 415 }
  }

  return { ok: true }
}

function isCsvMime(type: string): boolean {
  return (
    type === 'text/csv' ||
    type === 'application/csv' ||
    type === 'text/plain' ||
    type === 'application/vnd.ms-excel'
  )
}

function isExecutableMime(type: string): boolean {
  return (
    type.includes('executable') ||
    type.includes('msdownload') ||
    type.includes('octet-stream') ||
    type.startsWith('application/x-')
  )
}

export function validateEmailAttachmentFile(
  file: File,
): { ok: true } | { ok: false; error: string; status: number } {
  const name = (file.name || '').toLowerCase()
  const type = (file.type || '').toLowerCase().trim()

  if (type === 'image/svg+xml' || name.endsWith('.svg')) {
    return { ok: false, error: 'SVG attachments are not allowed', status: 415 }
  }
  if (type && BLOCKED_MIME_EXACT.has(type)) {
    return { ok: false, error: 'File type not allowed', status: 415 }
  }
  return { ok: true }
}
