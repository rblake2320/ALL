/**
 * Optional gzip via the standard CompressionStream/DecompressionStream (Chromium/Electron, Firefox
 * 113+, Safari 16.4+, Node 18+). Reads detect gzip by magic bytes, so plain-JSON saves keep working
 * and a platform without the streams can still read uncompressed files.
 *
 * Decompression is bounded (zip-bomb guard) and every stream error — truncated input, CRC mismatch,
 * garbage — surfaces as a GzipError instead of an unhandled rejection.
 */
import { concatBytes, plainBytes } from './bytes';

export class GzipError extends Error {
  readonly code: 'unsupported' | 'corrupt' | 'too_large';
  constructor(code: GzipError['code'], message: string) {
    super(message);
    this.name = 'GzipError';
    this.code = code;
  }
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function compressionAvailable(): boolean {
  try {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  } catch {
    return false;
  }
}

const noop = (): void => {};

async function pump(
  transform: { writable: WritableStream<Uint8Array<ArrayBuffer>>; readable: ReadableStream<Uint8Array> },
  input: Uint8Array,
  maxOut: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter();
  // Errors are observed through the readable side; swallow them here to avoid unhandled rejections.
  writer.closed.catch(noop);
  writer
    .write(plainBytes(input))
    .then(() => writer.close())
    .catch(noop);
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxOut) {
      reader.cancel().catch(noop);
      writer.abort().catch(noop);
      throw new GzipError('too_large', `decompressed data exceeds ${maxOut} bytes`);
    }
    chunks.push(value);
  }
  return concatBytes(chunks, total);
}

export async function gzipBytes(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (!compressionAvailable()) throw new GzipError('unsupported', 'CompressionStream is not available');
  try {
    return await pump(new CompressionStream('gzip'), input, Number.MAX_SAFE_INTEGER);
  } catch (e) {
    if (e instanceof GzipError) throw e;
    throw new GzipError('corrupt', `gzip failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function gunzipBytes(input: Uint8Array, maxOut: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!compressionAvailable()) {
    throw new GzipError('unsupported', 'this save is compressed but DecompressionStream is not available on this platform');
  }
  try {
    return await pump(new DecompressionStream('gzip'), input, maxOut);
  } catch (e) {
    if (e instanceof GzipError) throw e;
    throw new GzipError('corrupt', `compressed data is damaged: ${e instanceof Error ? e.message : String(e)}`);
  }
}
