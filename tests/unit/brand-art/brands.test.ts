import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const root = join(process.cwd(), 'art', 'brands');
const names = ['mulch-master', 'grave-cola', 'volt-hearse', 'brain-bran', 'rot-pop', 'coffin-coffee', 'crypt-kicks', 'necro-tech'];

// Decode the reviewed RGBA PNGs to check content, not just file names or headers.
function pixels(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(1024);
  expect(png.readUInt32BE(20)).toBe(1024);
  expect([...png.subarray(24, 29)]).toEqual([8, 6, 0, 0, 0]);
  const parts: Buffer[] = [];
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8);
    expect(p + 12 + len).toBeLessThanOrEqual(png.length);
    if (type === 'IDAT') parts.push(png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = 1024 * 4;
  expect(raw.length).toBe((stride + 1) * 1024);
  let prev = Buffer.alloc(stride), opaque = 0, transparent = 0;
  for (let y = 0; y < 1024; y++) {
    const start = y * (stride + 1), filter = raw[start], line = Buffer.alloc(stride);
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[x] = (raw[start + 1 + x] + predictor) & 255;
    }
    for (let x = 3; x < stride; x += 4) { if (line[x] === 0) transparent++; if (line[x] === 255) opaque++; }
    prev = line;
  }
  return { opaque, transparent };
}

describe('W-008 original house-brand source art', () => {
  it.each(names)('%s has a self-contained master and a visible transparent decal', name => {
    const svg = readFileSync(join(root, `${name}.svg`), 'utf8');
    expect(svg).toMatch(/<svg\b[^>]*viewBox="0 0 1024 1024"/);
    expect(svg).toMatch(/<\/svg>\s*$/);
    expect(svg).not.toMatch(/<\s*(?:script|image|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=/i);
    const { opaque, transparent } = pixels(readFileSync(join(root, `${name}.png`)));
    expect(opaque).toBeGreaterThan(1000);
    expect(transparent).toBeGreaterThan(1000);
  });
  it('contains eight distinct raster designs', () => {
    const hashes = names.map(name => createHash('sha256').update(readFileSync(join(root, `${name}.png`))).digest('hex'));
    expect(new Set(hashes).size).toBe(names.length);
  });
  it('rejects a truncated PNG instead of treating it as usable art', () => {
    const bytes = readFileSync(join(root, 'grave-cola.png'));
    expect(() => pixels(bytes.subarray(0, 40))).toThrow();
  });
});
