/**
 * Minimal, defensive ZIP reader for content packs (stored + deflate entries only). Rejects — before inflating
 * anything — encrypted entries, ZIP64, multi-disk archives, duplicate or unsafe paths, more than PACK_LIMITS.maxFiles
 * entries, declared sizes over the limits and compression ratios above PACK_LIMITS.maxCompressionRatio; inflation is
 * streamed with a hard byte cap so a lying header can never expand past the limit (zip-bomb guard); CRC-32 checked.
 * Uses the platform DecompressionStream('deflate-raw') (browsers, Electron, Node ≥ 18).
 */
import { PACK_LIMITS, checkPackPath } from './limits';

export class PackFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackFormatError';
  }
}

let CRC_TABLE: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new PackFormatError('this platform cannot read compressed packs');
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new PackFormatError('a zip entry inflates beyond its declared size (zip bomb?)');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** Parse a zip archive into path → bytes. Throws PackFormatError with a clear message on anything unsafe. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength;
  if (n < 22) throw new PackFormatError('not a zip archive');
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new PackFormatError('not a zip archive (no end-of-directory record)');
  const disk = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0) throw new PackFormatError('multi-disk zips are not supported');
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new PackFormatError('ZIP64 archives are not supported');
  if (count > PACK_LIMITS.maxFiles) throw new PackFormatError(`too many files in pack (${count} > ${PACK_LIMITS.maxFiles})`);
  if (cdOff + cdSize > eocd) throw new PackFormatError('corrupt zip directory');

  const out = new Map<string, Uint8Array>();
  let declaredTotal = 0;
  let p = cdOff;
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) throw new PackFormatError('corrupt zip directory entry');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    let name: string;
    try {
      name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    } catch {
      throw new PackFormatError('zip entry name is not valid UTF-8');
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new PackFormatError(`encrypted zip entry "${name}"`);
    if (name.endsWith('/')) {
      if (usize !== 0) throw new PackFormatError(`directory entry with data "${name}"`);
      const chk = checkPackPath(name.slice(0, -1));
      if (!chk.ok) throw new PackFormatError(chk.reason);
      continue;
    }
    const chk = checkPackPath(name);
    if (!chk.ok) throw new PackFormatError(chk.reason);
    if (out.has(name)) throw new PackFormatError(`duplicate zip entry "${name}"`);
    if (method !== 0 && method !== 8) throw new PackFormatError(`unsupported compression in "${name}"`);
    if (usize > PACK_LIMITS.maxFileBytes) throw new PackFormatError(`"${name}" is too large`);
    declaredTotal += usize;
    if (declaredTotal > PACK_LIMITS.maxTotalBytes) throw new PackFormatError('pack is too large once unpacked');
    if (method === 8 && usize > 1024 && usize / Math.max(1, csize) > PACK_LIMITS.maxCompressionRatio) throw new PackFormatError(`"${name}" has a suspicious compression ratio (zip bomb?)`);
    if (method === 0 && csize !== usize) throw new PackFormatError(`corrupt stored entry "${name}"`);
    if (localOff + 30 > cdOff || dv.getUint32(localOff, true) !== 0x04034b50) throw new PackFormatError(`corrupt local header for "${name}"`);
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    if (start + csize > cdOff) throw new PackFormatError(`entry "${name}" overruns the archive`);
    const raw = bytes.subarray(start, start + csize);
    const data = method === 0 ? raw.slice() : await inflateRaw(raw, usize);
    if (data.byteLength !== usize) throw new PackFormatError(`"${name}" does not match its declared size`);
    if (crc32(data) !== crc) throw new PackFormatError(`"${name}" failed its CRC check`);
    out.set(name, data);
  }
  return out;
}
