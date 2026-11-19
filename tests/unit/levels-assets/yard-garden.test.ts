/**
 * Yard building art kit, part 3: the garden plot, three crops and four trees in three growth stages each, and
 * three flower beds (tools/blender/levels/yard_garden.py), for docs/systems/yard-building.md (W-109).
 *
 * Growth stages are separate models, `<base>_s1` .. `_s3`. These tests hold what a growth runtime relies on:
 * every stage exists, a later stage is never smaller than the one before, and a crop fits on the plot.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGlb } from '../models/glbReader';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
const DIR = join(ASSETS, 'models', 'levels', 'yard');

interface Entry {
  id: string; kind: string; file: string; bytes: number; sha256: string; triangles: number; budget: number;
  bounds: { min: [number, number, number]; max: [number, number, number] }; tileFootprint: [number, number];
  tags: string[]; outline: [number, number][][];
  frames?: Record<string, { pos: [number, number, number]; yaw: number; kind: string }>;
}
const MANIFEST = JSON.parse(readFileSync(join(ASSETS, 'manifest.yard.json'), 'utf8')) as { models: Entry[] };
const BY_ID = new Map(MANIFEST.models.map((e) => [e.id, e]));
const get = (id: string): Entry => {
  const e = BY_ID.get(id);
  expect(e, id).toBeDefined();
  return e!;
};

const CROPS = ['cabbage', 'mushroom', 'pumpkin'];
const TREES = ['rotapple', 'bonebirch', 'gravepine', 'bloodmaple'];
const BEDS = ['nightshade', 'marigold', 'lily'];
const STAGES = [1, 2, 3];
const GARDEN = [
  'garden_plot',
  ...CROPS.flatMap((c) => STAGES.map((s) => `crop_${c}_s${s}`)),
  ...TREES.flatMap((t) => STAGES.map((s) => `tree_${t}_s${s}`)),
  ...BEDS.map((b) => `flowerbed_${b}`),
];
const FURNITURE = ['picnic_table', 'swing_creaky', 'birdbath_skull', 'grill_bbq', 'pond_yard'];
const STRUCTURES = ['shed_tool', 'gazebo_wilted', 'greenhouse_grim', 'doghouse_crypt'];   // yard-structures.test.ts
/** Cheap one-tile decor for start-lot variety (W-025 S7). */
const DECOR = ['stump_rotten', 'branches_fallen', 'rocks_small'];
const size = (e: Entry): [number, number, number] =>
  [e.bounds.max[0] - e.bounds.min[0], e.bounds.max[1] - e.bounds.min[1], e.bounds.max[2] - e.bounds.min[2]];

describe('yard garden, trees and flower beds (W-109 part 3)', () => {
  it('the yard kit is exactly the furniture, 25 garden models, four structures and three decor pieces, each with its file', () => {
    expect(GARDEN).toHaveLength(1 + 9 + 12 + 3);
    const all = [...FURNITURE, ...GARDEN, ...STRUCTURES, ...DECOR].sort();
    expect(MANIFEST.models.map((e) => e.id).sort()).toEqual(all);
    expect(readdirSync(DIR).sort()).toEqual(all.map((id) => `${id}.glb`).sort());
  });

  it.each(GARDEN)('%s file matches its manifest entry, stands on the ground inside its tiles, outdoors only', (id) => {
    const e = get(id);
    const path = join(ASSETS, e.file);
    const g = readGlb(path);
    expect(statSync(path).size).toBe(e.bytes);
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(e.sha256);
    expect(g.tris).toBe(e.triangles);
    expect(g.tris).toBeLessThanOrEqual(e.budget);
    expect(e.budget).toBeLessThanOrEqual(6000);                     // ART_DIRECTION: large items <= 6,000
    expect(e.bounds.min[1]).toBeGreaterThanOrEqual(-0.012);
    expect(e.bounds.min[1]).toBeLessThanOrEqual(0.02);
    // inside its tiles to 5 mm: the clipping audit (W-073) fails a floor model that reaches onto the next tile
    expect(Math.max(-e.bounds.min[0], e.bounds.max[0])).toBeLessThanOrEqual(e.tileFootprint[0] / 2 + 0.005);
    expect(Math.max(-e.bounds.min[2], e.bounds.max[2])).toBeLessThanOrEqual(e.tileFootprint[1] / 2 + 0.005);
    expect(e.kind).toBe('floor');
    expect(e.tags).toContain('outdoorOnly');
    expect((g.json as unknown as { images?: unknown[] }).images ?? []).toEqual([]);
    expect(e.outline.length).toBeGreaterThanOrEqual(1);
    for (const h of e.outline) {
      expect(h.reduce((t, q, i) => t + q[0] * h[(i + 1) % h.length]![1] - h[(i + 1) % h.length]![0] * q[1], 0)).toBeGreaterThan(0);
    }
  });

  it('the plot is a 2 x 2 bed with a `crop` frame on its soil, below the edging, and a place to tend it from', () => {
    const plot = get('garden_plot');
    expect(plot.tileFootprint).toEqual([2, 2]);
    const crop = plot.frames!.crop!;
    expect(crop.kind).toBe('attach');
    expect(crop.pos[0]).toBeCloseTo(0, 3);
    expect(crop.pos[2]).toBeCloseTo(0, 3);
    expect(crop.pos[1]).toBeGreaterThan(0.10);
    expect(crop.pos[1]).toBeLessThan(0.20);                         // the timber edging is 0.20 m high
    expect(plot.frames!.tend!.kind).toBe('approach');
    expect(Math.abs(plot.frames!.tend!.pos[2])).toBeGreaterThan(1.0);   // outside the bed
    expect(plot.frames!.hands!.kind).toBe('hands');
  });

  it.each(CROPS)('crop %s has three stages that fit inside the plot and grow', (c) => {
    const plot = get('garden_plot');
    const inner = size(plot)[0] / 2 - 0.07;                         // inside the edging
    const stages = STAGES.map((s) => get(`crop_${c}_s${s}`));
    for (const [i, e] of stages.entries()) {
      expect(e.tags).toEqual(expect.arrayContaining(['crop', c, `stage${i + 1}`]));
      expect(e.tileFootprint).toEqual(plot.tileFootprint);
      expect(Math.max(-e.bounds.min[0], e.bounds.max[0], -e.bounds.min[2], e.bounds.max[2])).toBeLessThan(inner);
      expect(e.outline).toHaveLength(1);                            // one hull: the plot is what gets placed
      expect(e.frames ?? {}).toEqual({});
    }
    expect(size(stages[1]!)[1]).toBeGreaterThan(size(stages[0]!)[1]);
    expect(size(stages[2]!)[1]).toBeGreaterThan(size(stages[1]!)[1]);
    expect(stages[2]!.triangles).toBeGreaterThan(stages[0]!.triangles);
  });

  it.each(TREES)('tree %s has three stages: a staked sapling, a young tree on one tile, a grown tree on 2 x 2', (t) => {
    const stages = STAGES.map((s) => get(`tree_${t}_s${s}`));
    expect(stages.map((e) => e.tileFootprint)).toEqual([[1, 1], [1, 1], [2, 2]]);
    for (const [i, e] of stages.entries()) {
      expect(e.tags).toEqual(expect.arrayContaining(['tree', t, `stage${i + 1}`]));
      const tend = e.frames!.tend!;
      expect(tend.kind).toBe('approach');
      expect(Math.abs(tend.pos[2])).toBeCloseTo(e.tileFootprint[1] / 2 + 0.45, 2);   // just outside the footprint
    }
    const s1 = size(stages[0]!);
    const s2 = size(stages[1]!);
    const s3 = size(stages[2]!);
    expect(s1[1]).toBeLessThan(1.1);                                // a sapling is below the waist
    expect(s2[1]).toBeGreaterThan(s1[1] * 2);
    expect(s3[1]).toBeGreaterThan(s2[1] * 1.4);
    expect(s3[1]).toBeGreaterThan(3.5);                             // a grown tree is taller than a house wall
    expect(s3[0]).toBeGreaterThan(s2[0]);                           // and wider
  });

  it('the four trees are four different shapes, not one tree recoloured', () => {
    const grown = TREES.map((t) => get(`tree_${t}_s3`));
    expect(new Set(grown.map((e) => e.sha256)).size).toBe(4);
    expect(new Set(grown.map((e) => e.triangles)).size).toBe(4);
    const mats = grown.map((e) => (readGlb(join(ASSETS, e.file)).json.materials as { name: string }[]).map((m) => m.name).sort().join());
    expect(new Set(mats).size).toBe(4);
  });

  it.each(BEDS)('flower bed %s is a 2 x 1 bed, low enough to see over, with a place to tend it from', (b) => {
    const e = get(`flowerbed_${b}`);
    expect(e.tileFootprint).toEqual([2, 1]);
    expect(size(e)[1]).toBeLessThan(0.7);
    expect(e.tags).toContain('flowerbed');
    expect(e.frames!.tend!.kind).toBe('approach');
    expect(e.triangles).toBeGreaterThanOrEqual(300);
  });

  it.each(DECOR)('decor %s is a low one-tile piece inside its tile, outdoors only, tagged cheap, within budget', (id) => {
    const e = get(id);
    const g = readGlb(join(ASSETS, e.file));
    expect(createHash('sha256').update(readFileSync(join(ASSETS, e.file))).digest('hex')).toBe(e.sha256);
    expect(g.tris).toBe(e.triangles);
    expect(g.tris).toBeLessThanOrEqual(e.budget);
    expect(e.tileFootprint).toEqual([1, 1]);
    expect(e.kind).toBe('floor');
    expect(e.tags).toEqual(expect.arrayContaining(['outdoorOnly', 'decor', 'cheap']));
    expect(Math.max(-e.bounds.min[0], e.bounds.max[0], -e.bounds.min[2], e.bounds.max[2])).toBeLessThanOrEqual(0.505);
    expect(e.bounds.min[1]).toBeGreaterThanOrEqual(-0.012);
    expect(e.bounds.min[1]).toBeLessThanOrEqual(0.02);
    expect(e.bounds.max[1]).toBeLessThan(0.6);                      // you see over it; it never hides a zombie
    expect((g.json as unknown as { images?: unknown[] }).images ?? []).toEqual([]);
    expect(e.outline.length).toBeGreaterThanOrEqual(1);
  });

  it('no garden id is used by another kit', () => {
    for (const name of readdirSync(ASSETS).filter((f) => /^manifest\..+\.json$/.test(f) && f !== 'manifest.yard.json')) {
      const m = JSON.parse(readFileSync(join(ASSETS, name), 'utf8')) as { models?: unknown };
      const ids = Array.isArray(m.models) ? (m.models as { id: string }[]).map((e) => e.id) : Object.keys((m.models ?? {}) as object);
      for (const id of [...GARDEN, ...DECOR]) expect(ids, `${id} also in ${name}`).not.toContain(id);
    }
  });
});
