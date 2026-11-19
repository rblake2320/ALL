/**
 * Wildlife GLBs (tools/blender/wildlife/build_wildlife.py) against public/assets/manifest.wildlife.json and
 * docs/systems/wildlife.md: the five animals, the clips listed per animal, <= 1,500 triangles at LOD0 and <= 500 at
 * LOD1, one skeleton per file, glTF Y-up with the feet on y = 0 and the nose toward +Z, flat colours only.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
// docs/systems/wildlife.md, "Clips" column
const CLIPS: Record<string, string[]> = {
  songbird: ['fly', 'glide', 'land', 'perch-idle', 'hop', 'peck', 'takeoff'],
  pigeon: ['walk', 'peck', 'takeoff', 'fly'],
  squirrel: ['run', 'freeze', 'climb', 'idle-tail', 'chitter'],
  bat: ['fly', 'flap-hover'],
  frog: ['hop', 'idle'],
};
const ONE_SHOT = ['land', 'takeoff'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.wildlife.json'), 'utf8')) as Json;

function readGlb(file: string): { json: Json; data: Buffer } {
  const data = readFileSync(join(ASSETS, file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  return { json: JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) as Json, data };
}

describe('wildlife manifest', () => {
  it('lists exactly the five animals with the budgets of the spec', () => {
    expect(Object.keys(manifest.species).sort()).toEqual(Object.keys(CLIPS).sort());
    expect(manifest.budget).toEqual({ lod0: 1500, lod1: 500 });
    expect(manifest.lods).toEqual({ lod0: 'Wild_lod0', lod1: 'Wild_lod1' });
    expect(manifest.front).toBe('+Z');
    expect(manifest.recolour).toBe('Paint');
  });

  it('the songbird has two colour variants', () => {
    expect(Object.keys(manifest.species.songbird.paints)).toHaveLength(2);
    for (const hex of Object.values(manifest.species.songbird.paints)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe.each(Object.keys(CLIPS))('wildlife %s', (id) => {
  const entry = manifest.species[id] as Json;
  const { json, data } = readGlb(entry.file);

  it('file matches the manifest', () => {
    expect(entry.file).toBe(`models/wildlife/${id}.glb`);
    expect(data.length).toBe(entry.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
  });

  it('has two skinned levels of detail on one skeleton, inside the budgets', () => {
    const meshNodes = (json.nodes as Json[]).filter((n) => n.mesh !== undefined);
    expect(meshNodes.map((n) => n.name).sort()).toEqual(['Wild_lod0', 'Wild_lod1']);
    expect(json.skins).toHaveLength(1);
    const tris: Record<string, number> = {};
    for (const n of meshNodes) {
      expect(n.skin).toBe(0);
      tris[n.name as string] = (json.meshes[n.mesh].primitives as Json[]).reduce((a, p) => a + json.accessors[p.indices].count / 3, 0);
    }
    expect(tris).toEqual(entry.triangles);
    expect(tris.Wild_lod0!).toBeLessThanOrEqual(1500);
    expect(tris.Wild_lod0!).toBeGreaterThan(600);
    expect(tris.Wild_lod1!).toBeLessThanOrEqual(500);
    expect(tris.Wild_lod1!).toBeGreaterThan(150);
  });

  it('has exactly the clips of the spec, looping except the one-shots, keyed for every bone', () => {
    const anims = json.animations as Json[];
    expect(anims.map((a) => a.name).sort()).toEqual([...CLIPS[id]!].sort());
    expect((entry.clips as Json[]).map((c) => c.name)).toEqual(CLIPS[id]);
    const joints = (json.skins[0].joints as number[]).map((j) => json.nodes[j].name as string);
    for (const c of entry.clips as Json[]) {
      expect(c.loop).toBe(!ONE_SHOT.includes(c.name));
      const a = anims.find((x) => x.name === c.name)!;
      const dur = Math.max(...(a.samplers as Json[]).map((s) => json.accessors[s.input].max[0] as number));
      expect(dur).toBeCloseTo(c.duration as number, 3);
      const rotated = new Set((a.channels as Json[]).filter((ch) => ch.target.path === 'rotation').map((ch) => json.nodes[ch.target.node].name));
      for (const j of joints) expect(rotated.has(j)).toBe(true);
    }
  });

  it('stands on y = 0, is small, and uses flat named materials only', () => {
    const { min, max } = entry.bounds as { min: number[]; max: number[] };
    expect(min[1]!).toBeGreaterThanOrEqual(-0.004);
    expect(min[1]!).toBeLessThanOrEqual(0.004);
    expect(max[1]! - min[1]!).toBeLessThan(0.35);
    expect(max[2]! - min[2]!).toBeLessThan(0.45);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
    expect((json.materials as Json[]).map((m) => m.name)).toContain('Paint');
  });

  it('ships a one-part convex floor outline that contains the rest-pose bounds on the floor plane', () => {
    expect(entry.outline).toHaveLength(1);
    const poly = (entry.outline as number[][][])[0]!;
    expect(poly.length).toBeGreaterThanOrEqual(4);
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i]!;
      const [x1, z1] = poly[(i + 1) % poly.length]!;
      const [x2, z2] = poly[(i + 2) % poly.length]!;
      area += x0! * z1! - x1! * z0!;
      expect((x1! - x0!) * (z2! - z1!) - (z1! - z0!) * (x2! - x1!)).toBeGreaterThan(0); // convex, counter-clockwise
    }
    expect(area).toBeGreaterThan(0);
    const xs = poly.map((p) => p[0]!);
    const zs = poly.map((p) => p[1]!);
    // the hull is of LOD0; LOD1 may differ by a few millimetres
    expect(Math.min(...xs)).toBeLessThanOrEqual((entry.bounds.min[0] as number) + 0.01);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual((entry.bounds.max[0] as number) - 0.01);
    expect(Math.min(...zs)).toBeLessThanOrEqual((entry.bounds.min[2] as number) + 0.01);
    expect(Math.max(...zs)).toBeGreaterThanOrEqual((entry.bounds.max[2] as number) - 0.01);
  });

  it('never sinks into the floor in a ground clip (measured at build time)', () => {
    for (const mm of Object.values(entry.groundClearanceMm as Record<string, number>)) expect(mm).toBeGreaterThanOrEqual(-4);
  });
});
