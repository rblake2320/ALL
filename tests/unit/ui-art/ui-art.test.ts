import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';

type Asset = { id: string; file: string; width?: number; height?: number; sha256?: string };
const root = resolve('art/ui');
const load = (name: string) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const icons: Asset[] = load('icons.json').icons;
const surfaces = load('surfaces.json');
const social: Asset[] = load('social.json').assets;
const loading: Asset[] = load('loading.json').images;
const allSvg: Asset[] = [...icons, ...surfaces.ads, ...surfaces.news, ...social];

function assetPath(file: string) {
  const target = resolve(root, file), rel = relative(resolve('art'), target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Asset path escapes art directory');
  return target;
}
function pngValid(data: Buffer, asset: Asset) {
  return data.length >= 33 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    data.readUInt32BE(16) === asset.width && data.readUInt32BE(20) === asset.height &&
    createHash('sha256').update(data).digest('hex') === asset.sha256;
}

describe('W-052 source artwork', () => {
  it('catalogs the complete requested inventory without duplicate identities', () => {
    expect([icons.length, surfaces.ads.length, surfaces.news.length, social.length, loading.length]).toEqual([18,4,2,6,7]);
    const ids = [...allSvg, ...loading].map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(social.filter(a => a.id.startsWith('feed-')).every(a => a.width === 360 && a.height === 200)).toBe(true);
    expect(social.filter(a => a.id.startsWith('badge-')).every(a => a.width === 96 && a.height === 96)).toBe(true);
  });
  it.each(allSvg)('$id has a labeled, self-contained SVG source', asset => {
    const svg = readFileSync(assetPath(asset.file), 'utf8');
    expect(svg).toMatch(/<svg\b/);
    expect(svg).toMatch(/viewBox="[^"]+"/);
    expect(svg).toMatch(/aria-label="[^"]+"/);
    expect(svg).toMatch(/<\/svg>\s*$/);
    expect(svg).not.toMatch(/<\s*(?:script|image|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=/i);
    if (asset.width) {
      expect(svg).toContain(`width="${asset.width}"`);
      expect(svg).toContain(`height="${asset.height}"`);
    }
  });
  it.each(loading)('$id matches its actual image dimensions and recorded hash', asset => {
    expect(asset.width).toBeGreaterThanOrEqual(1600);
    expect(asset.height).toBeGreaterThanOrEqual(900);
    expect(pngValid(readFileSync(assetPath(asset.file)), asset)).toBe(true);
  });
  it('rejects altered raster bytes and traversal paths', () => {
    const original = readFileSync(assetPath(loading[0].file)), altered = Buffer.from(original);
    altered[altered.length - 1] ^= 1;
    expect(pngValid(altered, loading[0])).toBe(false);
    expect(() => assetPath('../../outside.svg')).toThrow();
  });
});
