/**
 * GLB structure + manifest consistency + byte / triangle budgets (finishing pass). Raw glTF JSON + BIN, no three.js:
 *  - node hierarchy: every mesh hangs off 'Rig' and is skinned to the one skin; prop bones under the hands,
 *  - skinning data is sane (4 joints, weights sum to 1, indices in range, finite positions inside the character),
 *  - animation channels: existing targets, rotation/translation only, translation on the pelvis only, monotonic
 *    30 fps times from 0, unit quaternions,
 *  - morph target names come only from the contract vocabularies,
 *  - the manifest says exactly what the GLB contains (names, durations, loop flags, triangles, bones, materials),
 *  - budgets: <= 14k triangles, <= 4 MB, animation + morph data shares (regression guards).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANIM_STATES, EXTRA_ANIM_STATES, EXTRA_ONE_SHOT_STATES } from '../../../src/shared/appearance';
import { BONE_NAMES, BUILD_MORPH, FACE_MORPHS, MATERIAL_NAMES, STITCH_HIDE_MORPHS } from '../../../src/render/characters/names';
import { MANIFEST_PATH, readGlbJson } from './helpers';

const { json, bin } = readGlbJson();
const nodes: any[] = json.nodes;
const man = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const CORE_ONE_SHOTS = ['pickup', 'collapse', 'yawn'];
// Core clips are required; extra clips (W-051) are optional but only from EXTRA_ANIM_STATES.
const EXTRA = new Set<string>(EXTRA_ANIM_STATES);
const ONE_SHOTS = new Set<string>([...CORE_ONE_SHOTS, ...EXTRA_ONE_SHOT_STATES]);
const COMPS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessorData(index: number): { values: number[]; comps: number; count: number } {
  const acc = json.accessors[index];
  const bv = json.bufferViews[acc.bufferView];
  const comps = COMPS[acc.type];
  const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n = acc.count * comps;
  const values: number[] = new Array(n);
  const stride = bv.byteStride;
  const size = { 5126: 4, 5123: 2, 5121: 1, 5125: 4 }[acc.componentType as number] as number;
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      const at = off + (stride ? i * stride : i * comps * size) + c * size;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = bin.readFloatLE(at); break;
        case 5123: v = bin.readUInt16LE(at); break;
        case 5121: v = bin.readUInt8(at); break;
        default: v = bin.readUInt32LE(at);
      }
      if (acc.normalized) v /= acc.componentType === 5121 ? 255 : 65535;
      values[i * comps + c] = v;
    }
  }
  return { values, comps, count: acc.count };
}

const nodeIndex = (name: string) => nodes.findIndex((n) => n.name === name);
const parentOf = new Map<number, number>();
nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => parentOf.set(c, i)));
const meshNodes = nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.mesh !== undefined);

describe('GLB node hierarchy', () => {
  it('every mesh node is a direct child of Rig and is skinned to the single skin', () => {
    const rig = nodeIndex('Rig');
    expect(rig).toBeGreaterThanOrEqual(0);
    expect(json.skins).toHaveLength(1);
    expect(meshNodes.length).toBe(man.meshCount);
    for (const { n, i } of meshNodes) {
      expect(parentOf.get(i), n.name).toBe(rig);
      expect(n.skin, n.name).toBe(0);
    }
  });

  it('bones form the contract hierarchy; prop bones sit under the hands', () => {
    const expectParent: Record<string, string> = {
      pelvis: 'root', spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck', jaw: 'head',
      shoulder_L: 'chest', upperarm_L: 'shoulder_L', forearm_L: 'upperarm_L', hand_L: 'forearm_L', prop_L: 'hand_L',
      shoulder_R: 'chest', upperarm_R: 'shoulder_R', forearm_R: 'upperarm_R', hand_R: 'forearm_R', prop_R: 'hand_R',
      thigh_L: 'pelvis', shin_L: 'thigh_L', foot_L: 'shin_L', thigh_R: 'pelvis', shin_R: 'thigh_R', foot_R: 'shin_R',
    };
    for (const b of BONE_NAMES) expect(nodeIndex(b), b).toBeGreaterThanOrEqual(0);
    for (const [child, parent] of Object.entries(expectParent)) {
      expect(nodes[parentOf.get(nodeIndex(child))!]?.name, child).toBe(parent);
    }
    // the skin's joints are exactly the bones the manifest lists, in order
    expect(json.skins[0].joints.map((j: number) => nodes[j].name)).toEqual(man.bones);
  });
});

describe('GLB skinning data', () => {
  it('every primitive has 4 joints + weights summing to 1, valid joint indices and sane positions', () => {
    const jointCount = json.skins[0].joints.length;
    for (const { n } of meshNodes) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const a = prim.attributes;
        expect(a.JOINTS_0, n.name).toBeDefined();
        expect(a.WEIGHTS_0, n.name).toBeDefined();
        expect(a.JOINTS_1, n.name).toBeUndefined();
        const w = accessorData(a.WEIGHTS_0);
        const j = accessorData(a.JOINTS_0);
        const p = accessorData(a.POSITION);
        expect(w.count).toBe(p.count);
        for (let v = 0; v < w.count; v++) {
          let sum = 0;
          for (let c = 0; c < 4; c++) {
            const wt = w.values[v * 4 + c];
            sum += wt;
            if (wt > 0) expect(j.values[v * 4 + c], n.name).toBeLessThan(jointCount);
          }
          expect(Math.abs(sum - 1), `${n.name} v${v}`).toBeLessThan(0.01);
          const x = p.values[v * 3];
          const y = p.values[v * 3 + 1];
          const z = p.values[v * 3 + 2];
          expect(Number.isFinite(x + y + z), n.name).toBe(true);
          expect(Math.abs(x), n.name).toBeLessThan(0.8);
          expect(y, n.name).toBeGreaterThan(-0.02);
          expect(y, n.name).toBeLessThan(1.95);
          expect(Math.abs(z), n.name).toBeLessThan(0.6);
        }
      }
    }
  });

  it('morph targets only use contract names (face, build, stitch-hide) and match the manifest', () => {
    const allowed = new Set<string>([...FACE_MORPHS, BUILD_MORPH, ...Object.values(STITCH_HIDE_MORPHS)]);
    const fromGlb: Record<string, string[]> = {};
    for (const { n } of meshNodes) {
      const names: string[] = json.meshes[n.mesh].extras?.targetNames ?? [];
      const targets = json.meshes[n.mesh].primitives[0].targets ?? [];
      expect(targets.length, n.name).toBe(names.length);
      for (const t of names) expect(allowed.has(t), `${n.name}: ${t}`).toBe(true);
      if (names.length) fromGlb[n.name] = names;
    }
    expect(fromGlb).toEqual(man.morphTargets);
  });
});

describe('GLB animation channels', () => {
  it('target existing nodes; only rotations (+ the pelvis translation) vary; 30 fps from 0; unit quaternions', () => {
    const pelvis = nodeIndex('pelvis');
    const constant = (v: { values: number[]; comps: number }) =>
      v.values.every((x, i) => Math.abs(x - v.values[i % v.comps]) < 1e-6);
    for (const a of json.animations) {
      for (const ch of a.channels) {
        const t = ch.target;
        const label = `${a.name} ${nodes[t.node]?.name} ${t.path}`;
        expect(nodes[t.node], label).toBeDefined();
        expect(['rotation', 'translation', 'scale'], label).toContain(t.path);
        const s = a.samplers[ch.sampler];
        // LINEAR samples; the exporter turns constant channels into 2-key STEP curves
        expect(['LINEAR', 'STEP'], label).toContain(s.interpolation ?? 'LINEAR');
        const times = accessorData(s.input).values;
        expect(times[0]).toBeCloseTo(0, 6);
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1], label).toBeGreaterThan(1 / 30 - 1e-4);
        const v = accessorData(s.output);
        if (t.path === 'rotation') {
          for (let i = 0; i < v.values.length; i += 4) {
            const len = Math.hypot(v.values[i], v.values[i + 1], v.values[i + 2], v.values[i + 3]);
            expect(Math.abs(len - 1), label).toBeLessThan(1e-3);
          }
        } else if (t.path === 'scale') {
          expect(constant(v), label).toBe(true); // no squash & stretch: skinned parts stay rigid
          for (const x of v.values.slice(0, 3)) expect(Math.abs(x - 1), label).toBeLessThan(1e-5);
        } else if (t.node !== pelvis) {
          expect(constant(v), `${label}: only the pelvis may move`).toBe(true);
        }
      }
    }
  });
});

describe('manifest == GLB', () => {
  const glbDurations = new Map<string, number>(json.animations.map((a: any) => [a.name,
    Math.max(...a.samplers.map((s: any) => json.accessors[s.input].max[0]))]));

  it('lists every animation (once) with the GLB duration and the right loop flag', () => {
    const names: string[] = man.animations.map((a: any) => a.name);
    for (const core of ANIM_STATES) expect(names, `core clip ${core}`).toContain(core);
    expect(names.filter((n) => !(ANIM_STATES as readonly string[]).includes(n) && !EXTRA.has(n)), 'unknown clips').toEqual([]);
    expect(new Set(names).size).toBe(names.length);
    for (const a of man.animations) {
      expect(a.duration, a.name).toBeCloseTo(glbDurations.get(a.name)!, 3);
      expect(a.loop, a.name).toBe(!ONE_SHOTS.has(a.name));
      expect(a.duration, a.name).toBeGreaterThan(0.5);
    }
    expect(man.oneShots.sort()).toEqual(names.filter((n) => ONE_SHOTS.has(n)).sort());
    expect(man.fps).toBe(30);
  });

  it('nodes, materials and triangle count are exactly the GLB contents', () => {
    expect([...man.nodes].sort()).toEqual(meshNodes.map(({ n }) => n.name).sort());
    expect([...man.materials].sort()).toEqual(json.materials.map((m: any) => m.name).filter(Boolean).sort());
    for (const m of MATERIAL_NAMES) expect(man.materials).toContain(m);
    let tris = 0;
    for (const { n } of meshNodes) {
      for (const prim of json.meshes[n.mesh].primitives) tris += json.accessors[prim.indices].count / 3;
    }
    expect(man.triangles).toBe(tris);
    expect(man.carryAnchors).toEqual(['phone', 'read', 'sitEat', 'sitRead', 'standEat']);
    expect(Object.keys(man.hairClearanceMm).length).toBeGreaterThanOrEqual(9);
    for (const v of Object.values(man.hairClearanceMm)) expect(v as number).toBeGreaterThan(0);
  });
});

describe('budgets', () => {
  const bytesOf = (accIndices: Iterable<number>) => {
    let b = 0;
    for (const i of new Set(accIndices)) {
      const acc = json.accessors[i];
      b += acc.count * COMPS[acc.type] * ({ 5126: 4, 5123: 2, 5121: 1, 5125: 4 }[acc.componentType as number] as number);
    }
    return b;
  };

  it('all variants present: <= 14,000 triangles (CONTRACTS #15) and <= 4 MB (brief)', () => {
    expect(man.triangles).toBeLessThanOrEqual(14000);
    expect(man.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it('animation data stays a bounded share of the file (45 clips at 30 fps, quaternion channels)', () => {
    const isCore = (n: string) => (ANIM_STATES as readonly string[]).includes(n);
    const anim: number[] = [];
    const extraAnim: number[] = [];
    for (const a of json.animations) for (const s of a.samplers) (isCore(a.name) ? anim : extraAnim).push(s.input, s.output);
    // Core: ~1.1 MB; a regression (doubled sampling, scale channels, extra bones) would blow past this
    expect(bytesOf(anim)).toBeLessThan(1.6 * 1024 * 1024);
    // Extras (W-051) share the same total animation budget as before: core + extras < 1.6 MiB (no loosening;
    // measured at W-051 export: core 885,028 B + extras 509,964 B)
    expect(bytesOf(anim) + bytesOf(extraAnim)).toBeLessThan(1.6 * 1024 * 1024);
    const coreSeconds = man.animations.filter((a: any) => isCore(a.name)).reduce((s: number, a: any) => s + a.duration, 0);
    expect(coreSeconds).toBeGreaterThan(100); // every core clip really is there
    expect(coreSeconds).toBeLessThan(160);
    for (const a of man.animations.filter((x: any) => !isCore(x.name))) expect(a.duration, a.name).toBeLessThan(15);
  });

  it('morph targets stay sparse-ish (face + build deltas well under the geometry itself)', () => {
    const geo: number[] = [];
    const morph: number[] = [];
    for (const { n } of meshNodes) {
      for (const prim of json.meshes[n.mesh].primitives) {
        geo.push(...Object.values(prim.attributes) as number[], prim.indices);
        for (const t of prim.targets ?? []) morph.push(...Object.values(t) as number[]);
      }
    }
    expect(bytesOf(morph)).toBeLessThan(1.2 * 1024 * 1024);
    expect(bytesOf(geo) + bytesOf(morph)).toBeLessThan(2.4 * 1024 * 1024);
  });
});
