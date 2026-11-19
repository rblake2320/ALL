/**
 * Yard building art kit, part 2: outdoor furniture (tools/blender/levels/build_yard.py -> models/levels/yard +
 * manifest.yard.json), for docs/systems/yard-building.md (W-109).
 *
 * The spec asks for eight pieces. Five are built here; three are existing models reused as they are, and this
 * test holds that mapping: if a reused model disappears, the yard is short a piece.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundsOf, readGlb, type Glb } from '../models/glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DIR = join(ASSETS, 'models', 'levels', 'yard');
const L1 = readFileSync(join(ROOT, 'docs', 'levels', 'L1-wormwood.md'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const load = (name: string): Json => JSON.parse(readFileSync(join(ASSETS, name), 'utf8')) as Json;

interface Entry {
  id: string; level: string; kind: string; file: string; bytes: number; sha256: string; triangles: number;
  bounds: { min: [number, number, number]; max: [number, number, number] }; tileFootprint: [number, number];
  budget: number; parts: string[]; states: string[]; tags: string[]; outline: [number, number][][];
  frames: Record<string, { pos: [number, number, number]; yaw: number; kind: string }>;
}
const MANIFEST = load('manifest.yard.json') as { level: string; models: Entry[] };
/** The yard kit also holds the garden, trees and flower beds (yard-garden.test.ts); this file is the furniture. */
const FURNITURE = ['picnic_table', 'swing_creaky', 'birdbath_skull', 'grill_bbq', 'pond_yard'];
const MODELS = MANIFEST.models.filter((e) => FURNITURE.includes(e.id));
const BY_ID = new Map(MODELS.map((e) => [e.id, e]));
const GLBS = new Map<string, Glb>(MODELS.map((e) => [e.id, readGlb(join(ASSETS, e.file))]));

/** The eight outdoor furniture pieces of yard-building §1: built here, or an existing model in another kit. */
const BUILT = FURNITURE;
const REUSED: Record<string, [string, string]> = {
  bench: ['manifest.structures.json', 'curb_bench'],
  hammock: ['manifest.bayou.json', 'hammock_moss'],
  firepit: ['manifest.levels.json', 'firepit_grill'],
};

/** L1 §4 rows: id -> { footprint, tris }. */
function l1Row(id: string): { size: string; tris: number } {
  const line = L1.split('\n').find((l) => l.startsWith(`| \`${id}\``));
  expect(line, `${id} is not in L1 §4`).toBeDefined();
  const c = line!.split('|').slice(1, -1).map((s) => s.trim());
  return { size: c[3]!, tris: Number(c[c.length - 1]!.replace(/[,\s]/g, '')) };
}

describe('yard furniture (W-109 part 2)', () => {
  it('builds five pieces and reuses three, eight in all', () => {
    expect(MANIFEST.level).toBe('yard');
    expect(MODELS.map((e) => e.id).sort()).toEqual([...BUILT].sort());
    expect(readdirSync(DIR)).toEqual(expect.arrayContaining(BUILT.map((id) => `${id}.glb`)));
    expect(BUILT.length + Object.keys(REUSED).length).toBe(8);
    for (const [piece, [manifest, id]] of Object.entries(REUSED)) {
      const m = load(manifest);
      const ids = Array.isArray(m.models) ? (m.models as Json[]).map((e) => e.id) : Object.keys(m.models as Json);
      expect(ids, `${piece}: ${id} in ${manifest}`).toContain(id);
      expect(BUILT, `${piece} must not be built twice`).not.toContain(id);
    }
  });

  it('uses the L1 doc’s ids, footprints and budgets where the doc already defines the object', () => {
    for (const id of ['picnic_table', 'swing_creaky']) {
      const row = l1Row(id);
      const e = BY_ID.get(id)!;
      expect(e.budget).toBe(row.tris);
      const m = /(\d+)×(\d+)/.exec(row.size)!;
      expect(e.tileFootprint).toEqual([Number(m[1]), Number(m[2])]);
    }
    expect(L1).toContain('`birdbath_skull`');
  });

  it.each(MODELS.map((e) => [e.id, e] as const))('%s file matches its manifest entry and sits on its tiles', (_id, e) => {
    const path = join(ASSETS, e.file);
    const g = GLBS.get(e.id)!;
    expect(statSync(path).size).toBe(e.bytes);
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(e.sha256);
    expect(g.tris).toBe(e.triangles);
    expect(g.tris).toBeLessThanOrEqual(e.budget);
    expect(g.tris).toBeGreaterThanOrEqual(300);                     // ART_DIRECTION: furniture 300 to 3,000
    const b = boundsOf(g, ['broken', ...e.states]);
    expect(b.min[1]).toBeGreaterThanOrEqual(-0.005);
    expect(b.min[1]).toBeLessThanOrEqual(0.02);
    // inside its tiles to 5 mm: the clipping audit (W-073) fails a floor model that reaches onto the next tile
    expect(Math.max(-b.min[0], b.max[0])).toBeLessThanOrEqual(e.tileFootprint[0] / 2 + 0.005);
    expect(Math.max(-b.min[2], b.max[2])).toBeLessThanOrEqual(e.tileFootprint[1] / 2 + 0.005);
    expect(e.kind).toBe('floor');
    expect(e.tags).toContain('outdoorOnly');
    const js = g.json as unknown as Json;
    expect(js.images ?? []).toEqual([]);
    for (const p of e.parts) expect(g.byName.has(p), `${e.id}.${p}`).toBe(true);
    expect(e.outline.length).toBeGreaterThanOrEqual(1);
    for (const h of e.outline) {
      expect(h.reduce((t, q, i) => t + q[0] * h[(i + 1) % h.length]![1] - h[(i + 1) % h.length]![0] * q[1], 0)).toBeGreaterThan(0);
    }
  });

  it('the picnic table seats four at seat height, two a side, facing the table, with its top at table height', () => {
    const e = BY_ID.get('picnic_table')!;
    const seats = ['n0', 'n1', 's0', 's1'].map((n) => e.frames[n]!);
    for (const f of seats) {
      expect(f.kind).toBe('seat');
      expect(f.pos[1]).toBeCloseTo(0.46, 2);
    }
    expect(seats.filter((f) => f.pos[0] < 0)).toHaveLength(2);
    expect(seats.filter((f) => f.pos[0] > 0)).toHaveLength(2);
    for (const f of seats) expect(Math.sign(Math.sin((f.yaw * Math.PI) / 180))).toBe(-Math.sign(f.pos[0]));   // yaw 90 faces +X
    expect(e.bounds.max[1]).toBeCloseTo(0.76, 1);
    expect(e.frames.approach!.kind).toBe('approach');
  });

  it('the swing set has two swings, each a node hung from the top bar with a seat frame on its plank', () => {
    const e = BY_ID.get('swing_creaky')!;
    const g = GLBS.get(e.id)!;
    expect(e.parts.sort()).toEqual(['swing0', 'swing1']);
    for (const i of [0, 1]) {
      const pivot = (g.json.nodes!.find((n) => n.name === `swing${i}`) as Json).translation as number[];
      expect(pivot[1]).toBeGreaterThan(2.0);                        // the pivot is up at the bar
      const seat = e.frames[`seat_${i}`]!;
      expect(seat.kind).toBe('seat');
      expect(seat.pos[0]).toBeCloseTo(pivot[0]!, 2);                // straight below its pivot
      expect(seat.pos[1]).toBeGreaterThan(0.35);
      expect(seat.pos[1]).toBeLessThan(0.65);
    }
    expect((g.json.materials as Json[]).map((m) => m.name)).toContain('Paint');   // the frame is recolourable
  });

  it('the birdbath has water and a perch on its rim for birds (W-075)', () => {
    const e = BY_ID.get('birdbath_skull')!;
    expect(e.parts).toEqual(['water']);
    expect(e.tags).toContain('perch');
    const perch = e.frames.perch!;
    expect(perch.kind).toBe('feet');
    expect(perch.pos[1]).toBeGreaterThan(0.9);                     // up on the rim
    expect(perch.pos[1]).toBeLessThanOrEqual(e.bounds.max[1] + 0.01);
    expect(Math.hypot(perch.pos[0], perch.pos[2])).toBeGreaterThan(0.25);    // on the rim, not in the water
    expect(Math.hypot(perch.pos[0], perch.pos[2])).toBeLessThan(0.40);
    expect(e.frames.perch_2).toBeDefined();
  });

  it('the grill has a lid node, glowing coals and somewhere to stand; the pond has water', () => {
    const grill = BY_ID.get('grill_bbq')!;
    expect(grill.parts.sort()).toEqual(['flame', 'lid']);
    expect(grill.frames.cook!.kind).toBe('approach');
    expect(grill.frames.cook!.pos[2]).toBeGreaterThan(0.5);
    const g = GLBS.get('grill_bbq')!;
    const flame = g.json.nodes!.find((n) => n.name === 'flame') as Json;
    const mats = (g.json.meshes![flame.mesh].primitives as Json[]).map((p) => (g.json.materials as Json[])[p.material]!);
    expect(Math.max(...mats.map((m) => Math.max(...((m.emissiveFactor as number[]) ?? [0]))))).toBeGreaterThan(0);
    const pond = BY_ID.get('pond_yard')!;
    expect(pond.parts).toEqual(['water']);
    expect(pond.bounds.max[1]).toBeLessThan(0.4);                  // low: a pond, not a wall
  });
});
