import { describe, expect, it } from 'vitest'
import { buildZip, streamZip, type ZipEntryInput } from './zip'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset)
}

function eocdEntryCount(zip: Buffer): number {
  expect(readUInt32LE(zip, zip.length - 22)).toBe(EOCD_SIG)
  return zip.readUInt16LE(zip.length - 12)
}

/** STORE-only extractor — validates archives using Node Buffer APIs only. */
function extractStoreZip(zip: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0

  while (offset + 4 <= zip.length) {
    const sig = zip.readUInt32LE(offset)
    if (sig === EOCD_SIG || sig === CENTRAL_SIG) break
    if (sig !== LOCAL_SIG) {
      throw new Error(`Unexpected signature 0x${sig.toString(16)} at offset ${offset}`)
    }

    const compSize = zip.readUInt32LE(offset + 18)
    const nameLen = zip.readUInt16LE(offset + 26)
    const extraLen = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = zip.slice(nameStart, nameStart + nameLen).toString('utf8')
    const dataStart = nameStart + nameLen + extraLen
    files.set(name, zip.slice(dataStart, dataStart + compSize))
    offset = dataStart + compSize
  }

  return files
}

describe('buildZip', () => {
  it('builds a valid empty ZIP archive', () => {
    const zip = buildZip([])
    expect(zip.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false)
    expect(eocdEntryCount(zip)).toBe(0)
    expect(extractStoreZip(zip).size).toBe(0)
  })

  it('embeds file entries with STORE method and round-trips via extract', () => {
    const data = Buffer.from('hello zip')
    const zip = buildZip([{ name: 'hello.txt', data }])
    expect(readUInt32LE(zip, 0)).toBe(LOCAL_SIG)
    const nameOffset = 30
    expect(zip.slice(nameOffset, nameOffset + 9).toString('utf8')).toBe('hello.txt')
    expect(readUInt32LE(zip, zip.length - 22)).toBe(EOCD_SIG)

    const extracted = extractStoreZip(zip)
    expect(extracted.size).toBe(1)
    expect(extracted.get('hello.txt')?.toString('utf8')).toBe('hello zip')
  })

  it('supports multiple entries', () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('a') },
      { name: 'b.txt', data: Buffer.from('bb') },
      { name: 'nested/dir.txt', data: Buffer.from('nested') },
    ])
    const extracted = extractStoreZip(zip)
    expect(extracted.get('a.txt')?.toString()).toBe('a')
    expect(extracted.get('b.txt')?.toString()).toBe('bb')
    expect(extracted.get('nested/dir.txt')?.toString()).toBe('nested')
    expect(eocdEntryCount(zip)).toBe(3)
  })

  it('clamps DOS date year before 1980 to 1980 in the header', () => {
    const mtime = new Date('1970-06-15T12:30:45Z')
    const zip = buildZip([
      {
        name: 'old.txt',
        data: Buffer.from('x'),
        mtime,
      },
    ])
    expect(readUInt32LE(zip, 0)).toBe(LOCAL_SIG)
    const dosDate = zip.readUInt16LE(12)
    const dosTime = zip.readUInt16LE(10)
    const yearBits = (dosDate >> 9) & 0x7f
    expect(yearBits).toBe(0)
    expect(((dosDate >> 5) & 0x0f)).toBe(6)
    expect(dosDate & 0x1f).toBe(15)
    expect(dosTime).toBeGreaterThan(0)
  })

  it('encodes post-1980 DOS date from mtime', () => {
    const mtime = new Date('2024-03-15T14:22:30Z')
    const zip = buildZip([{ name: 'recent.txt', data: Buffer.from('ok'), mtime }])
    const dosDate = zip.readUInt16LE(12)
    const yearBits = (dosDate >> 9) & 0x7f
    expect(yearBits).toBe(2024 - 1980)
    expect(((dosDate >> 5) & 0x0f)).toBe(3)
    expect(dosDate & 0x1f).toBe(15)
  })
})

describe('streamZip', () => {
  async function collect(provider: AsyncIterable<ZipEntryInput>): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of streamZip(provider)) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  it('streams the same structure as buildZip', async () => {
    const entries: ZipEntryInput[] = [{ name: 'stream.txt', data: Buffer.from('streamed') }]
    const zip = await collect(
      (async function* () {
        for (const e of entries) yield e
      })(),
    )
    expect(readUInt32LE(zip, 0)).toBe(LOCAL_SIG)
    expect(extractStoreZip(zip).get('stream.txt')?.toString()).toBe('streamed')
    expect(readUInt32LE(zip, zip.length - 22)).toBe(EOCD_SIG)
  })

  it('yields central directory after all local headers', async () => {
    const zip = await collect(
      (async function* () {
        yield { name: 'only.pdf', data: Buffer.from('%PDF-1.4') }
      })(),
    )
    const centralIdx = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    const localIdx = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(localIdx).toBe(0)
    expect(centralIdx).toBeGreaterThan(localIdx)
  })

  it('produces an empty archive when the provider yields no entries', async () => {
    const zip = await collect(
      (async function* () {
        // no yields
      })(),
    )
    expect(readUInt32LE(zip, zip.length - 22)).toBe(EOCD_SIG)
    expect(eocdEntryCount(zip)).toBe(0)
    expect(extractStoreZip(zip).size).toBe(0)
  })

  it('streams multiple files extractable like buildZip', async () => {
    const zip = await collect(
      (async function* () {
        yield { name: 'one.bin', data: Buffer.from([1, 2, 3]) }
        yield { name: 'two.bin', data: Buffer.from('two') }
      })(),
    )
    const extracted = extractStoreZip(zip)
    expect(Buffer.from(extracted.get('one.bin')!).equals(Buffer.from([1, 2, 3]))).toBe(true)
    expect(extracted.get('two.bin')?.toString()).toBe('two')
    expect(eocdEntryCount(zip)).toBe(2)
  })
})
