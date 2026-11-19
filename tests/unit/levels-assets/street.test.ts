/**
 * Street and district art kit (W-025 slice S9, docs/DESIGN_WORLD_LEVELS.md §1.2, §1.4, §1.10):
 * tools/blender/levels/build_street.py -> models/levels/street + manifest.street.json.
 *
 * Also holds the two facts the design asks this slice to verify:
 *   A4  a 10-tile street cell fits the road, both kerbs and two 1 m verges, and what stands in a verge fits it;
 *   A2  a house shown as a distant ("warm") shell costs at most 4 draw calls.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGlb } from '../models/glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DIR = join(ASSETS, 'models', 'levels', 'street');

interface Frame { pos: [number, number, number]; yaw: number; kind: string }
interface Entry {
  id: string; kind: string; file: string; bytes: number; sha256: string; triangles: number; budget: number;
  bounds: { min: [number, number, number]; max: [number, number, number] }; tileFootprint: [number, number];
  tags: string[]; parts: string[]; outline: [number, number][][]; frames?: Record<string, Frame>;
}
const MANIFEST = JSON.parse(readFileSync(join(ASSETS, 'manifest.street.json'), 'utf8')) as { level: string; models: Entry[] };
const BY_ID = new Map(MANIFEST.models.map((e) => [e.id, e]));
const get = (id: string): Entry => {
  const e = BY_ID.get(id);
  expect(e, id).toBeDefined();
  return e!;
};
const IDS = ['sign_street', 'sign_construction', 'barrier_road', 'fence_construction_run', 'fence_construction_post', 'curb_ramp', 'street_end_circle'];
const size = (e: Entry): [number, number, number] =>
  [e.bounds.max[0] - e.bounds.min[0], e.bounds.max[1] - e.bounds.min[1], e.bounds.max[2] - e.bounds.min[2]];

// the renderer's street (src/render/world/dressing.ts) and the design's cell (§1.2)
const DRESSING = readFileSync(join(ROOT, 'src', 'render', 'world', 'dressing.ts'), 'utf8');
const constant = (name: string): number => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(DRESSING)![1]);
const ROAD_WIDTH = constant('ROAD_WIDTH');
const CURB_W = constant('CURB_W');
const CURB_TOP = constant('CURB_TOP');
const CELL = 10;
const VERGE = 1;

describe('street kit (W-025 S9)', () => {
  it('is exactly the seven pieces, each with its file', () => {
    expect(MANIFEST.level).toBe('street');
    expect(MANIFEST.models.map((e) => e.id).sort()).toEqual([...IDS].sort());
    expect(readdirSync(DIR).sort()).toEqual(IDS.map((id) => `${id}.glb`).sort());
  });

  it.each(IDS)('%s file matches its manifest entry, is inside its footprint to 5 mm and within budget', (id) => {
    const e = get(id);
    const path = join(ASSETS, e.file);
    const g = readGlb(path);
    expect(statSync(path).size).toBe(e.bytes);
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(e.sha256);
    expect(g.tris).toBe(e.triangles);
    expect(g.tris).toBeLessThanOrEqual(e.budget);
    expect(e.budget).toBeLessThanOrEqual(3000);
    expect(e.bounds.min[1]).toBeGreaterThanOrEqual(-0.012);
    expect(e.bounds.min[1]).toBeLessThanOrEqual(0.02);
    expect(Math.max(-e.bounds.min[0], e.bounds.max[0])).toBeLessThanOrEqual(e.tileFootprint[0] / 2 + 0.005);
    expect(Math.max(-e.bounds.min[2], e.bounds.max[2])).toBeLessThanOrEqual(e.tileFootprint[1] / 2 + 0.005);
    expect((g.json as unknown as { images?: unknown[] }).images ?? []).toEqual([]);
    for (const p of e.parts) expect(g.byName.has(p), `${id}.${p}`).toBe(true);
    for (const h of e.outline) {
      expect(h.reduce((t, q, i) => t + q[0] * h[(i + 1) % h.length]![1] - h[(i + 1) % h.length]![0] * q[1], 0)).toBeGreaterThan(0);
    }
  });

  it('the street sign has two blank blades at right angles, above head height, and a place to read it from', () => {
    const e = get('sign_street');
    const g = readGlb(join(ASSETS, e.file));
    expect(e.parts.sort()).toEqual(['plate', 'plate_cross']);
    const node = (name: string) => g.json.nodes!.find((n) => n.name === name) as unknown as { translation: number[]; extras: { part: string; text: string } };
    expect(node('plate').extras).toMatchObject({ part: 'plate', text: 'streetName' });
    expect(node('plate_cross').extras).toMatchObject({ part: 'plate', text: 'crossStreetName' });
    expect(node('plate').translation[1]).toBeGreaterThan(2.0);        // nobody walks into it
    expect(node('plate_cross').translation[1]).toBeGreaterThan(node('plate').translation[1]!);
    expect((g.json.materials as { name: string }[]).map((m) => m.name)).toContain('Paint');
    expect(e.frames!.read!.kind).toBe('approach');
  });

  it('the construction sign carries a blank strip for what is being built and a place to read it from', () => {
    const e = get('sign_construction');
    const g = readGlb(join(ASSETS, e.file));
    const plate = g.json.nodes!.find((n) => n.name === 'plate') as unknown as { translation: number[]; extras: { text: string } };
    expect(plate.extras.text).toBe('unfinishedWhat');
    expect(plate.translation[1]).toBeGreaterThan(0.8);
    expect(plate.translation[1]).toBeLessThan(1.3);                   // readable at zombie eye height
    expect(plate.translation[2]).toBeGreaterThan(0);                  // on the front
    expect(e.tags).toContain('unfinished');
    const read = e.frames!.read!;
    expect(read.kind).toBe('approach');
    expect(read.pos[2]).toBeGreaterThan(e.bounds.max[2]);             // in front of the board
  });

  it('three barriers close a street from kerb to kerb, each with warning lamps that glow', () => {
    const e = get('barrier_road');
    expect(e.tileFootprint).toEqual([3, 1]);
    expect(e.tags).toEqual(expect.arrayContaining(['barrier', 'blocksPath']));
    expect(3 * e.tileFootprint[0]).toBeGreaterThanOrEqual(ROAD_WIDTH + 2 * CURB_W);
    expect(size(e)[0]).toBeGreaterThan(2.5);                          // a zombie cannot slip between two of them
    expect(e.bounds.max[1]).toBeGreaterThan(0.9);
    const g = readGlb(join(ASSETS, e.file));
    const glow = g.json.nodes!.find((n) => n.name === 'glow') as unknown as { mesh: number };
    const mats = (g.json.meshes![glow.mesh] as unknown as { primitives: { material: number }[] }).primitives
      .map((p) => (g.json.materials as { emissiveFactor?: number[] }[])[p.material]!);
    expect(Math.max(...mats.map((m) => Math.max(...(m.emissiveFactor ?? [0]))))).toBeGreaterThan(0);
  });

  it('the construction fence is an edge run exactly one tile long, taller than a zombie, with a matching post', () => {
    const run = get('fence_construction_run');
    const post = get('fence_construction_post');
    expect(run.kind).toBe('edge');
    expect(post.kind).toBe('edge');
    expect(size(run)[0]).toBeCloseTo(1.0, 2);                         // runs butt end to end
    expect(size(run)[2]).toBeLessThan(0.2);
    expect(run.bounds.max[1]).toBeGreaterThan(1.8);
    expect(post.bounds.max[1]).toBeGreaterThan(run.bounds.max[1]);
    expect(size(post)[0]).toBeLessThan(0.4);
    const mats = readGlb(join(ASSETS, run.file)).json.materials as { name: string; alphaMode?: string }[];
    expect(mats.find((m) => m.name === 'StMesh')!.alphaMode).toBe('BLEND');   // you can see the unfinished land through it
  });

  it('the kerb ramp is as wide as a crosswalk and as high as the renderer’s kerb', () => {
    const e = get('curb_ramp');
    expect(e.tileFootprint).toEqual([2, 1]);                          // §1.2: a crosswalk is 2 tiles wide
    expect(size(e)[0]).toBeCloseTo(2.0, 2);
    expect(e.bounds.max[1]).toBeGreaterThanOrEqual(CURB_TOP - 0.001);
    expect(e.bounds.max[1]).toBeLessThanOrEqual(CURB_TOP + 0.015);    // studs only
    expect(size(e)[2]).toBeGreaterThanOrEqual(CURB_W);
  });

  it('the street end fits one 10 x 10 cell, with the kerb ring wide enough for the road and clear of the verge', () => {
    const e = get('street_end_circle');
    expect(e.kind).toBe('env');
    expect(e.tileFootprint).toEqual([CELL, CELL]);
    expect(size(e)[0]).toBeGreaterThan(ROAD_WIDTH + 2 * CURB_W);     // the ring is wider than the road it ends
    expect(Math.max(-e.bounds.min[0], e.bounds.max[0])).toBeLessThanOrEqual(CELL / 2 - 0.5);
    expect(e.bounds.max[2]).toBeGreaterThan(0);                       // open toward the front, where the road comes in
    expect(Math.abs(e.bounds.min[2])).toBeGreaterThan(e.bounds.max[2]);
    expect(e.outline).toHaveLength(1);
  });
});

describe('design assumption A4: the 10-tile street cell', () => {
  it('road + two kerbs + two 1 m verges = one cell', () => {
    expect(ROAD_WIDTH + 2 * CURB_W + 2 * VERGE).toBe(CELL);
  });

  it('what stands in a verge fits its 1 m: the street lamp’s base depth, the hydrant, the street sign, the construction sign', () => {
    const objects = (JSON.parse(readFileSync(join(ASSETS, 'manifest.objects.json'), 'utf8')) as {
      objects: Record<string, { bounds: { min: number[]; max: number[] } }>;
    }).objects;
    const depth = (id: string): number => objects[id]!.bounds.max[2]! - objects[id]!.bounds.min[2]!;
    const width = (id: string): number => objects[id]!.bounds.max[0]! - objects[id]!.bounds.min[0]!;
    expect(depth('env_streetlamp')).toBeLessThanOrEqual(VERGE);
    expect(Math.max(depth('env_hydrant'), width('env_hydrant'))).toBeLessThanOrEqual(VERGE);
    for (const id of ['sign_street', 'sign_construction']) expect(Math.max(size(get(id))[0], size(get(id))[2])).toBeLessThanOrEqual(VERGE);
    // recorded, not hidden: these two do not fit a 1 m verge and must stand on lots or beyond the street
    expect(width('env_bush')).toBeGreaterThan(VERGE);
    expect(width('env_tree_b')).toBeGreaterThan(VERGE);
  });
});

describe('design assumption A2: a house as a distant shell costs at most 4 draw calls', () => {
  const HOMES = JSON.parse(readFileSync(join(ASSETS, 'manifest.homes.json'), 'utf8')) as {
    shells: Record<string, { template: string; lods: { lod: number; file: string }[] }>;
  };
  it.each(Object.entries(HOMES.shells))('%s: the far level of detail is 2 draw calls and under 2,000 triangles', (_id, shell) => {
    const far = shell.lods.find((l) => l.lod === 1);
    expect(far, 'no far level of detail').toBeDefined();
    const g = readGlb(join(ASSETS, far!.file));
    const draws = (g.json.meshes as unknown as { primitives: unknown[] }[]).reduce((n, m) => n + m.primitives.length, 0);
    expect(draws).toBeLessThanOrEqual(4);
    expect(draws).toBe(2);                                            // walls and roof in one, glass in the other
    expect(g.tris).toBeLessThanOrEqual(2000);
  });
});
