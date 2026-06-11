/** Malicious upload fixtures for import / email attachment endpoints. */
export const UPLOAD_FIXTURES = {
  oversizeLabel: 'oversize-11mb.bin',
  doubleExtension: 'report.pdf.exe',
  pathTraversalName: '../../etc/passwd.csv',
  nullByteName: 'safe.csv\x00.exe',
  mimeMismatch: {
    /** CSV content with executable MIME */
    csvAsExe: { content: 'name,weddingDate\nTest,2020-01-01', mime: 'application/x-msdownload' },
    /** SVG with script */
    svgXss: {
      content: '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      mime: 'image/svg+xml',
    },
    /** Polyglot ZIP bomb marker (small, not real bomb) */
    zipHeader: { content: 'PK\x03\x04', mime: 'application/zip' },
  },
  allowedCsv: {
    content: 'name,weddingDate,email\nSecurity Test,2020-06-01,sec@test.invalid',
    mime: 'text/csv',
  },
} as const

export const UPLOAD_SIZE_LIMITS = {
  importBytes: 10 * 1024 * 1024,
  emailAttachmentBytes: 10 * 1024 * 1024,
  brandingLogoBytes: 200 * 1024,
} as const
