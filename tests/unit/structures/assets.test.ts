/**
 * Structures kit (tools/blender/structures/build_structures.py) against public/assets/manifest.structures.json:
 * parking objects (docs/systems/vehicles.md §5) and Quick Build stairs, ramps and pillars per material tier
 * (docs/systems/quick-build.md §4.4 and §11). Stand-alone kit by decision D-038: not catalogue objects yet.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
const STOREY_HEIGHT = 2.9; // docs/systems/quick-build.md §3: WALL_HEIGHT 2.7 + FLOOR_SLAB 0.2
const MATERIALS = ['wood', 'stone', 'metal'];
// id pattern -> [triangle budget, footprint w, footprint d]  (budgets from the two design docs)
const QUICK_BUILD: Record<string, [number, number, number]> = {
  qb_stairs: [1800, 1, 3],
  qb_grandstairs: [3500, 3, 3],
  qb_ramp: [1200, 3, 3],
  qb_ramp_narrow: [1200, 1, 3],
  qb_pillar: [400, 1, 1],
  // W-083: guard rail for a stairwell opening (centred on a tile edge) and a free-standing landing
  qb_stairwell_rail: [300, 1, 0.2],
  qb_landing: [500, 1, 1],
};
const PARKING: Record<string, [number, number, number]> = {
  pad_driveway: [300, 2, 5],
  carport_crooked: [2800, 3, 6],
  rack_bike: [500, 1, 2],
  door_garage: [1600, 3, 0.4],
  pad_garage: [100, 3, 6],
};
// the crew's project kit (docs/systems/housing-progression.md §15: scaffold_project <= 1,800 triangles)
const PROJECT: Record<string, [number, number, number]> = {
  scaffold_project: [1800, 3, 1],
  scaffold_bay: [600, 2, 1],
  scaffold_ladder: [300, 1, 1],
  scaffold_tarp: [400, 2, 1],
  lantern_crew: [400, 1, 1],
};
// curb-appeal dressing (housing-progression §15: each band's SET stays within 1,200 triangles); id -> [budget, w, d, band]
const CURB: Record<string, [number, number, number, number]> = {
  curb_fence_picket: [300, 1, 0.2, 1],
  curb_mailbox: [300, 1, 1, 1],
  curb_flowerbed: [400, 2, 1, 1],
  curb_gnome_skull: [300, 1, 1, 1],
  curb_planter: [400, 1, 1, 2],
  curb_porch_light: [300, 1, 1, 2],
  curb_bench: [300, 2, 1, 2],
  curb_bike_rack: [300, 1, 1, 2],
  curb_topiary: [400, 1, 1, 3],
  curb_fountain: [500, 2, 2, 3],
  curb_gate_iron: [400, 1, 0.2, 3],
  curb_lamp_post: [300, 1, 1, 3],
};
// yard fences and gates (docs/systems/yard-building.md §1/§3): five styles x run, post, gate
const FENCE_STYLES = ['picket', 'iron', 'bone', 'hedge', 'stone'];
const FENCE: Record<string, [number, number, number]> = {};
for (const st of FENCE_STYLES) {
  FENCE[`fence_${st}_run`] = [300, 1, 0.5];
  FENCE[`fence_${st}_post`] = [st === 'bone' ? 300 : 200, 0.5, 0.5];
  FENCE[`fence_${st}_gate`] = [700, 1, 0.5];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.structures.json'), 'utf8')) as Json;
const expected: Record<string, [number, number, number]> = { ...PARKING, ...PROJECT };
for (const [id, v] of Object.entries(CURB)) expected[id] = [v[0], v[1], v[2]];
Object.assign(expected, FENCE);
for (const [stem, v] of Object.entries(QUICK_BUILD)) for (const m of MATERIALS) expected[`${stem}_${m}`] = v;

function readGlb(file: string): { json: Json; data: Buffer } {
  const data = readFileSync(join(ASSETS, file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  return { json: JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) as Json, data };
}

describe('structures manifest', () => {
  it('lists every parking object and every Quick Build piece in all three material tiers', () => {
    expect(Object.keys(manifest.models).sort()).toEqual(Object.keys(expected).sort());
    expect(manifest.storeyHeight).toBe(STOREY_HEIGHT);
    expect(manifest.front).toBe('+Z');
    expect(manifest.up).toBe('+Y');
  });
});

describe.each(Object.keys(expected))('structure %s', (id) => {
  const entry = manifest.models[id] as Json;
  const [budget, w, d] = expected[id]!;
  const { json, data } = readGlb(entry.file);

  it('file matches the manifest and stays inside its triangle budget', () => {
    expect(entry.file).toBe(`models/structures/${id}.glb`);
    expect(data.length).toBe(entry.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
    let tris = 0;
    for (const m of json.meshes as Json[]) for (const p of m.primitives as Json[]) tris += json.accessors[p.indices].count / 3;
    expect(tris).toBe(entry.triangles);
    expect(tris).toBeLessThanOrEqual(budget);
    expect(tris).toBeGreaterThan(20);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
  });

  it('sits on the floor and inside its footprint, centred on the origin', () => {
    const { min, max } = entry.bounds as { min: number[]; max: number[] };
    expect(min[1]!).toBeGreaterThanOrEqual(-0.002);
    expect(min[1]!).toBeLessThanOrEqual(0.004);
    expect(entry.tileFootprint).toEqual({ w, d });
    if (entry.kind !== 'opening') {
      expect(Math.max(Math.abs(min[0]!), Math.abs(max[0]!))).toBeLessThanOrEqual(w / 2 + 0.03);
      expect(Math.max(Math.abs(min[2]!), Math.abs(max[2]!))).toBeLessThanOrEqual(d / 2 + 0.03);
    }
  });

  it('carries the data its kind needs', () => {
    const names = (json.nodes as Json[]).map((n) => n.name as string);
    if (id.startsWith('qb_')) {
      expect(MATERIALS).toContain(entry.material);
      if (entry.kind === 'edge') {
        expect(entry.bounds.max[1]).toBeGreaterThanOrEqual(0.9);            // a 0.9 m 'Half' railing
        expect(entry.bounds.max[1]).toBeLessThan(1.0);
        expect(entry.bounds.max[0] - entry.bounds.min[0]).toBeGreaterThan(0.9);   // spans the tile edge
        expect(entry.vertical).toBeUndefined();
      } else if (entry.kind === 'landing') {
        expect(entry.bounds.max[1]).toBeCloseTo(STOREY_HEIGHT, 2);          // deck at the next storey
        expect(entry.frames.top).toEqual({ pos: [0, STOREY_HEIGHT, 0], yaw: 0, kind: 'feet' });
      } else if (entry.kind === 'pillar') {
        expect(entry.bounds.max[1]).toBeCloseTo(2.7, 2); // up to the underside of the slab above
        expect(entry.bounds.max[0] - entry.bounds.min[0]).toBeLessThanOrEqual(0.36); // "a 0.35 m post"
      } else {
        expect(entry.vertical).toEqual({
          kind: entry.kind === 'ramp' ? 'ramp' : 'stairs',
          run: 3,
          width: w,
          rise: STOREY_HEIGHT,
          climbs: '+Z',
        });
        expect(entry.bounds.max[1]).toBeGreaterThan(STOREY_HEIGHT); // rails rise above the landing
      }
    }
    if (id === 'door_garage') {
      expect(names).toContain('door');
      const door = (json.nodes as Json[]).find((n) => n.name === 'door')!;
      expect(door.extras?.part).toBe('door');
      expect(entry.bounds.max[0] - entry.bounds.min[0]).toBeGreaterThan(2.8); // spans three wall segments
      expect(entry.bounds.max[0] - entry.bounds.min[0]).toBeLessThanOrEqual(3.2);
    }
    if (id === 'carport_crooked') {
      expect(names).toContain('glow');
      expect(entry.bounds.max[1]).toBeGreaterThan(2.2); // a hearse (1.61 m) fits under it
    }
    if (id.startsWith('pad_')) expect(entry.bounds.max[1]).toBeLessThan(0.2); // passable rug-layer pads
    if (id in PROJECT) {
      expect(entry.kind).toBe('project');
      for (const part of entry.parts as string[]) expect(names, `${id}.${part}`).toContain(part);
    }
    if (id === 'scaffold_project') {
      expect((entry.parts as string[]).sort()).toEqual(['glow', 'tarp']);
      expect(entry.bounds.max[1]).toBeGreaterThan(2.9);                    // guard rail above a storey
      expect(entry.bounds.max[1]).toBeLessThan(3.3);
      const f = entry.frames as Record<string, { pos: number[]; yaw: number; kind: string }>;
      expect(Object.keys(f).sort()).toEqual(['pitch_in', 'work', 'work_2']);
      expect(f.pitch_in!.kind).toBe('approach');
      expect(f.pitch_in!.pos[1]).toBe(0);                                  // on the ground, in front
      expect(f.pitch_in!.pos[2]!).toBeGreaterThan(0.5);
      expect(f.work!.pos[1]).toBe(2);                                      // on the deck
      expect(Math.abs(f.work!.pos[2]!)).toBeLessThan(0.4);
    }
    if (id === 'scaffold_bay' || id === 'scaffold_project') {
      // the deck is a real surface at 2.0 m: there are plank vertices there, across most of the width
      const deck = (entry.frames as Json).work.pos as number[];
      expect(deck[1]).toBe(2);
    }
  });
});

describe('Quick Build material tiers are different constructions, not recolours', () => {
  it.each(Object.keys(QUICK_BUILD))('%s: the three tiers differ in geometry and materials', (stem) => {
    const tiers = MATERIALS.map((m) => manifest.models[`${stem}_${m}`] as Json);
    expect(new Set(tiers.map((t) => t.sha256)).size).toBe(3);
    expect(new Set(tiers.map((t) => (t.materials as string[]).join(','))).size).toBe(3);
  });
});

describe('W-083 follow-ups', () => {
  const qb = Object.keys(expected).filter((id) => id.startsWith('qb_'));

  it.each(qb)('%s has a far level of detail: same footprint, well under half the triangles', (id) => {
    const entry = manifest.models[id] as Json;
    const lod = entry.lod1 as Json;
    expect(lod.file).toBe(`models/structures/${id}_lod1.glb`);
    const { json, data } = readGlb(lod.file);
    expect(data.length).toBe(lod.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(lod.sha256);
    let tris = 0;
    for (const m of json.meshes as Json[]) for (const p of m.primitives as Json[]) tris += json.accessors[p.indices].count / 3;
    expect(tris).toBe(lod.triangles);
    expect(lod.budget).toBe(Math.floor(expected[id]![0] * 0.45));
    expect(tris).toBeLessThanOrEqual(lod.budget);
    expect(tris).toBeLessThan(entry.triangles);
    expect(tris).toBeGreaterThan(20);
    expect(json.images ?? []).toHaveLength(0);
    // the silhouette holds: world bounds from the file's own accessors, within 8 cm of LOD0 (the finials are dropped)
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const node of json.nodes as Json[]) {
      if (node.mesh === undefined) continue;
      const t = (node.translation as number[] | undefined) ?? [0, 0, 0];
      for (const p of json.meshes[node.mesh].primitives as Json[]) {
        const a = json.accessors[p.attributes.POSITION];
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i]!, a.min[i] + t[i]!);
          hi[i] = Math.max(hi[i]!, a.max[i] + t[i]!);
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(lo[i]! - entry.bounds.min[i]), `${id} min ${i}`).toBeLessThanOrEqual(0.08);
      expect(Math.abs(hi[i]! - entry.bounds.max[i]), `${id} max ${i}`).toBeLessThanOrEqual(0.08);
    }
  });

  it('parking, project and curb pieces have no far level of detail', () => {
    for (const id of [...Object.keys(PARKING), ...Object.keys(PROJECT), ...Object.keys(CURB), ...Object.keys(FENCE)]) expect(manifest.models[id].lod1, id).toBeUndefined();
  });

  it.each(qb.filter((id) => /stairs|ramp/.test(id)))('%s keeps its rails 2.5 cm inside the tile edge on each side', (id) => {
    // two pieces side by side then have a 5 cm gap between their rails instead of touching
    const { min, max } = (manifest.models[id] as Json).bounds as { min: number[]; max: number[] };
    const w = expected[id]![1];
    expect(max[0]!).toBeLessThanOrEqual(w / 2 - 0.025);
    expect(min[0]!).toBeGreaterThanOrEqual(-w / 2 + 0.025);
    expect(max[0]!).toBeGreaterThan(w / 2 - 0.08);                              // and still at the edge, not mid-tread
  });
});

describe('curb-appeal sets (W-049)', () => {
  it('three bands of four pieces, each set within 1,200 triangles', () => {
    for (const band of [1, 2, 3]) {
      const ids = Object.keys(CURB).filter((id) => CURB[id]![3] === band);
      expect(ids).toHaveLength(4);
      let total = 0;
      for (const id of ids) {
        const e = manifest.models[id] as Json;
        expect(e.kind).toBe('curb');
        expect(e.band).toBe(band);
        total += e.triangles as number;
      }
      expect(total, `band ${band}`).toBeLessThanOrEqual(1200);
      expect(total, `band ${band}`).toBeGreaterThan(400);
    }
  });

  it('the pieces the lead listed are all there, by band', () => {
    const byBand = (b: number): string[] => Object.keys(CURB).filter((id) => CURB[id]![3] === b).sort();
    expect(byBand(1)).toEqual(['curb_fence_picket', 'curb_flowerbed', 'curb_gnome_skull', 'curb_mailbox']);
    expect(byBand(2)).toEqual(['curb_bench', 'curb_bike_rack', 'curb_planter', 'curb_porch_light']);
    expect(byBand(3)).toEqual(['curb_fountain', 'curb_gate_iron', 'curb_lamp_post', 'curb_topiary']);
  });

  it('lights glow, the fountain has water, the bench seats two, the mailbox can be used', () => {
    for (const id of ['curb_porch_light', 'curb_lamp_post']) {
      const { json } = readGlb(manifest.models[id].file);
      const glow = (json.nodes as Json[]).find((n) => n.name === 'glow')!;
      expect(glow, id).toBeDefined();
      const mats = (json.meshes[glow.mesh].primitives as Json[]).map((p) => json.materials[p.material] as Json);
      expect(Math.max(...mats.map((m) => Math.max(...((m.emissiveFactor as number[]) ?? [0])))), id).toBeGreaterThan(0);
    }
    expect((readGlb(manifest.models.curb_fountain.file).json.nodes as Json[]).map((n) => n.name)).toContain('water');
    const bench = manifest.models.curb_bench.frames as Record<string, { pos: number[]; kind: string }>;
    expect(Object.keys(bench).sort()).toEqual(['seat_0', 'seat_1']);
    for (const f of Object.values(bench)) {
      expect(f.kind).toBe('seat');
      expect(f.pos[1]).toBeGreaterThan(0.4);
      expect(f.pos[1]).toBeLessThan(0.55);
    }
    expect(bench.seat_0!.pos[0]).toBeLessThan(0);
    expect(bench.seat_1!.pos[0]).toBeGreaterThan(0);
    const use = manifest.models.curb_mailbox.frames.use as { pos: number[]; yaw: number; kind: string };
    expect(use.kind).toBe('approach');
    expect(use.pos[1]).toBe(0);
    expect(use.pos[2]).toBeGreaterThan(0.5);                       // in front of it
    expect(use.yaw).toBe(180);
    expect(manifest.models.curb_lamp_post.bounds.max[1]).toBeGreaterThan(3);      // a street lamp, taller than a zombie
    expect(manifest.models.curb_porch_light.bounds.max[1]).toBeLessThan(1.8);     // a porch light, at hand height
  });
});

describe('yard fences and gates (W-109)', () => {
  it('no id in this kit is also an id in another kit (a gate was first named like the L2 gate_iron)', () => {
    const other = new Set<string>();
    // every other kit's manifest that is on this branch (the level kits land in separate PRs); L2 must be there
    const names = ['objects', 'levels', 'rotrow', 'bayou', 'mausoleum'].filter((n) => existsSync(join(ASSETS, `manifest.${n}.json`)));
    expect(names).toContain('levels');
    for (const name of names) {
      const m = JSON.parse(readFileSync(join(ASSETS, `manifest.${name}.json`), 'utf8')) as Json;
      const ids = m.objects ? Object.keys(m.objects) : (m.models as Json[]).map((e) => e.id as string);
      ids.forEach((i) => other.add(i));
    }
    expect(other.has('gate_iron')).toBe(true);                         // the L2 gate this kit must not shadow
    expect(Object.keys(manifest.models).filter((id) => other.has(id))).toEqual([]);
  });

  it.each(FENCE_STYLES)('%s: a run, a post and a gate, all at or under 1.2 m', (st) => {
    for (const id of [`fence_${st}_run`, `fence_${st}_post`, `fence_${st}_gate`]) {
      const e = manifest.models[id] as Json;
      expect(e.style, id).toBe(st);
      expect(e.bounds.max[1], id).toBeLessThanOrEqual(1.2);        // low, so the yard stays visible
      expect(e.bounds.max[1], id).toBeGreaterThan(0.6);
    }
    expect(manifest.models[`fence_${st}_run`].kind).toBe('fence');
    expect(manifest.models[`fence_${st}_post`].kind).toBe('fencePost');
    expect(manifest.models[`fence_${st}_gate`].kind).toBe('gate');
  });

  it.each(FENCE_STYLES)('%s run fills its tile edge exactly, so runs meet with no gap and no overlap', (st) => {
    const { min, max } = manifest.models[`fence_${st}_run`].bounds as { min: number[]; max: number[] };
    expect(max[0]!).toBeGreaterThanOrEqual(0.47);
    expect(max[0]!).toBeLessThanOrEqual(0.5005);
    expect(min[0]!).toBeLessThanOrEqual(-0.47);
    expect(min[0]!).toBeGreaterThanOrEqual(-0.5005);
    expect(Math.max(-min[2]!, max[2]!)).toBeLessThanOrEqual(0.25);  // on the edge, not into the tile
  });

  it.each(FENCE_STYLES)('%s gate has a leaf hinged at one edge, wide enough to walk through, and a frame on each side', (st) => {
    const e = manifest.models[`fence_${st}_gate`] as Json;
    const { json } = readGlb(e.file);
    const door = (json.nodes as Json[]).find((n) => n.name === 'door')!;
    expect(door).toBeDefined();
    expect(door.extras?.part).toBe('door');
    expect(e.door.node).toBe('door');
    expect(e.door.hinge).toEqual(door.translation.map((v: number) => Math.round(v * 1e4) / 1e4));
    // the leaf's own extent, from its accessors (local to the hinge)
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of json.meshes[door.mesh].primitives as Json[]) {
      lo = Math.min(lo, json.accessors[p.attributes.POSITION].min[0]);
      hi = Math.max(hi, json.accessors[p.attributes.POSITION].max[0]);
    }
    expect(Math.min(Math.abs(lo), Math.abs(hi))).toBeLessThan(0.08);   // the hinge line is at one edge of the leaf
    expect(hi - lo).toBeGreaterThanOrEqual(0.6);                       // wide enough for a zombie
    expect(hi - lo).toBeLessThanOrEqual(0.9);                          // and inside the two posts
    const f = e.frames as Record<string, { pos: number[]; yaw: number; kind: string }>;
    expect(Object.keys(f).sort()).toEqual(['back', 'front']);
    expect(f.front!.pos[2]!).toBeGreaterThan(0.5);
    expect(f.front!.yaw).toBe(180);
    expect(f.back!.pos[2]!).toBeLessThan(-0.5);
    expect(f.back!.yaw).toBe(0);
    for (const fr of Object.values(f)) expect(fr.kind).toBe('approach');
  });

  it('the picket run reuses the curb-appeal picket (same picket and rail sizes), not a second design', () => {
    const run = manifest.models.fence_picket_run as Json;
    const curb = manifest.models.curb_fence_picket as Json;
    expect(run.materials).toContain('Trim');
    expect(curb.materials).toContain('Trim');
    expect(run.bounds.max[1]).toBeCloseTo(0.87, 2);                    // both top out at the same picket tip
    expect(curb.bounds.max[1]).toBeGreaterThan(0.87);                  // the curb piece also has its own post
  });
});
