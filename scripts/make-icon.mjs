#!/usr/bin/env node
/**
 * Generate the desktop app icon (electron/build/icon.ico + icon.png) from the same vector design as the
 * favicon in index.html (dark tile, bone-white grave/house, rust roof line, glowing green zombie, moss ground).
 *
 * PURE Node, no dependencies, deterministic PIXELS (compressed bytes may differ between zlib builds): shapes are rasterized with
 * 8x8 supersampling (4x4 from 128 px up), encoded as PNG (zlib) and packed into a Vista+ ICO whose entries are PNG images
 * (16, 24, 32, 48, 64, 128, 256 px). electron-builder picks icon.ico up from `directories.buildResources`
 * (electron/build) for the .exe, the NSIS installer/uninstaller and the shortcuts.
 *
 *   node scripts/make-icon.mjs            write the files
 *   node scripts/make-icon.mjs --check    exit 1 if the committed icons' pixels differ from a fresh render
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = { bg: hex('#1d1726'), bone: hex('#e8e0c8'), rust: hex('#a5532f'), glow: hex('#9fe870'), moss: hex('#6f8f5e') };

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function inRoundRect(x, y, w, h, r) {
  const cx = Math.max(r, Math.min(w - r, x));
  const cy = Math.max(r, Math.min(h - r, y));
  return x >= 0 && y >= 0 && x <= w && y <= h && Math.hypot(x - cx, y - cy) <= r;
}

/** Colour of the design at (x, y) in its 64x64 design space, or null (transparent). Later layers win. */
function sample(x, y) {
  let c = null;
  if (inRoundRect(x, y, 64, 64, 14)) c = C.bg;
  if (inPolygon(x, y, [[13, 52], [13, 29.5], [32, 13], [51, 29.5], [51, 52]])) c = C.bone;
  if (segDist(x, y, [13, 29.5], [32, 13]) <= 1.75 || segDist(x, y, [32, 13], [51, 29.5]) <= 1.75) c = C.rust;
  if (Math.hypot(x - 32, y - 34) <= 5.2) c = C.glow;
  if (inPolygon(x, y, [[29.6, 37], [34.4, 37], [36, 45.5], [28, 45.5]])) c = C.glow;
  if (segDist(x, y, [9, 53.5], [55, 53.5]) <= 2) c = C.moss;
  return c;
}

/** RGBA pixels (straight alpha) of the icon at `size` px. */
export function renderIcon(size, ss = size >= 128 ? 4 : 8) {
  const px = new Uint8Array(size * size * 4);
  const scale = 64 / size;
  for (let py = 0; py < size; py++) {
    for (let pxx = 0; pxx < size; pxx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((pxx + (sx + 0.5) / ss) * scale, (py + (sy + 0.5) / ss) * scale);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      }
      const o = (py * size + pxx) * 4;
      if (n > 0) {
        px[o] = Math.round(r / n);
        px[o + 1] = Math.round(g / n);
        px[o + 2] = Math.round(b / n);
        px[o + 3] = Math.round((255 * n) / (ss * ss));
      }
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode RGBA pixels as a PNG (8-bit RGBA, filter 0, fixed zlib level => deterministic bytes). */
export function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Pack PNG images into an ICO (ICONDIR + ICONDIRENTRYs; PNG payloads are valid since Windows Vista). */
export function encodeIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header[e] = size >= 256 ? 0 : size; // 0 means 256
    header[e + 1] = size >= 256 ? 0 : size;
    header[e + 2] = 0; // palette
    header[e + 3] = 0;
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

/** Pixels of a PNG written by encodePng (8-bit RGBA, filter 0 on every row). Throws on anything else. */
export function decodeOwnPng(png) {
  const buf = Buffer.from(png);
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error('not a PNG');
  let off = 8;
  let size = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) throw new Error(`bad CRC in ${type}`);
    if (type === 'IHDR') {
      size = data.readUInt32BE(0);
      if (data.readUInt32BE(4) !== size || data[8] !== 8 || data[9] !== 6) throw new Error('unexpected PNG format');
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    if (raw[y * (size * 4 + 1)] !== 0) throw new Error('unexpected PNG filter');
    px.set(raw.subarray(y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1)), y * size * 4);
  }
  return { size, pixels: px };
}

/** Parse an ICO into its entries ({ size, png }). */
export function parseIco(ico) {
  const buf = Buffer.from(ico);
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an ICO');
  const n = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i;
    const len = buf.readUInt32LE(e + 8);
    const at = buf.readUInt32LE(e + 12);
    if (at + len > buf.length) throw new Error('ICO entry out of bounds');
    out.push({ size: buf[e] === 0 ? 256 : buf[e], png: buf.subarray(at, at + len) });
  }
  return out;
}

export function buildIconFiles() {
  const images = ICON_SIZES.map((size) => ({ size, png: encodePng(size, renderIcon(size)) }));
  return { ico: encodeIco(images), png: images[images.length - 1].png };
}

export function iconPaths(projectRoot = root) {
  const dir = join(projectRoot, 'electron', 'build');
  return { dir, ico: join(dir, 'icon.ico'), png: join(dir, 'icon.png') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { ico, png } = buildIconFiles();
  const p = iconPaths();
  if (process.argv.includes('--check')) {
    const pixels = (pngBytes) => Buffer.from(decodeOwnPng(pngBytes).pixels);
    let same = false;
    try {
      const want = parseIco(ico).map((e) => pixels(e.png));
      const have = parseIco(readFileSync(p.ico)).map((e) => pixels(e.png));
      same = want.length === have.length && want.every((w, i) => w.equals(have[i])) && pixels(readFileSync(p.png)).equals(pixels(png));
    } catch {
      same = false;
    }
    console.log(same ? '[icon] up to date' : '[icon] electron/build icons are missing or stale: run node scripts/make-icon.mjs');
    process.exitCode = same ? 0 : 1;
  } else {
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.ico, ico);
    writeFileSync(p.png, png);
    console.log(`[icon] wrote electron/build/icon.ico (${ico.length} bytes, ${ICON_SIZES.join('/')} px) and icon.png (256 px)`);
  }
}
