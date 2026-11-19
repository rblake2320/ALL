/**
 * Creature GLBs (tools/blender/creatures/build_creatures.py) against public/assets/manifest.creatures.json and
 * docs/levels/L4-bayou.md §6: Old Toothless the undead alligator, his six clips, the creature contract's `quad`
 * skeleton, two levels of detail inside their budgets, glTF Y-up with the feet on y = 0 and the nose toward +Z,
 * flat colours only, and D-043 placement data (floor outline and contact frames).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const DOC = readFileSync(join(ROOT, 'docs', 'levels', 'L4-bayou.md'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.creatures.json'), 'utf8')) as Json;
const gator = manifest.creatures.gator_toothless as Json;

/** Creature contract v1, `quad` plan (asset-bank SPEC.md): the bones every four-legged creature must have. */
const QUAD = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'tail_1', 'tail_2', 'tail_3',
  'upper_F_L', 'lower_F_L', 'paw_F_L', 'upper_F_R', 'lower_F_R', 'paw_F_R',
  'upper_H_L', 'lower_H_L', 'paw_H_L', 'upper_H_R', 'lower_H_R', 'paw_H_R'];
const CLIPS = ['idle', 'swim', 'sun', 'yawn', 'roll', 'wag'];
const ONE_SHOT = ['yawn', 'roll'];

function readGlb(file: string): { json: Json; data: Buffer } {
  const data = readFileSync(join(ASSETS, file));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  return { json: JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) as Json, data };
}
const { json, data } = readGlb(gator.file);

describe('creatures manifest', () => {
  it('lists Old Toothless and nothing else, and every model file is listed', () => {
    expect(Object.keys(manifest.creatures)).toEqual(['gator_toothless']);
    expect(readdirSync(join(ASSETS, 'models', 'creatures'))).toEqual(['gator_toothless.glb']);
    expect(manifest.lods).toEqual({ lod0: 'Creature_lod0', lod1: 'Creature_lod1' });
    expect(manifest.front).toBe('+Z');
    expect(manifest.recolour).toBe('Paint');
  });

  it('the design doc asks for this model, about 6,000 triangles and six clips', () => {
    const line = DOC.slice(DOC.indexOf('- **Old Toothless**, the undead alligator'));
    expect(line.slice(0, 200)).toContain('`gator_toothless`');
    expect(line.slice(0, 200)).toContain('~6,000 tris');
    expect(line.slice(0, 200)).toContain('6 clips');
    expect(gator.budget).toEqual({ lod0: 6000, lod1: 2000 });
    expect(gator.look).toBe('undead');
  });
});

describe('gator_toothless.glb', () => {
  it('matches the manifest: bytes, hash, triangles', () => {
    expect(data.length).toBe(gator.bytes);
    expect(createHash('sha256').update(data).digest('hex')).toBe(gator.sha256);
    const tris: Record<string, number> = {};
    for (const node of json.nodes as Json[]) {
      if (node.mesh === undefined) continue;
      tris[node.name] = (json.meshes[node.mesh].primitives as Json[])
        .reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
    }
    expect(tris).toEqual(gator.triangles);
    expect(tris.Creature_lod0).toBeLessThanOrEqual(6000);
    expect(tris.Creature_lod0).toBeGreaterThan(3000);            // a real model, not a placeholder
    expect(tris.Creature_lod1).toBeLessThanOrEqual(2000);
    expect(tris.Creature_lod1).toBeLessThan(tris.Creature_lod0! / 2);
  });

  it('has one skeleton with every bone of the quad plan, driving both levels of detail', () => {
    expect(json.skins).toHaveLength(1);
    const joints = (json.skins[0].joints as number[]).map((i) => json.nodes[i].name as string);
    for (const bone of QUAD.filter((b) => b !== 'root')) expect(joints, bone).toContain(bone);
    expect(joints).toEqual(gator.bones);
    const skinned = (json.nodes as Json[]).filter((n) => n.mesh !== undefined);
    expect(skinned.map((n) => n.name).sort()).toEqual(['Creature_lod0', 'Creature_lod1']);
    for (const n of skinned) expect(n.skin).toBe(0);
  });

  it('carries exactly the six clips at the manifest durations; yawn and roll are one-shots', () => {
    const anims = json.animations as Json[];
    expect(anims.map((a) => a.name).sort()).toEqual([...CLIPS].sort());
    expect((gator.clips as Json[]).map((c) => c.name)).toEqual(CLIPS);
    for (const c of gator.clips as Json[]) {
      expect(c.loop).toBe(!ONE_SHOT.includes(c.name));
      const a = anims.find((x) => x.name === c.name)!;
      const end = Math.max(...(a.samplers as Json[]).map((s) => json.accessors[s.input].max[0] as number));
      expect(end).toBeCloseTo(c.duration, 3);
    }
  });

  it('is alligator-sized, stands on y = 0 and faces +Z', () => {
    const { min, max } = gator.bounds as { min: number[]; max: number[] };
    expect(min[1]).toBeGreaterThanOrEqual(-0.004);
    expect(min[1]).toBeLessThanOrEqual(0.004);
    expect(gator.sizeM.length).toBeGreaterThan(2.4);
    expect(gator.sizeM.length).toBeLessThan(3.4);
    expect(gator.sizeM.height).toBeLessThan(0.5);                 // low to the ground
    expect(max[2]!).toBeGreaterThan(1.0);                         // the snout reaches forward...
    expect(-min[2]!).toBeGreaterThan(max[2]!);                    // ...and the tail is longer than the head end
    expect(Math.abs(min[0]! + max[0]!)).toBeLessThan(0.01);       // symmetric
    for (const [clip, mm] of Object.entries(gator.groundClearanceMm as Record<string, number>)) {
      expect(mm, clip).toBeGreaterThanOrEqual(-5);                // never sinks through the floor on a ground clip
    }
    expect(Object.keys(gator.groundClearanceMm).sort()).toEqual(['idle', 'sun', 'wag', 'yawn']);
  });

  it('uses flat colours only, with a recolourable Paint material and glowing undead eyes', () => {
    expect(json.images ?? []).toEqual([]);
    expect(json.textures ?? []).toEqual([]);
    const names = (json.materials as Json[]).map((m) => m.name as string);
    expect(names).toContain('Paint');
    expect(names).toContain('Skin');                              // the gums: he has no teeth
    expect(names).not.toContain('Teeth');
    const glow = (json.materials as Json[]).filter((m) => /^EyeGlow/.test(m.name));
    expect(glow).toHaveLength(2);
    for (const m of glow) expect(Math.max(...(m.emissiveFactor as number[]))).toBeGreaterThan(0);
  });
});

describe('placement data (D-043)', () => {
  it('has a one-part convex outline that covers the bounds', () => {
    expect(gator.outline).toHaveLength(1);
    const h = gator.outline[0] as number[][];
    const twice = h.reduce((t, p, i) => t + p[0]! * h[(i + 1) % h.length]![1]! - h[(i + 1) % h.length]![0]! * p[1]!, 0);
    expect(twice).toBeGreaterThan(0);
    expect(Math.min(...h.map((p) => p[1]!))).toBeCloseTo(gator.bounds.min[2], 2);
    expect(Math.max(...h.map((p) => p[1]!))).toBeCloseTo(gator.bounds.max[2], 2);
  });

  it('has frames for feeding, the chin scratch and two places to stand', () => {
    const f = gator.frames as Record<string, { pos: number[]; yaw: number; kind: string }>;
    expect(Object.keys(f).sort()).toEqual(['approach', 'approach_side', 'chin', 'feet', 'mouth']);
    const { min, max } = gator.bounds as { min: number[]; max: number[] };
    expect(f.mouth!.kind).toBe('mouth');
    expect(f.mouth!.pos[2]!).toBeGreaterThan(0.6 * max[2]!);       // at the front of the snout
    expect(f.mouth!.pos[2]!).toBeLessThanOrEqual(max[2]!);
    expect(f.chin!.kind).toBe('hands');
    expect(f.chin!.pos[1]!).toBeLessThan(f.mouth!.pos[1]!);        // under the jaw
    expect(f.chin!.pos[1]!).toBeGreaterThan(0);
    expect(f.approach!.pos).toEqual([0, 0, expect.any(Number)]);
    expect(f.approach!.pos[2]!).toBeGreaterThan(max[2]! + 0.3);    // in front of him, facing him
    expect(f.approach!.yaw).toBe(180);
    expect(f.approach_side!.pos[0]!).toBeGreaterThan(max[0]! + 0.3);
    expect(f.approach_side!.yaw).toBe(-90);
    expect(f.feet).toEqual({ pos: [0, 0, 0], yaw: 0, kind: 'feet' });
    expect(min[2]!).toBeLessThan(0);
  });
});
