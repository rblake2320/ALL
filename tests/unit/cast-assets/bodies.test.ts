/**
 * Per-body geometry / skin / thumbnail checks on the published cast GLBs (raw parse, rest pose = bind pose).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAST_BODIES } from '../../../src/shared/cast';
import { HEM_BODIES, PROP_PIECES, THUMB_DIR, accessor, images, jointNames, parseGlb, readBodyGlb, readManifest } from './helpers';

const manifest = readManifest();
const BODY_ROWS: [string, any][] = manifest.bodies.map((b: any): [string, any] => [b.id, b]);

/** World rest position of every joint (node TRS chain). */
function jointWorld(g: { json: any }): Record<string, number[]> {
  const nodes = g.json.nodes;
  const parent = new Map<number, number>();
  nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
  const rot = (q: number[], v: number[]): number[] => {
    const [x, y, z, w] = q;
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  };
  const mul = (a: number[], b: number[]): number[] => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const world = (i: number): { p: number[]; q: number[] } => {
    const n = nodes[i];
    const t = n.translation ?? [0, 0, 0], q = n.rotation ?? [0, 0, 0, 1];
    if (!parent.has(i)) return { p: t, q };
    const pw = world(parent.get(i)!);
    const r = rot(pw.q, t);
    return { p: [pw.p[0] + r[0], pw.p[1] + r[1], pw.p[2] + r[2]], q: mul(pw.q, q) };
  };
  const out: Record<string, number[]> = {};
  for (const j of g.json.skins[0].joints) out[nodes[j].name] = world(j).p;
  return out;
}

function webpSize(buf: Buffer): [number, number] | null {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  return null;
}

describe.each(BODY_ROWS)('cast body %s', (...row: any[]) => {
  const [id, entry] = row as [string, any];
  const def = CAST_BODIES.find((d) => d.id === id)!;
  const g = parseGlb(readBodyGlb(entry.file));
  const prim = g.json.meshes[0].primitives[0];
  const pos = accessor(g, prim.attributes.POSITION);
  const J = jointWorld(g);

  it('is a single skinned mesh "Body" with one material and no animations', () => {
    expect(g.json.meshes).toHaveLength(1);
    expect(g.json.meshes[0].primitives).toHaveLength(1);
    expect(g.json.nodes.filter((n: any) => n.mesh !== undefined).map((n: any) => n.name)).toEqual(['Body']);
    expect(g.json.materials.map((m: any) => m.name)).toEqual(['Body']);
    expect(g.json.animations ?? []).toHaveLength(0);
    expect(jointNames(g)).not.toContain('jaw');
  });

  it(`stands ${def.height} m tall (+-2 cm) with feet on y=0, centred on x/z`, () => {
    let ymin = Infinity, ymax = -Infinity, xmin = Infinity, xmax = -Infinity;
    for (const v of pos) { ymin = Math.min(ymin, v[1]); ymax = Math.max(ymax, v[1]); xmin = Math.min(xmin, v[0]); xmax = Math.max(xmax, v[0]); }
    expect(Math.abs(ymax - def.height)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(ymin)).toBeLessThanOrEqual(0.005);
    expect(def.height).toBeLessThan(2.1);                     // DIM.DOOR_HEIGHT
    expect(Math.abs(J.pelvis[0])).toBeLessThan(1e-3);
    expect(Math.abs(J.pelvis[2])).toBeLessThan(1e-3);
    expect(Math.abs((xmin + xmax) / 2)).toBeLessThan(0.2);   // a prop held on one side (sceptre, lid) shifts the box
  });

  it('faces +Z: toes reach further in front of the ankles than the heels behind', () => {
    for (const s of ['L', 'R']) {
      const ankle = J[`foot_${s}`];
      const side = s === 'L' ? 1 : -1;
      const sole = pos.filter((v) => v[1] < 0.1 && side * v[0] > 0.01);
      expect(sole.length).toBeGreaterThan(3);
      const front = Math.max(...sole.map((v) => v[2])) - ankle[2];
      const back = ankle[2] - Math.min(...sole.map((v) => v[2]));
      expect(front).toBeGreaterThan(back);
    }
    // left side of the character is +X (glTF, facing +Z)
    expect(J.hand_L[0]).toBeGreaterThan(0);
    expect(J.hand_R[0]).toBeLessThan(0);
  });

  it('has a plausible skeleton: joints inside the body, pelvis at manifest pelvisRest, prop bones at the palms', () => {
    expect(J.pelvis[1]).toBeCloseTo(entry.pelvisRest[1], 3);
    expect(J.head[1]).toBeGreaterThan(J.neck[1]);
    expect(J.neck[1]).toBeGreaterThan(J.chest[1]);
    expect(J.chest[1]).toBeGreaterThan(J.spine[1]);
    expect(J.foot_L[1]).toBeLessThan(J.shin_L[1]);
    expect(J.shin_L[1]).toBeLessThan(J.thigh_L[1]);
    for (const s of ['L', 'R']) {
      const d = Math.hypot(...[0, 1, 2].map((k) => J[`prop_${s}`][k] - J[`hand_${s}`][k]));
      expect(d).toBeGreaterThan(0.02);
      expect(d).toBeLessThan(0.2);
      expect(J[`hand_${s}`][1]).toBeLessThan(J[`forearm_${s}`][1]);   // arms hang down in the rest pose
      expect(J[`forearm_${s}`][1]).toBeLessThan(J[`upperarm_${s}`][1]);
    }
  });

  it('has clean skin weights: 4 influences, normalised, only deforming joints', () => {
    const joints = accessor(g, prim.attributes.JOINTS_0);
    const weights = accessor(g, prim.attributes.WEIGHTS_0);
    const names = jointNames(g);
    // a prop bone deforms only on a body whose held prop is a loose piece (W-120); see the prop test below
    const allowed = PROP_PIECES[def.id] ?? [];
    const forbidden = new Set(['root', 'prop_L', 'prop_R'].filter((n) => !allowed.includes(n)).map((n) => names.indexOf(n)));
    expect(joints.length).toBe(pos.length);
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i];
      expect(Math.abs(w[0] + w[1] + w[2] + w[3] - 1)).toBeLessThan(0.01);
      for (let k = 0; k < 4; k++) if (w[k] > 0.001) expect(forbidden.has(joints[i][k])).toBe(false);
    }
  });

  it('held prop pieces: rigid on the prop bone, a loose piece of the mesh, and only on the bodies that have one', () => {
    const joints = accessor(g, prim.attributes.JOINTS_0);
    const weights = accessor(g, prim.attributes.WEIGHTS_0);
    const names = jointNames(g);
    const index = accessor(g, prim.indices).map((r) => r[0]!);
    for (const bone of ['prop_L', 'prop_R']) {
      const k = names.indexOf(bone);
      const onBone = new Set<number>();
      for (let i = 0; i < weights.length; i++) {
        let w = 0;
        for (let c = 0; c < 4; c++) if (joints[i]![c] === k) w += weights[i]![c]!;
        if (w > 0.001) {
          expect(w).toBeGreaterThan(0.999);                    // rigid: the whole vertex follows the prop bone
          onBone.add(i);
        }
      }
      const expected = (PROP_PIECES[def.id] ?? []).includes(bone);
      expect(onBone.size > 0, `${def.id} ${bone}`).toBe(expected);
      if (!expected) continue;
      expect(onBone.size).toBeGreaterThanOrEqual(8);
      // a closed piece: no open edge touches a prop vertex (the cut-off props were capped; the lid and phones are closed)
      // the export splits vertices at texture seams, so weld by position first (as the runtime does)
      const weld = new Map<string, number>();
      const wid = pos.map((p) => { const k = p.map((c) => Math.round(c * 1e5)).join(','); if (!weld.has(k)) weld.set(k, weld.size); return weld.get(k)!; });
      const onBoneW = new Set([...onBone].map((i) => wid[i]!));
      const edgeUse = new Map<string, number>();
      for (let t = 0; t + 2 < index.length; t += 3) {
        const tri = [wid[index[t]!]!, wid[index[t + 1]!]!, wid[index[t + 2]!]!];
        for (let k = 0; k < 3; k++) {
          const a = tri[k]!, b = tri[(k + 1) % 3]!;
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
        }
      }
      const openOnProp = [...edgeUse.entries()].filter(([key, n]) => n === 1 && key.split('-').some((v) => onBoneW.has(Number(v)))).length;
      expect(openOnProp, `${def.id} ${bone}: open edges on the prop piece`).toBe(0);
      // a loose piece: no triangle joins a prop vertex to a body vertex, so moving the bone tears nothing
      for (let t = 0; t + 2 < index.length; t += 3) {
        const n = [index[t]!, index[t + 1]!, index[t + 2]!].filter((v) => onBone.has(v)).length;
        expect(n === 0 || n === 3).toBe(true);
      }
    }
  });

  it('hem mask: `_HEMMASK` only on skirt and cape bodies, within 0..1, 1 at the low edge and 0 higher up', () => {
    const has = '_HEMMASK' in prim.attributes;
    expect(has, def.id).toBe(HEM_BODIES.includes(def.id));
    expect(Object.keys(prim.attributes).filter((a) => a.startsWith('_'))).toEqual(has ? ['_HEMMASK'] : []);
    if (!has) return;
    const acc = g.json.accessors[prim.attributes._HEMMASK];
    expect(acc.type).toBe('SCALAR');
    expect(acc.componentType).toBe(5126);                        // float
    const mask = accessor(g, prim.attributes._HEMMASK).map((r) => r[0]!);
    expect(mask.length).toBe(pos.length);
    expect(Math.min(...mask)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...mask)).toBeLessThanOrEqual(1);
    expect(Math.max(...mask)).toBeCloseTo(1, 5);
    const masked = mask.filter((m) => m > 0).length;
    expect(masked).toBeGreaterThan(100);
    expect(masked).toBeLessThan(pos.length * 0.6);                // the cloth, not the whole body
    const ys = (lo: number, hi: number) => pos.filter((_, i) => mask[i]! >= lo && mask[i]! <= hi).map((p) => p[1]!);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    // the strongly masked vertices sit lower than the weakly masked ones, and nothing above the chest is masked
    expect(mean(ys(0.8, 1))).toBeLessThan(mean(ys(0.001, 0.2)));
    expect(Math.max(...ys(0.001, 1))).toBeLessThan(def.height * 0.75);
  });

  it('textures are JPEG <= 1024 px; base colour present', () => {
    const ims = images(g);
    expect(ims.length).toBeGreaterThanOrEqual(1);
    for (const im of ims) {
      expect(im.mime).toBe('image/jpeg');
      expect(Math.max(...im.size!)).toBeLessThanOrEqual(1024);
    }
    const mat = g.json.materials[0];
    expect(mat.pbrMetallicRoughness.baseColorTexture).toBeDefined();
    expect(mat.alphaMode ?? 'OPAQUE').toBe('OPAQUE');
  });

  it('has a 256x256 WEBP thumbnail', () => {
    const f = resolve(THUMB_DIR, `${id}.webp`);
    expect(existsSync(f)).toBe(true);
    expect(webpSize(readFileSync(f))).toEqual([256, 256]);
  });
});
