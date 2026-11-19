/**
 * Yard building art kit, part 4: shed, gazebo, greenhouse, doghouse (tools/blender/levels/yard_structures.py),
 * for docs/systems/yard-building.md (W-109). Each is one placed object used through its contact frames.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGlb } from '../models/glbReader';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const L1 = readFileSync(join(ROOT, 'docs', 'levels', 'L1-wormwood.md'), 'utf8');

interface Frame { pos: [number, number, number]; yaw: number; kind: string }
interface Entry {
  id: string; kind: string; file: string; bytes: number; sha256: string; triangles: number; budget: number;
  bounds: { min: [number, number, number]; max: [number, number, number] }; tileFootprint: [number, number];
  tags: string[]; parts: string[]; outline: [number, number][][]; frames: Record<string, Frame>;
}
const MANIFEST = JSON.parse(readFileSync(join(ASSETS, 'manifest.yard.json'), 'utf8')) as { models: Entry[] };
const BY_ID = new Map(MANIFEST.models.map((e) => [e.id, e]));
const STRUCTURES = ['shed_tool', 'gazebo_wilted', 'greenhouse_grim', 'doghouse_crypt'];
const get = (id: string): Entry => {
  const e = BY_ID.get(id);
  expect(e, id).toBeDefined();
  return e!;
};
/** Is the point (x, z) inside the model's footprint rectangle? */
const insideFootprint = (e: Entry, f: Frame): boolean =>
  Math.abs(f.pos[0]) <= e.tileFootprint[0] / 2 && Math.abs(f.pos[2]) <= e.tileFootprint[1] / 2;

describe('yard structures (W-109 part 4)', () => {
  it.each(STRUCTURES)('%s file matches its manifest entry, stands inside its tiles, outdoors only, recolourable', (id) => {
    const e = get(id);
    const path = join(ASSETS, e.file);
    const g = readGlb(path);
    expect(statSync(path).size).toBe(e.bytes);
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(e.sha256);
    expect(g.tris).toBe(e.triangles);
    expect(g.tris).toBeGreaterThanOrEqual(300);                     // ART_DIRECTION: furniture 300 to 3,000,
    expect(g.tris).toBeLessThanOrEqual(e.budget);
    expect(e.budget).toBeLessThanOrEqual(6000);                     // large items <= 6,000
    expect(e.bounds.min[1]).toBeGreaterThanOrEqual(-0.012);
    expect(e.bounds.min[1]).toBeLessThanOrEqual(0.02);
    // inside its tiles to 5 mm: the clipping audit (W-073) fails a floor model that reaches onto the next tile
    expect(Math.max(-e.bounds.min[0], e.bounds.max[0])).toBeLessThanOrEqual(e.tileFootprint[0] / 2 + 0.005);
    expect(Math.max(-e.bounds.min[2], e.bounds.max[2])).toBeLessThanOrEqual(e.tileFootprint[1] / 2 + 0.005);
    expect(e.kind).toBe('floor');
    expect(e.tags).toContain('outdoorOnly');
    expect((g.json.materials as { name: string }[]).map((m) => m.name)).toContain('Paint');
    expect((g.json as unknown as { images?: unknown[] }).images ?? []).toEqual([]);
    for (const p of e.parts) expect(g.byName.has(p), `${id}.${p}`).toBe(true);
    for (const h of e.outline) {
      expect(h.reduce((t, q, i) => t + q[0] * h[(i + 1) % h.length]![1] - h[(i + 1) % h.length]![0] * q[1], 0)).toBeGreaterThan(0);
    }
    const approach = Object.values(e.frames).filter((f) => f.kind === 'approach');
    expect(approach.length).toBeGreaterThanOrEqual(1);
    for (const f of approach) {
      expect(insideFootprint(e, f)).toBe(false);                    // you stand outside it
      expect(f.pos[1]).toBe(0);
    }
  });

  it('the gazebo is L1’s gazebo_wilted: 3 x 3, the doc’s budget, four seats inside facing the middle', () => {
    const e = get('gazebo_wilted');
    const row = L1.split('\n').find((l) => l.startsWith('| `gazebo_wilted`'))!;
    expect(row).toBeDefined();
    const cells = row.split('|').slice(1, -1).map((s) => s.trim());
    expect(cells[3]).toBe('3×3');
    expect(e.tileFootprint).toEqual([3, 3]);
    expect(e.budget).toBe(Number(cells[cells.length - 1]!.replace(/[,\s]/g, '')));
    expect(e.tags).toEqual(expect.arrayContaining(['shelter', 'seat']));
    expect(e.outline).toHaveLength(1);                              // solid for placement: used through its frames
    const seats = ['sit0', 'sit1', 'sit2', 'sit3'].map((n) => e.frames[n]!);
    for (const f of seats) {
      expect(f.kind).toBe('seat');
      expect(insideFootprint(e, f)).toBe(true);
      expect(f.pos[1]).toBeCloseTo(0.14 + 0.46, 2);                 // seat height above the deck
      // yaw 0 faces the front (-Z in glTF), 90 faces +X: the seat looks at the centre
      const dir = [Math.sin((f.yaw * Math.PI) / 180), Math.cos((f.yaw * Math.PI) / 180)];
      const toCentre = [-f.pos[0], -f.pos[2]];
      const n = Math.hypot(toCentre[0]!, toCentre[1]!);
      expect((dir[0]! * toCentre[0]! + dir[1]! * toCentre[1]!) / n).toBeGreaterThan(0.98);
    }
    expect(new Set(seats.map((f) => `${f.pos[0].toFixed(2)},${f.pos[2].toFixed(2)}`)).size).toBe(4);
    expect(e.bounds.max[1]).toBeGreaterThan(3.0);                   // a roof over a standing zombie
    expect(e.frames.sit4).toBeUndefined();
  });

  it('the shed and the greenhouse each have a door node hinged at one side of the front wall', () => {
    for (const id of ['shed_tool', 'greenhouse_grim']) {
      const e = get(id);
      expect(e.parts).toEqual(['door']);
      const g = readGlb(join(ASSETS, e.file));
      const door = g.json.nodes!.find((n) => n.name === 'door') as unknown as { translation: number[] };
      expect(door.translation[2]).toBeGreaterThan(e.bounds.max[2] * 0.55);   // on the front wall (+Z in glTF)
      expect(Math.abs(door.translation[0]!)).toBeGreaterThan(0.25);          // the hinge is off-centre
      expect(e.frames.door!.kind).toBe('approach');
      expect(e.frames.door!.pos[2]).toBeGreaterThan(e.bounds.max[2]);
      expect(e.frames.hands!.kind).toBe('hands');
    }
    const gh = get('greenhouse_grim');
    expect(gh.tileFootprint).toEqual([2, 3]);
    expect(gh.frames.inside!.kind).toBe('feet');
    expect(insideFootprint(gh, gh.frames.inside!)).toBe(true);
    const mats = readGlb(join(ASSETS, gh.file)).json.materials as { name: string; alphaMode?: string }[];
    expect(mats.find((m) => m.name === 'YdGlassHouse')!.alphaMode).toBe('BLEND');   // you can see the shelves through it
  });

  describe('the doghouse fits the pets (measured on the mesh, against manifest.pets.json)', () => {
    const e = get('doghouse_crypt');
    const g = readGlb(join(ASSETS, e.file));
    const PETS = JSON.parse(readFileSync(join(ASSETS, 'manifest.pets.json'), 'utf8')) as {
      species: Record<string, { plan: string; bounds: { min: [number, number, number]; max: [number, number, number] } }>;
    };
    const QUADS = Object.entries(PETS.species).filter(([, sp]) => sp.plan === 'quad');
    type V3 = [number, number, number];
    const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    /** Triangle against an axis-aligned box (separating axes, Akenine-Moller). */
    function triHitsBox(tri: [V3, V3, V3], min: V3, max: V3): boolean {
      const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      const h: V3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
      const p = tri.map((q) => sub(q, c)) as [V3, V3, V3];
      const edges: V3[] = [sub(p[1], p[0]), sub(p[2], p[1]), sub(p[0], p[2])];
      const units: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const axes: V3[] = [...units, cross(edges[0]!, edges[1]!)];
      for (const u of units) for (const ed of edges) axes.push(cross(u, ed));
      for (const a of axes) {
        if (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]) < 1e-12) continue;
        const proj = p.map((q) => dot(q, a));
        const r = h[0] * Math.abs(a[0]) + h[1] * Math.abs(a[1]) + h[2] * Math.abs(a[2]);
        if (Math.min(...proj) > r || Math.max(...proj) < -r) return false;
      }
      return true;
    }
    /** How many triangles of the doghouse touch the box? */
    function hits(min: V3, max: V3): number {
      let n = 0;
      for (const node of g.nodes) {
        const q = node.positions;
        const at = (k: number): V3 => [q[k * 3]!, q[k * 3 + 1]!, q[k * 3 + 2]!];
        for (let t = 0; t + 2 < node.indices.length; t += 3) {
          if (triHitsBox([at(node.indices[t]!), at(node.indices[t + 1]!), at(node.indices[t + 2]!)], min, max)) n++;
        }
      }
      return n;
    }

    it('is one tile, with `pet` and `lie` frames on the floor inside, facing out of the doorway', () => {
      expect(e.tileFootprint).toEqual([1, 1]);
      expect(e.tags).toEqual(expect.arrayContaining(['doghouse', 'pet']));
      expect(e.frames.pet!.kind).toBe('attach');
      expect(e.frames.lie!.kind).toBe('feet');
      for (const f of [e.frames.pet!, e.frames.lie!]) {
        expect(insideFootprint(e, f)).toBe(true);
        expect(f.pos[1]).toBeLessThan(0.1);                         // on the floor
        expect(f.yaw).toBe(0);                                      // facing the front
      }
      expect(QUADS.map(([k]) => k).sort()).toEqual(['cat', 'dog', 'raccoon']);
    });

    it('the test can see the walls: a box through the side wall hits triangles', () => {
      expect(hits([0.25, 0.1, -0.1], [0.45, 0.5, 0.1])).toBeGreaterThan(0);
      expect(hits([-0.1, 0.1, -0.60], [0.1, 0.5, -0.40])).toBeGreaterThan(0);   // and the back wall
    });

    it('the doorway is at least 0.36 m wide and 0.62 m high: a box that size passes through the front wall', () => {
      const y0 = e.frames.pet!.pos[1] + 0.005;
      expect(hits([-0.18, y0, 0.38], [0.18, y0 + 0.62, 0.50])).toBe(0);
      expect(hits([-0.18, y0, 0.38], [0.18, y0 + 0.80, 0.50])).toBeGreaterThan(0);   // there is a lintel above it
      expect(hits([-0.30, y0, 0.38], [0.30, y0 + 0.62, 0.50])).toBeGreaterThan(0);   // and jambs beside it
    });

    it.each(QUADS)('%s stands and lies inside without touching the house, and stays on the tile', (_name, sp) => {
      for (const f of [e.frames.pet!, e.frames.lie!]) {
        const min: V3 = [f.pos[0] + sp.bounds.min[0], f.pos[1] + 0.005, f.pos[2] + sp.bounds.min[2]];
        const max: V3 = [f.pos[0] + sp.bounds.max[0], f.pos[1] + sp.bounds.max[1], f.pos[2] + sp.bounds.max[2]];
        expect(hits(min, max)).toBe(0);
        expect(Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[2]), Math.abs(max[2]))).toBeLessThanOrEqual(0.5);
      }
    });
  });
});
