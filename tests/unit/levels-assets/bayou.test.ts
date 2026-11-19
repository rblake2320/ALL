/**
 * L4 Swampside Bayou art kit (the §7 objects, the §5.6 curios and the §12 environment models) (tools/blender/levels/build_l4.py -> public/assets/models/levels/bayou +
 * manifest.bayou.json).
 *
 * Independent checks (TypeScript GLB reader, no Python geometry code):
 *   - every model is a row of docs/levels/L4-bayou.md §7, with the doc's footprint and triangle budget, or one
 *     of the eight §5.6 curios (README §8: each within 400 triangles)
 *   - every GLB parses; bytes / sha256 / triangles / bounds in the manifest match the file
 *   - floor objects stand on the floor inside their footprint; the wall item hangs flush on the wall
 *   - dynamic and state nodes exist; glowing parts are emissive at strength 2..6; no textures
 *   - the generated floor outline (D-043) is convex parts, counter-clockwise, inside the bounding box
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundsOf, emissiveStrengths, readGlb, type Glb } from '../models/glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DIR = join(ASSETS, 'models', 'levels', 'bayou');
const DOC = readFileSync(join(ROOT, 'docs', 'levels', 'L4-bayou.md'), 'utf8');

interface Entry {
  id: string; level: string; kind: string; file: string; bytes: number; sha256: string; triangles: number;
  bounds: { min: [number, number, number]; max: [number, number, number] }; tileFootprint: [number, number];
  budget: number; wallCentre: number | null; parts: string[]; states: string[]; outline: [number, number][][];
}

const MANIFEST = JSON.parse(readFileSync(join(ASSETS, 'manifest.bayou.json'), 'utf8')) as { level: string; models: Entry[] };
const MODELS = MANIFEST.models;
const GLBS = new Map<string, Glb>(MODELS.map((e) => [e.id, readGlb(join(ASSETS, e.file))]));
const hidden = (e: Entry) => ['broken', ...e.states];

/** §7 rows: id -> { footprint cell, triangle budget (last column) }. */
const DOC_ROWS = new Map<string, { size: string; tris: number }>();
{
  const a = DOC.indexOf('## 7. New objects (L4)');
  const b = DOC.indexOf('## 8.', a);
  for (const line of DOC.slice(a, b).split('\n').filter((l) => l.startsWith('| `'))) {
    const c = line.split('|').slice(1, -1).map((s) => s.trim());
    const id = /`([A-Za-z0-9_]+)`/.exec(c[0])?.[1] ?? '';
    DOC_ROWS.set(id, { size: c[3], tris: Number(c[c.length - 1].replace(/[,\s]/g, '')) });
  }
}

/** §5.6 curio ids. */
const DOC_CURIOS: string[] = (() => {
  const a = DOC.indexOf('### 5.6 Bayou Finds');
  const b = DOC.indexOf('\n## ', a);
  return DOC.slice(a, b).split('\n').filter((l) => l.startsWith('| `curio_')).map((l) => /`([A-Za-z0-9_]+)`/.exec(l)![1]!);
})();
const isCurio = (e: { id: string }): boolean => e.id.startsWith('curio_');
/** §12 "New env models" sentence: id -> triangle budget (`env_stiltHouse_a/b` is two models). */
const DOC_ENV = new Map<string, number>();
{
  const a = DOC.indexOf('**New env models:**');
  const text = DOC.slice(a, DOC.indexOf('\n\n', a));
  for (const m of text.matchAll(/`(env_[A-Za-z0-9_]+?)(_a\/b)?`[^`]*?([\d,]+)(?: tris| each|\))/g)) {
    const tris = Number(m[3]!.replace(/,/g, ''));
    if (m[2]) for (const v of ['_a', '_b']) DOC_ENV.set(m[1]! + v, tris);
    else DOC_ENV.set(m[1]!, tris);
  }
}
const isEnv = (e: { id: string }): boolean => e.id.startsWith('env_');

const GLOWING = ['glow', 'flame'];
const EXPECTED_PARTS: Record<string, string[]> = {
  swing_porch: ['swing'], stove_woodburning: ['flame'], pot_crawdad: ['full'], pot_boil: ['water', 'flame'],
  bush_bogberry: ['count_1', 'count_2', 'count_3'], log_mushroom: ['glow'], lantern_firefly: ['glow'],
  tank_bait: ['water'], jukebox_swamp: ['glow'],
  env_hearseBoat: ['glow'], env_stiltHouse_a: ['glow'], env_stiltHouse_b: ['glow'],
};

describe('L4 Bayou art kit', () => {
  it('has the 24 new §7 objects, the 8 curios and the 4 environment models, and nothing else on disk', () => {
    expect(MANIFEST.level).toBe('bayou');
    expect(MODELS).toHaveLength(36);
    expect([...DOC_ENV.entries()].sort()).toEqual(
      [['env_cypressGroup', 6000], ['env_hearseBoat', 4000], ['env_stiltHouse_a', 4500], ['env_stiltHouse_b', 4500]]);
    expect(MODELS.filter(isEnv).map((e) => e.id).sort()).toEqual([...DOC_ENV.keys()].sort());
    expect(DOC_CURIOS).toHaveLength(8);
    expect(MODELS.filter(isCurio).map((e) => e.id).sort()).toEqual([...DOC_CURIOS].sort());
    // every row of the §7 table is built (`floor_boardwalk` is a floor style outside the table, not a mesh)
    expect([...DOC_ROWS.keys()].filter((id) => !MODELS.some((e) => e.id === id))).toEqual([]);
    expect(readdirSync(DIR).sort()).toEqual(MODELS.map((e) => `${e.id}.glb`).sort());
  });

  it.each(MODELS.map((e) => [e.id, e] as const))('%s matches the design doc row', (_id, e) => {
    if (isCurio(e)) {
      expect(DOC_CURIOS).toContain(e.id);
      expect(e.budget).toBe(400);
      expect(e.kind).toBe('item');
      const b = boundsOf(GLBS.get(e.id)!);
      expect(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2])).toBeLessThan(0.25);   // pocket-sized
      expect(b.min[1]).toBeGreaterThanOrEqual(-0.002);
      expect(b.min[1]).toBeLessThanOrEqual(0.002);                                      // resting on the floor
      return;
    }
    if (isEnv(e)) {
      expect(e.budget).toBe(DOC_ENV.get(e.id));
      expect(e.kind).toBe('env');
      const b = boundsOf(GLBS.get(e.id)!);
      expect(b.min[1]).toBeGreaterThanOrEqual(-0.02);                                  // nothing below the ground
      expect(b.max[1]).toBeGreaterThan(2);                                             // building- or tree-sized
      return;
    }
    const row = DOC_ROWS.get(e.id);
    expect(row, `${e.id} is not a §7 object`).toBeDefined();
    expect(e.budget).toBe(row!.tris);
    const m = /(\d+)×(\d+)/.exec(row!.size);
    if (m) expect(e.tileFootprint).toEqual([Number(m[1]), Number(m[2])]);
    else expect(['wall', 'item']).toContain(e.kind);
  });

  it.each(MODELS.map((e) => [e.id, e] as const))('%s file matches its manifest entry', (_id, e) => {
    const path = join(ASSETS, e.file);
    const g = GLBS.get(e.id)!;
    expect(statSync(path).size).toBe(e.bytes);
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(e.sha256);
    expect(g.tris).toBe(e.triangles);
    expect(g.tris).toBeLessThanOrEqual(e.budget);
    expect(g.tris).toBeGreaterThan(0);
    const b = boundsOf(g, hidden(e));
    for (let i = 0; i < 3; i++) {
      expect(b.min[i]).toBeCloseTo(e.bounds.min[i], 3);
      expect(b.max[i]).toBeCloseTo(e.bounds.max[i], 3);
    }
    const js = g.json as unknown as Record<string, unknown>;
    expect(js.images ?? []).toEqual([]);
    expect(js.textures ?? []).toEqual([]);
  });

  it.each(MODELS.filter((e) => e.kind === 'floor').map((e) => [e.id, e] as const))(
    '%s stands on the floor inside its footprint', (_id, e) => {
      const b = boundsOf(GLBS.get(e.id)!, hidden(e));
      expect(b.min[1]).toBeGreaterThanOrEqual(-0.005);
      expect(b.min[1]).toBeLessThanOrEqual(0.02);
      expect(Math.max(-b.min[0], b.max[0])).toBeLessThanOrEqual(e.tileFootprint[0] / 2 + 0.15);
      expect(Math.max(-b.min[2], b.max[2])).toBeLessThanOrEqual(e.tileFootprint[1] / 2 + 0.15);
    });

  it('the cypress rod hangs flush on the wall at its wall height', () => {
    const e = MODELS.find((x) => x.id === 'rod_cypress')!;
    const b = boundsOf(GLBS.get(e.id)!);
    expect(e.kind).toBe('wall');
    expect(b.min[2]).toBeGreaterThanOrEqual(-0.01);            // nothing behind the wall plane
    expect(b.min[2]).toBeLessThanOrEqual(0.03);                // and it touches it
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(e.wallCentre!, 1);
  });

  it('has the dynamic and state nodes the game drives', () => {
    for (const e of MODELS) {
      expect([...e.parts].sort(), e.id).toEqual([...(EXPECTED_PARTS[e.id] ?? [])].sort());
      for (const p of e.parts) expect(GLBS.get(e.id)!.byName.has(p), `${e.id}.${p}`).toBe(true);
    }
  });

  it('glowing parts are emissive at strength 2..6', () => {
    for (const e of MODELS) {
      for (const p of e.parts.filter((n) => GLOWING.includes(n))) {
        const st = emissiveStrengths(GLBS.get(e.id)!, p);
        expect(st.length, `${e.id}.${p}`).toBeGreaterThan(0);
        expect(Math.max(...st), `${e.id}.${p}`).toBeGreaterThanOrEqual(2);
        expect(Math.max(...st), `${e.id}.${p}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('floor outlines are convex parts, counter-clockwise and inside the bounds', () => {
    for (const e of MODELS) {
      expect(Object.keys(e), e.id).not.toContain('footprint');
      // the viewing platform is a deck with steps on one side: an L, so two parts; everything else is one hull
      expect(e.outline, e.id).toHaveLength(e.id === 'platform_viewing' ? 2 : 1);
      for (const h of e.outline) {
        expect(h.length, e.id).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < h.length; i++) {
          const [a, b, c] = [h[i]!, h[(i + 1) % h.length]!, h[(i + 2) % h.length]!];
          expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), `${e.id} corner ${i}`).toBeGreaterThan(0);
          expect(a[0]).toBeGreaterThanOrEqual(e.bounds.min[0] - 0.001);
          expect(a[0]).toBeLessThanOrEqual(e.bounds.max[0] + 0.001);
          expect(a[1]).toBeGreaterThanOrEqual(e.bounds.min[2] - 0.001);
          expect(a[1]).toBeLessThanOrEqual(e.bounds.max[2] + 0.001);
        }
      }
      const pts = e.outline.flat();
      expect(Math.min(...pts.map((q) => q[0]))).toBeCloseTo(e.bounds.min[0], 3);
      expect(Math.max(...pts.map((q) => q[0]))).toBeCloseTo(e.bounds.max[0], 3);
      expect(Math.min(...pts.map((q) => q[1]))).toBeCloseTo(e.bounds.min[2], 3);
      expect(Math.max(...pts.map((q) => q[1]))).toBeCloseTo(e.bounds.max[2], 3);
    }
    // the platform's notch is real: the two parts cover clearly less floor than the bounding box
    const pv = MODELS.find((e) => e.id === 'platform_viewing')!;
    const area = pv.outline.reduce((sum, h) => sum + h.reduce((t, q, i) => t + q[0] * h[(i + 1) % h.length]![1] - h[(i + 1) % h.length]![0] * q[1], 0) / 2, 0);
    const box = (pv.bounds.max[0] - pv.bounds.min[0]) * (pv.bounds.max[2] - pv.bounds.min[2]);
    expect(area).toBeLessThan(0.85 * box);
    expect(area).toBeGreaterThan(0.6 * box);
  });
});
