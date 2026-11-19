/**
 * Vehicle GLBs (tools/blender/vehicles/build_vehicles.py) against public/assets/manifest.vehicles.json and the
 * art contract in docs/systems/vehicles.md §2 and §11: triangle budgets per level of detail, wheel nodes on the
 * axle, lights in `glow`, a `door` node on cars, a recolourable `Paint`, glTF Y-up with the front toward +Z, wheels
 * on y = 0, and a footprint that fits the vehicle's parking size.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
// docs/systems/vehicles.md §2: id -> [LOD0 budget, LOD1 budget, parking size]
const SPEC: Record<string, [number, number, 'small' | 'car']> = {
  veh_bike: [1500, 600, 'small'],
  veh_moped: [3000, 1200, 'small'],
  veh_sedan: [6000, 2400, 'car'],
  veh_hearse: [6000, 2400, 'car'],
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.vehicles.json'), 'utf8')) as Json;

function readGlb(file: string): { json: Json; data: Buffer } {
  const data = readFileSync(join(ASSETS, file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  const len = data.readUInt32LE(12);
  return { json: JSON.parse(data.subarray(20, 20 + len).toString('utf8')) as Json, data };
}

/** World translation per node name (the vehicle hierarchies carry translations only). */
function worldPositions(json: Json): Map<string, number[]> {
  const parent = new Map<number, number>();
  (json.nodes as Json[]).forEach((n, i) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
  const out = new Map<string, number[]>();
  (json.nodes as Json[]).forEach((n, i) => {
    const p = [0, 0, 0];
    for (let k: number | undefined = i; k !== undefined; k = parent.get(k)) {
      const node = json.nodes[k] as Json;
      expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
      const t = node.translation ?? [0, 0, 0];
      p[0]! += t[0];
      p[1]! += t[1];
      p[2]! += t[2];
    }
    out.set(n.name as string, p);
  });
  return out;
}

function triangles(json: Json): number {
  let n = 0;
  for (const m of json.meshes as Json[]) for (const p of m.primitives as Json[]) n += json.accessors[p.indices].count / 3;
  return n;
}

describe('vehicles manifest', () => {
  it('lists exactly the four vehicles of the catalogue with axes and node names', () => {
    expect(Object.keys(manifest.vehicles).sort()).toEqual(Object.keys(SPEC).sort());
    expect(manifest.front).toBe('+Z');
    expect(manifest.up).toBe('+Y');
    expect(manifest.left).toBe('+X');
    expect(manifest.recolour).toBe('Paint');
  });
});

describe.each(Object.keys(SPEC))('vehicle %s', (id) => {
  const entry = manifest.vehicles[id] as Json;
  const [b0, b1, park] = SPEC[id]!;
  const car = park === 'car';
  const wheels = car ? ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] : ['wheel_F', 'wheel_R'];

  it('has two levels of detail whose files match the manifest and stay inside the budgets', () => {
    expect(entry.lods).toHaveLength(2);
    expect(entry.park).toBe(park);
    (entry.lods as Json[]).forEach((lod, i) => {
      expect(lod.file).toBe(`models/vehicles/${id}${i === 0 ? '' : '_lod1'}.glb`);
      const { json, data } = readGlb(lod.file);
      expect(data.length).toBe(lod.bytes);
      expect(createHash('sha256').update(data).digest('hex')).toBe(lod.sha256);
      const tris = triangles(json);
      expect(tris).toBe(lod.triangles);
      expect(tris).toBeLessThanOrEqual(i === 0 ? b0 : b1);
      expect(tris).toBeGreaterThan((i === 0 ? b0 : b1) / 4); // not a placeholder
      expect(json.images ?? []).toHaveLength(0);
      expect(json.textures ?? []).toHaveLength(0);
      expect(json.animations ?? []).toHaveLength(0);
    });
    expect(entry.lods[1].triangles).toBeLessThan(entry.lods[0].triangles * 0.6);
  });

  it.each([0, 1])('LOD%i: wheels sit on their axles on the floor, front toward +Z, left toward +X', (i) => {
    const { json } = readGlb(entry.lods[i].file);
    const pos = worldPositions(json);
    const names = (json.nodes as Json[]).map((n) => n.name as string);
    for (const w of wheels) {
      expect(names).toContain(w);
      const p = pos.get(w)!;
      expect(p[1]!).toBeCloseTo(entry.wheelRadius as number, 3);
      expect(p[2]! > 0).toBe(w.split('_')[1]!.startsWith('F'));
      if (car) expect(p[0]! > 0).toBe(w.endsWith('L'));
      else expect(Math.abs(p[0]!)).toBeLessThan(1e-4);
      const node = (json.nodes as Json[]).find((n) => n.name === w)!;
      expect(node.extras?.part).toBe('wheel');
      // the wheel's own mesh reaches the floor: lowest point = axle height - radius
      let minY = Infinity;
      for (const prim of json.meshes[node.mesh].primitives as Json[]) minY = Math.min(minY, json.accessors[prim.attributes.POSITION].min[1]);
      expect(p[1]! + minY).toBeGreaterThanOrEqual(-0.004);
      expect(p[1]! + minY).toBeLessThanOrEqual(0.004);
    }
    expect(names.filter((n) => n.startsWith('wheel_')).sort()).toEqual([...wheels].sort());
    expect(names).toContain('glow');
    expect(names.includes('door')).toBe(car);
    if (car) expect(pos.get('door')![0]!).toBeGreaterThan(0.5);
  });

  it('is recolourable and fits its parking size', () => {
    const { json } = readGlb(entry.lods[0].file);
    const mats = (json.materials as Json[]).map((m) => m.name as string);
    expect(mats).toContain('Paint');
    expect(mats).toContain('Tire');
    const glowMats = (json.meshes[(json.nodes as Json[]).find((n) => n.name === 'glow')!.mesh].primitives as Json[]).map(
      (p) => json.materials[p.material] as Json,
    );
    expect(glowMats.some((m) => Math.max(...((m.emissiveFactor as number[] | undefined) ?? [0])) > 0)).toBe(true);
    const { width, length, height } = entry.size as { width: number; length: number; height: number };
    // a car spot is 2 x 5 tiles; a small vehicle takes half of one (docs/systems/vehicles.md §5)
    expect(width).toBeLessThanOrEqual(car ? 2.0 : 1.0);
    expect(length).toBeLessThanOrEqual(car ? 5.0 : 2.0);
    expect(height).toBeGreaterThan(0.9);
    expect(height).toBeLessThan(2.0);
    expect(entry.lods[0].bounds.min[1]).toBeGreaterThanOrEqual(-0.004);
    expect(entry.lods[0].bounds.min[1]).toBeLessThanOrEqual(0.004);
  });
});
