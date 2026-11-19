/**
 * Screenshot checks without decoding pixels: identify JPEG / WebP by magic bytes and read the frame size from the
 * header (JPEG SOFn marker; WebP VP8 / VP8L / VP8X chunk). Anything else (PNG, SVG, HTML, truncated data) → null,
 * so a report can never smuggle a scriptable or oversized image past the validator.
 */

export interface ImageInfo {
  mime: 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

function jpegInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  // Walk marker segments until a start-of-frame (SOF0..SOF15 except DHT C4, JPG C8, DAC CC).
  for (let guard = 0; guard < 512 && i + 3 < b.length; guard++) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) {
      i++;
      m = b[i + 1];
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // end of image / start of scan before any frame header
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 8 >= b.length) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { mime: 'image/jpeg', width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

function webpInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 30) return null;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const chunk = tag(12);
  if (chunk === 'VP8 ') {
    // frame tag (3 bytes) + start code 9d 01 2a + 14-bit width/height
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = (b[26] | (b[27] << 8)) & 0x3fff;
    const height = (b[28] | (b[29] << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { mime: 'image/webp', width, height } : null;
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { mime: 'image/webp', width, height };
  }
  return null;
}

export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  try {
    return jpegInfo(bytes) ?? webpInfo(bytes);
  } catch {
    return null;
  }
}

/** Split a `data:image/(jpeg|webp);base64,…` URL (null for anything else — SVG, PNG, remote URLs, junk). */
export function splitImageDataUrl(url: unknown): { mime: 'image/jpeg' | 'image/webp'; data: string } | null {
  if (typeof url !== 'string') return null;
  const m = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  return m ? { mime: m[1] as 'image/jpeg' | 'image/webp', data: m[2] } : null;
}
