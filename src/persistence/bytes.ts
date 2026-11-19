/** Byte/string helpers that behave identically in browsers, Electron renderers and Node 22. */

const encoder = new TextEncoder();

/** UTF-8 encode. Returns a Uint8Array backed by a plain ArrayBuffer (safe for WebCrypto/streams). */
export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

/**
 * Strict UTF-8 decode: invalid byte sequences THROW (a torn or bit-flipped file must never decode
 * to "almost right" text). A leading UTF-8 BOM (e.g. after editing an export in Windows Notepad)
 * is stripped.
 */
export function utf8DecodeStrict(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  return decoder.decode(bytes);
}

/** Return a view whose buffer is a plain ArrayBuffer (copies only when necessary). */
export function plainBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (Object.prototype.toString.call(bytes.buffer) === '[object ArrayBuffer]') return bytes as Uint8Array<ArrayBuffer>;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/** Defensive copy (storage backends must never alias caller-owned buffers). */
export function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function concatBytes(chunks: readonly Uint8Array[], total?: number): Uint8Array<ArrayBuffer> {
  const size = total ?? chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Coerce an unknown storage value (Uint8Array, ArrayBuffer, typed array view) to bytes, or null. */
export function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  // Cross-realm buffers (e.g. from an iframe or structured clone in another context).
  const tag = Object.prototype.toString.call(v);
  if (tag === '[object Uint8Array]') {
    const view = v as Uint8Array;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (tag === '[object ArrayBuffer]') return new Uint8Array(v as ArrayBuffer);
  return null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Standard base64 (RFC 4648, padded). Pure JS so it does not depend on btoa's Latin-1 quirks. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 0x3000; // multiple of 3 so chunks concatenate cleanly
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    let s = '';
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    const rem = end - i;
    if (rem === 1) {
      const n = bytes[i] << 16;
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
    }
    parts.push(s);
  }
  return parts.join('');
}

/** Strict base64 decode; returns null for any malformed input (wrong length, bad chars, bad padding). */
export function base64ToBytes(text: string): Uint8Array | null {
  const len = text.length;
  if (len % 4 !== 0) return null;
  if (len === 0) return new Uint8Array(0);
  let pad = 0;
  if (text.charCodeAt(len - 1) === 61) pad++;
  if (text.charCodeAt(len - 2) === 61) pad++;
  const outLen = (len / 4) * 3 - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const isLast = i + 4 === len;
    const c0 = text.charCodeAt(i);
    const c1 = text.charCodeAt(i + 1);
    const c2 = text.charCodeAt(i + 2);
    const c3 = text.charCodeAt(i + 3);
    const v0 = c0 < 128 ? B64_LOOKUP[c0] : -1;
    const v1 = c1 < 128 ? B64_LOOKUP[c1] : -1;
    const v2 = c2 === 61 && isLast && pad >= 2 ? 0 : c2 < 128 ? B64_LOOKUP[c2] : -1;
    const v3 = c3 === 61 && isLast && pad >= 1 ? 0 : c3 < 128 ? B64_LOOKUP[c3] : -1;
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return null;
    const n = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    out[o++] = (n >> 16) & 255;
    if (o < outLen) out[o++] = (n >> 8) & 255;
    if (o < outLen) out[o++] = n & 255;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}
