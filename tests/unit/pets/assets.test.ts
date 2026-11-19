/**
 * Pet GLBs (tools/blender/pets/build_pets.py) against public/assets/manifest.pets.json and the Task E contract:
 * one skeleton, two skinned meshes (Pet_normal, Pet_undead) of at most 3,000 triangles each, nine looping clips,
 * glTF Y-up with the feet on y = 0 and the nose toward +Z, flat colours only (no images).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = join(__dirname, '..', '..', '..', 'public', 'assets');
const CLIPS = ['idle', 'walk', 'run', 'sit', 'sleep', 'eat', 'play', 'beg', 'flee'];
const SPECIES = ['cat', 'dog', 'raccoon', 'crow'];

interface Entry {
  file: string;
  bytes: number;
  sha256: string;
  plan: string;
  triangles: Record<string, number>;
  bones: string[];
  materials: string[];
  groundClearanceMm: Record<string, number>;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.pets.json'), 'utf8')) as Json;

function readGlb(file: string): { json: Json; data: Buffer } {
  const data = readFileSync(join(ASSETS, file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  const len = data.readUInt32LE(12);
  expect(data.readUInt32LE(16)).toBe(0x4e4f534a);
  return { json: JSON.parse(data.subarray(20, 20 + len).toString('utf8')) as Json, data };
}

/** World translation of every node (rest pose), following parent links. */
function worldPositions(json: Json): Map<string, number[]> {
  const parent = new Map<number, number>();
  json.nodes.forEach((n: Json, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
  const quat = (v: number[], q: number[]): number[] => {
    const [x, y, z] = v;
    const [qx, qy, qz, qw] = q;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
  };
  const out = new Map<string, number[]>();
  json.nodes.forEach((n: Json, i: number) => {
    const chain: number[] = [];
    for (let k: number | undefined = i; k !== undefined; k = parent.get(k)) chain.push(k);
    let p = [0, 0, 0];
    for (const k of chain) {
      const node = json.nodes[k] as Json;
      const s = node.scale ?? [1, 1, 1];
      p = quat([p[0]! * s[0], p[1]! * s[1], p[2]! * s[2]], node.rotation ?? [0, 0, 0, 1]);
      const t = node.translation ?? [0, 0, 0];
      p = [p[0]! + t[0], p[1]! + t[1], p[2]! + t[2]];
    }
    out.set(n.name as string, p);
  });
  return out;
}

describe('pets manifest', () => {
  it('lists exactly the four species and the nine clips, all looping at 30 fps', () => {
    expect(Object.keys(manifest.species).sort()).toEqual([...SPECIES].sort());
    expect(manifest.clips.map((c: Json) => c.name)).toEqual(CLIPS);
    expect(manifest.clips.every((c: Json) => c.loop === true && c.duration > 0)).toBe(true);
    expect(manifest.fps).toBe(30);
    expect(manifest.variants).toEqual({ normal: 'Pet_normal', undead: 'Pet_undead' });
    expect(manifest.recolour).toBe('Paint');
  });
});

describe.each(SPECIES)('pet %s', (species) => {
  const entry = manifest.species[species] as Entry;
  const { json, data } = readGlb(entry.file);

  it('file matches the manifest (path, size, SHA-256)', () => {
    expect(entry.file).toBe(`models/pets/${species}.glb`);
    expect(data.length).toBe(entry.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
  });

  it('has two skinned meshes on one skeleton, each within the triangle budget', () => {
    const meshNodes = (json.nodes as Json[]).filter((n) => n.mesh !== undefined);
    expect(meshNodes.map((n) => n.name).sort()).toEqual(['Pet_normal', 'Pet_undead']);
    expect(json.skins).toHaveLength(1);
    for (const n of meshNodes) {
      expect(n.skin).toBe(0);
      const prims = json.meshes[n.mesh].primitives as Json[];
      const tris = prims.reduce((a, p) => a + json.accessors[p.indices].count / 3, 0);
      expect(tris).toBe(entry.triangles[n.name as string]);
      expect(tris).toBeLessThanOrEqual(3000);
      expect(tris).toBeGreaterThan(800); // not a placeholder
      for (const p of prims) {
        expect(Object.keys(p.attributes)).toEqual(expect.arrayContaining(['POSITION', 'NORMAL', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']));
        expect(p.attributes.TEXCOORD_0).toBeUndefined();
      }
    }
  });

  it('stands on y = 0, is Y-up and faces +Z', () => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of (json.nodes as Json[]).filter((x) => x.mesh !== undefined)) {
      for (const p of json.meshes[n.mesh].primitives as Json[]) {
        const acc = json.accessors[p.attributes.POSITION];
        minY = Math.min(minY, acc.min[1]);
        maxY = Math.max(maxY, acc.max[1]);
      }
    }
    expect(minY).toBeGreaterThanOrEqual(-0.002);
    expect(minY).toBeLessThanOrEqual(0.003);
    expect(maxY).toBeGreaterThan(0.15);
    expect(maxY).toBeLessThan(0.7);
    const pos = worldPositions(json);
    const head = pos.get('head')!;
    const hips = pos.get('hips')!;
    expect(head[2]!).toBeGreaterThan(hips[2]! + 0.03); // nose end is toward +Z
    expect(head[1]!).toBeGreaterThan(0.05);
    expect(Math.abs(head[0]!)).toBeLessThan(1e-4); // symmetric about x = 0
  });

  it('has exactly the nine clips with the manifest durations, keyed for every bone', () => {
    const anims = json.animations as Json[];
    expect(anims.map((a) => a.name).sort()).toEqual([...CLIPS].sort());
    const joints = (json.skins[0].joints as number[]).map((j) => json.nodes[j].name as string);
    expect(joints.sort()).toEqual([...entry.bones].sort());
    for (const a of anims) {
      const want = (manifest.clips as Json[]).find((c) => c.name === a.name)!.duration as number;
      const dur = Math.max(...(a.samplers as Json[]).map((s) => json.accessors[s.input].max[0] as number));
      expect(dur).toBeCloseTo(want, 3);
      const rotated = new Set((a.channels as Json[]).filter((c) => c.target.path === 'rotation').map((c) => json.nodes[c.target.node].name));
      for (const j of joints) expect(rotated.has(j)).toBe(true);
    }
  });

  it('uses flat named materials only: no images, a recolourable Paint, glowing mismatched undead eyes', () => {
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
    const names = (json.materials as Json[]).map((m) => m.name as string).sort();
    expect(names).toEqual([...entry.materials].sort());
    expect(names).toEqual(expect.arrayContaining(['Paint', 'Stitch', 'EyeGlowA', 'EyeGlowB']));
    for (const g of ['EyeGlowA', 'EyeGlowB']) {
      const m = (json.materials as Json[]).find((x) => x.name === g)!;
      expect(Math.max(...(m.emissiveFactor as number[]))).toBeGreaterThan(0.2);
    }
    const mat = (node: string): string[] =>
      (json.meshes[(json.nodes as Json[]).find((n) => n.name === node)!.mesh].primitives as Json[]).map((p) => json.materials[p.material].name as string);
    expect(mat('Pet_normal')).not.toEqual(expect.arrayContaining(['Stitch']));
    expect(mat('Pet_normal')).toEqual(expect.arrayContaining(['Paint', 'Eye']));
    expect(mat('Pet_undead')).toEqual(expect.arrayContaining(['Paint', 'Stitch', 'EyeGlowA', 'EyeGlowB']));
  });

  it('never sinks more than 6 mm into the floor in any clip (measured at build time)', () => {
    for (const c of CLIPS) expect(entry.groundClearanceMm[c]).toBeGreaterThanOrEqual(-6);
  });
});
