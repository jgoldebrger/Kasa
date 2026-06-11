/**
 * Minimal in-memory ZIP archive builder.
 *
 * STORE method only (no deflate). PDFs are already compressed so STORE
 * has effectively the same size as DEFLATE while keeping this file
 * tiny and dependency-free. Suitable for "bundle N small PDFs into one
 * download" flows like tax receipts; not suitable for large archives
 * where streaming or compression matter.
 *
 * Compatible with the standard ZIP 2.0 spec — opens cleanly in
 * Windows Explorer, macOS Archive Utility, 7-Zip, and `unzip`.
 */

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  }
}

export interface ZipEntryInput {
  /** Filename inside the archive, e.g. "Tax_Receipt_Smith_2024.pdf". */
  name: string
  /** File contents. */
  data: Buffer
  /** Optional last-modified timestamp; defaults to now. */
  mtime?: Date
}

interface CentralEntry {
  name: Buffer
  crc: number
  size: number
  localHeaderOffset: number
  time: number
  date: number
}

/**
 * Build a ZIP archive from the provided entries. Returns the full
 * archive as a single Buffer — fine for tax-receipt bundles up to a
 * few hundred MB; if archives grow much larger, swap this for a
 * streaming implementation.
 */
export function buildZip(entries: ZipEntryInput[]): Buffer {
  const parts: Buffer[] = []
  const central: CentralEntry[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.length
    const { time, date } = dosDateTime(entry.mtime || new Date())

    // Local file header (30 bytes + name).
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(20, 4)         // version needed
    local.writeUInt16LE(0x0800, 6)     // flags — bit 11 = UTF-8 names
    local.writeUInt16LE(0, 8)          // method: STORE
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)      // compressed
    local.writeUInt32LE(size, 22)      // uncompressed
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)         // extra length

    central.push({ name: nameBuf, crc, size, localHeaderOffset: offset, time, date })
    parts.push(local, nameBuf, entry.data)
    offset += local.length + nameBuf.length + entry.data.length
  }

  // Central directory.
  const cdStart = offset
  for (const c of central) {
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)    // signature
    cd.writeUInt16LE(20, 4)            // version made by
    cd.writeUInt16LE(20, 6)            // version needed
    cd.writeUInt16LE(0x0800, 8)        // flags
    cd.writeUInt16LE(0, 10)            // method
    cd.writeUInt16LE(c.time, 12)
    cd.writeUInt16LE(c.date, 14)
    cd.writeUInt32LE(c.crc, 16)
    cd.writeUInt32LE(c.size, 20)
    cd.writeUInt32LE(c.size, 24)
    cd.writeUInt16LE(c.name.length, 28)
    cd.writeUInt16LE(0, 30)            // extra length
    cd.writeUInt16LE(0, 32)            // comment length
    cd.writeUInt16LE(0, 34)            // disk number
    cd.writeUInt16LE(0, 36)            // internal attrs
    cd.writeUInt32LE(0, 38)            // external attrs
    cd.writeUInt32LE(c.localHeaderOffset, 42)
    parts.push(cd, c.name)
    offset += cd.length + c.name.length
  }
  const cdSize = offset - cdStart

  // End of central directory.
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)             // disk number
  eocd.writeUInt16LE(0, 6)             // disk with central dir
  eocd.writeUInt16LE(central.length, 8)
  eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)            // comment length
  parts.push(eocd)

  return Buffer.concat(parts)
}

/**
 * Streaming ZIP builder.
 *
 * Yields `Buffer` chunks as soon as each entry's local file header +
 * payload are produced, so the consumer (e.g. a Node `Readable` /
 * `ReadableStream` for an HTTP response) can flush them to the wire
 * without holding the whole archive in memory. Necessary for tax-
 * receipt bundles in orgs with hundreds of families — `buildZip`'s
 * Buffer.concat would peak at ~2× the total archive size.
 *
 * Usage:
 *   for await (const chunk of streamZip(provider)) writable.write(chunk)
 *
 * The `provider` argument is an async iterator over entries so the
 * caller can lazily generate each PDF only when its turn comes — pull-
 * based, so memory stays bounded by the largest single entry.
 */
export async function* streamZip(
  provider: AsyncIterable<ZipEntryInput>,
): AsyncGenerator<Buffer, void, void> {
  const central: CentralEntry[] = []
  let offset = 0

  for await (const entry of provider) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.length
    const { time, date } = dosDateTime(entry.mtime || new Date())

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    central.push({ name: nameBuf, crc, size, localHeaderOffset: offset, time, date })
    yield local
    yield nameBuf
    yield entry.data
    offset += local.length + nameBuf.length + entry.data.length
  }

  const cdStart = offset
  for (const c of central) {
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(c.time, 12)
    cd.writeUInt16LE(c.date, 14)
    cd.writeUInt32LE(c.crc, 16)
    cd.writeUInt32LE(c.size, 20)
    cd.writeUInt32LE(c.size, 24)
    cd.writeUInt16LE(c.name.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(c.localHeaderOffset, 42)
    yield cd
    yield c.name
    offset += cd.length + c.name.length
  }
  const cdSize = offset - cdStart

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(central.length, 8)
  eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)
  yield eocd
}
