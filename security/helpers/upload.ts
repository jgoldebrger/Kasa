import type { APIRequestContext } from '@playwright/test'
import { UPLOAD_FIXTURES, UPLOAD_SIZE_LIMITS } from '../payloads/upload'
import { mutateRequest } from './request-mutation'

export interface UploadTestResult {
  test: string
  status: number
  passed: boolean
  detail: string
}

function bufferOfSize(bytes: number): Buffer {
  return Buffer.alloc(bytes, 'A')
}

export async function testImportOversizeFile(
  request: APIRequestContext,
): Promise<UploadTestResult> {
  const oversize = bufferOfSize(UPLOAD_SIZE_LIMITS.importBytes + 1024)
  const res = await mutateRequest(request, {
    method: 'POST',
    path: '/api/import',
    multipart: {
      type: 'families',
      file: {
        name: UPLOAD_FIXTURES.oversizeLabel,
        mimeType: 'text/csv',
        buffer: oversize,
      },
    },
  })
  const status = res.status()
  const passed = status === 413 || status === 400 || status === 403 || status === 401
  return {
    test: 'import oversize file',
    status,
    passed,
    detail: passed
      ? `Oversize rejected (${status})`
      : `Oversize file accepted (${status})`,
  }
}

export async function testImportMimeMismatch(
  request: APIRequestContext,
): Promise<UploadTestResult> {
  const { content, mime } = UPLOAD_FIXTURES.mimeMismatch.csvAsExe
  const res = await mutateRequest(request, {
    method: 'POST',
    path: '/api/import',
    multipart: {
      type: 'families',
      file: { name: 'data.csv', mimeType: mime, buffer: Buffer.from(content) },
    },
  })
  const status = res.status()
  const passed = status === 400 || status === 415 || status === 403 || status === 401
  return {
    test: 'import mime mismatch',
    status,
    passed,
    detail: `MIME mismatch → ${status}`,
  }
}

export async function testImportPathTraversalFilename(
  request: APIRequestContext,
): Promise<UploadTestResult> {
  const { content, mime } = UPLOAD_FIXTURES.allowedCsv
  const res = await mutateRequest(request, {
    method: 'POST',
    path: '/api/import',
    multipart: {
      type: 'families',
      file: {
        name: UPLOAD_FIXTURES.pathTraversalName,
        mimeType: mime,
        buffer: Buffer.from(content),
      },
    },
  })
  const status = res.status()
  const body = await res.text()
  const passed =
    status !== 500 && !body.includes('/etc/passwd') && (status === 400 || status < 300)
  return {
    test: 'import path traversal filename',
    status,
    passed,
    detail: passed ? 'Path traversal filename handled safely' : 'Possible path traversal issue',
  }
}

export async function testSendFileEmailDisallowedMime(
  request: APIRequestContext,
): Promise<UploadTestResult> {
  const { content, mime } = UPLOAD_FIXTURES.mimeMismatch.svgXss
  const res = await mutateRequest(request, {
    method: 'POST',
    path: '/api/send-file-email',
    multipart: {
      to: 'sec@test.invalid',
      subject: 'sec test',
      message: 'test',
      file: { name: 'x.svg', mimeType: mime, buffer: Buffer.from(content) },
    },
  })
  const status = res.status()
  const passed = status === 400 || status === 415 || status === 403 || status === 401
  return {
    test: 'send-file-email disallowed mime',
    status,
    passed,
    detail: `SVG upload → ${status}`,
  }
}

export async function runUploadAbuseSuite(
  request: APIRequestContext,
): Promise<UploadTestResult[]> {
  return Promise.all([
    testImportOversizeFile(request),
    testImportMimeMismatch(request),
    testImportPathTraversalFilename(request),
    testSendFileEmailDisallowedMime(request),
  ])
}
