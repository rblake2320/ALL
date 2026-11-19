/**
 * Cast manifest + GLB contract (tools/blender/cast/build_cast.py -> public/assets/manifest.cast.json): every body
 * listed exactly once in CAST_BODY_IDS order, hashes / sizes / budgets / bone set / rest orientations / heights.
 * The adversarial block feeds tampered copies through the same validator and expects it to fail.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAST_BODY_IDS } from '../../../src/shared/cast';
import {
  CAST_BONES, TOTAL_BYTES_BUDGET, ZOMBIE_GLB, accessor, packGlb, parseGlb, readBodyGlb, readManifest, restRotations,
  sha256, validateCast,
} from './helpers';

const manifest = readManifest();
const zombieRot = restRotations(parseGlb(readFileSync(ZOMBIE_GLB)));
const files = new Map<string, Buffer>();
beforeAll(() => {
  for (const b of manifest.bodies) files.set(b.file, readBodyGlb(b.file));
});
const read = (f: string): Buffer | null => files.get(f) ?? null;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('manifest.cast.json', () => {
  it('validates against the published GLBs with zero problems', () => {
    expect(validateCast(manifest, read, zombieRot)).toEqual([]);
  });

  it('lists exactly the 25 CAST_BODY_IDS in order, one file each', () => {
    expect(manifest.bodies.map((b: any) => b.id)).toEqual([...CAST_BODY_IDS]);
    expect(new Set(manifest.bodies.map((b: any) => b.file)).size).toBe(25);
    for (const b of manifest.bodies) expect(b.file).toBe(`models/characters/cast/${b.id}.glb`);
  });

  it('declares shared animations and the pelvis rule the runtime implements', () => {
    expect(manifest.animationsShared).toBe(true);
    expect(manifest.clipSource).toBe('models/characters/zombie.glb');
    expect(manifest.clipSourceSha256).toBe(sha256(readFileSync(ZOMBIE_GLB)));
    expect(manifest.bones).toEqual(CAST_BONES);
    const r = manifest.pelvisRule;
    expect(r.zombiePelvisRest[1]).toBeCloseTo(0.66, 4);
    expect(r.sitClips).toEqual(['sit', 'sitEat', 'sitTalk', 'sitTV', 'sitComputer', 'sitRead', 'sitChess']);
    expect(r.lyingY0).toBe(0.25);
    expect(r.lyingSpan).toBe(0.14);
  });

  it('stays within the total size budget and reports it truthfully', () => {
    const total = manifest.bodies.reduce((s: number, b: any) => s + b.bytes, 0);
    expect(total).toBe(manifest.totalBytes);
    expect(total).toBeLessThanOrEqual(TOTAL_BYTES_BUDGET);
  });

  it('every body entry has the documented per-body fields', () => {
    for (const b of manifest.bodies) {
      expect(b.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(b.eyeMaterial).toBeNull();
      expect(b.materials).toEqual(['Body']);
      expect(b.pelvisRest).toHaveLength(3);
      expect(b.pelvisScale).toBeGreaterThan(0.4);
      expect(b.pelvisScale).toBeLessThan(1.3);
      expect(b.seatPelvisOffset).toHaveLength(3);
      expect(Math.abs(b.seatPelvisOffset[1])).toBeLessThan(0.08);
      expect(b.lyingOffset).toHaveLength(3);
      expect(b.sitThighLift).toBeGreaterThanOrEqual(0);
      expect(b.sitThighLift).toBeLessThanOrEqual(45);
      expect(b.seatPelvisOffset[2]).toBeGreaterThanOrEqual(0);
      expect(b.seatPelvisOffset[2]).toBeLessThanOrEqual(0.15);
      expect(b.headTop).toBeCloseTo(b.height, 1);
      expect(b.thumbFace.fx).toBe(0.5);
      expect(b.thumbFace.fy).toBeGreaterThan(0.2);
      expect(b.thumbFace.fy).toBeLessThan(0.6);
      expect(b.thumbFace.size).toBeGreaterThan(80);
      expect(b.thumbFace.size).toBeLessThan(260);
      for (const k of ['forearm_L', 'forearm_R', 'shin_L', 'shin_R']) expect(['clean', 'minor']).toContain(b.limbCollapse[k]);
      expect(Object.keys(b.carryAnchors).sort()).toEqual(['phone', 'read', 'sitEat', 'sitRead', 'standEat']);
    }
  });
});

describe('adversarial: tampered builds are rejected', () => {
  it('detects a sha256 tampered in the manifest', () => {
    const m = clone(manifest);
    m.bodies[3].sha256 = '0'.repeat(64);
    expect(validateCast(m, read, zombieRot).some((s) => s.includes('sha256'))).toBe(true);
  });

  it('detects a modified GLB (one byte flipped in the BIN chunk)', () => {
    const f = manifest.bodies[0].file;
    const bad = Buffer.from(files.get(f)!);
    bad[bad.length - 100] ^= 0xff;
    const r = validateCast(manifest, (x) => (x === f ? bad : read(x)), zombieRot);
    expect(r.some((s) => s.startsWith('walker: sha256'))).toBe(true);
  });

  it('detects a missing, an extra and a reordered body', () => {
    const a = clone(manifest); a.bodies.pop();
    expect(validateCast(a, read, zombieRot).some((s) => s.includes('CAST_BODY_IDS'))).toBe(true);
    const b = clone(manifest); b.bodies.push({ ...b.bodies[0], id: 'classic' });
    expect(validateCast(b, read, zombieRot).length).toBeGreaterThan(0);
    const c = clone(manifest); [c.bodies[0], c.bodies[1]] = [c.bodies[1], c.bodies[0]];
    expect(validateCast(c, read, zombieRot).some((s) => s.includes('CAST_BODY_IDS'))).toBe(true);
  });

  it('detects a missing GLB file', () => {
    const f = manifest.bodies[5].file;
    expect(validateCast(manifest, (x) => (x === f ? null : read(x)), zombieRot)).toContain(`${manifest.bodies[5].id}: file missing`);
  });

  it('detects a rest orientation that drifted from zombie.glb (shared clips would bind wrongly)', () => {
    const f = manifest.bodies[2].file;
    const g = parseGlb(files.get(f)!);
    const j = clone(g.json);
    const node = j.nodes.find((n: any) => n.name === 'forearm_L');
    const q = node.rotation ?? [0, 0, 0, 1];
    const s = Math.sin(0.01), c = Math.cos(0.01);     // ~1.1 deg about x
    node.rotation = [q[3] * s + q[0] * c, q[1] * c + q[2] * s, q[2] * c - q[1] * s, q[3] * c - q[0] * s];
    const bad = packGlb(j, g.bin);
    const m = clone(manifest);
    m.bodies[2].sha256 = sha256(bad); m.bodies[2].bytes = bad.length;
    const r = validateCast(m, (x) => (x === f ? bad : read(x)), zombieRot);
    expect(r.some((s2) => s2.includes('forearm_L rest rotation'))).toBe(true);
  });

  it('detects a renamed bone and baked animations', () => {
    const f = manifest.bodies[1].file;
    const g = parseGlb(files.get(f)!);
    const j = clone(g.json);
    j.nodes.find((n: any) => n.name === 'pelvis').name = 'hips';
    j.animations = [{ name: 'idle', channels: [], samplers: [] }];
    const bad = packGlb(j, g.bin);
    const m = clone(manifest);
    m.bodies[1].sha256 = sha256(bad); m.bodies[1].bytes = bad.length;
    const r = validateCast(m, (x) => (x === f ? bad : read(x)), zombieRot);
    expect(r.some((s) => s.includes('bone set'))).toBe(true);
    expect(r.some((s) => s.includes('carries animations'))).toBe(true);
  });

  it('detects a body scaled off its contract height', () => {
    const f = manifest.bodies[4].file;
    const g = parseGlb(files.get(f)!);
    const j = clone(g.json);
    const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION];
    acc.max[1] *= 1.05;
    const bad = packGlb(j, g.bin);
    const m = clone(manifest);
    m.bodies[4].sha256 = sha256(bad); m.bodies[4].bytes = bad.length;
    expect(validateCast(m, (x) => (x === f ? bad : read(x)), zombieRot).some((s) => s.includes('height'))).toBe(true);
  });

  it('POSITION accessor bounds are honest (min/max match the data)', () => {
    for (const b of manifest.bodies) {
      const g = parseGlb(files.get(b.file)!);
      const prim = g.json.meshes[0].primitives[0];
      const pos = accessor(g, prim.attributes.POSITION);
      let ymax = -Infinity, ymin = Infinity;
      for (const v of pos) { ymax = Math.max(ymax, v[1]); ymin = Math.min(ymin, v[1]); }
      const acc = g.json.accessors[prim.attributes.POSITION];
      expect(ymax).toBeCloseTo(acc.max[1], 4);
      expect(ymin).toBeCloseTo(acc.min[1], 4);
    }
  });
});
