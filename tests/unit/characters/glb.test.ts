/**
 * Asset contract: parses public/assets/models/characters/zombie.glb (raw GLB JSON + BIN, no three.js) and the
 * manifest, and checks names, morphs, materials, durations, loop seams, in-place motion and budgets.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANIM_STATES, EXTRA_ANIM_STATES, EXTRA_ONE_SHOT_STATES } from '../../../src/shared/appearance';
import {
  BONE_NAMES, FACE_MORPHS, MATERIAL_NAMES, STITCH_HIDE_MORPHS, requiredNodes,
} from '../../../src/render/characters/names';
import { GLB_PATH, MANIFEST_PATH, readGlbJson } from './helpers';

const { json, bin } = readGlbJson();
const nodes: any[] = json.nodes;

function floats(accIndex: number): Float32Array {
  const acc = json.accessors[accIndex];
  const bv = json.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type as string] as number;
  expect(acc.componentType).toBe(5126);
  const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n = acc.count * comps;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.readFloatLE(off + i * 4);
  return out;
}

function channel(anim: any, nodeName: string, path: string): { times: Float32Array; values: Float32Array } | null {
  const idx = nodes.findIndex((n) => n.name === nodeName);
  const ch = anim.channels.find((c: any) => c.target.node === idx && c.target.path === path);
  if (!ch) return null;
  const s = anim.samplers[ch.sampler];
  return { times: floats(s.input), values: floats(s.output) };
}

describe('zombie.glb structure', () => {
  it('is a reasonably small GLB (<= 4 MB)', () => {
    expect(statSync(GLB_PATH).size).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(json.asset.version).toBe('2.0');
  });

  it('animations: every ANIM_STATES clip, extras only from EXTRA_ANIM_STATES', () => {
    const names: string[] = json.animations.map((a: any) => a.name);
    for (const core of ANIM_STATES) expect(names, `core clip ${core}`).toContain(core);
    expect(names.filter((n) => !(ANIM_STATES as readonly string[]).includes(n) && !(EXTRA_ANIM_STATES as readonly string[]).includes(n))).toEqual([]);
  });

  it('has every bone (exact names) in the skin', () => {
    const joints = json.skins[0].joints.map((j: number) => nodes[j].name);
    for (const b of BONE_NAMES) expect(joints).toContain(b);
    expect(nodes.find((n) => n.name === 'Rig')).toBeTruthy();
  });

  it('has a mesh node for every style list entry and body/limb part', () => {
    const meshNodes = new Set(nodes.filter((n) => n.mesh !== undefined).map((n) => n.name));
    const missing = requiredNodes().filter((n) => !meshNodes.has(n));
    expect(missing).toEqual([]);
    // every mesh is skinned to the one Rig skin
    for (const n of nodes.filter((x) => x.mesh !== undefined)) expect(n.skin).toBe(0);
  });

  it('Head and every Eyes_* mesh carry all expression morph targets; Stitches carries limb-hide morphs', () => {
    const targets = (name: string): string[] => {
      const n = nodes.find((x) => x.name === name);
      return json.meshes[n.mesh].extras?.targetNames ?? [];
    };
    for (const m of FACE_MORPHS) expect(targets('Head')).toContain(m);
    for (const st of ['droopy', 'wide', 'mismatched', 'sleepy', 'beady']) {
      for (const m of FACE_MORPHS) expect(targets(`Eyes_${st}`)).toContain(m);
    }
    for (const m of Object.values(STITCH_HIDE_MORPHS)) expect(targets('Stitches')).toContain(m);
    expect(targets('Torso')).toContain('build');
  });

  it('defines every named material and no image textures', () => {
    const mats = json.materials.map((m: any) => m.name);
    for (const m of MATERIAL_NAMES) expect(mats).toContain(m);
    expect(json.images ?? []).toHaveLength(0);
  });

  it('has the carry pose + face tuning extras on the Rig node', () => {
    const rig = nodes.find((n) => n.name === 'Rig');
    const carry = JSON.parse(rig.extras.carryPose);
    for (const b of ['upperarm_R', 'forearm_R', 'hand_R', 'upperarm_L', 'forearm_L', 'hand_L']) {
      expect(carry[b]).toHaveLength(4);
      const len = Math.hypot(...(carry[b] as number[]));
      expect(len).toBeCloseTo(1, 4);
    }
  });
});

describe('animation timing and seams', () => {
  const byName = new Map<string, any>(json.animations.map((a: any) => [a.name, a]));
  const duration = (a: any) => Math.max(...a.samplers.map((s: any) => json.accessors[s.input].max[0]));

  it('one-shots have the specified lengths; walk is a 1 s cycle', () => {
    expect(duration(byName.get('pickup'))).toBeCloseTo(1.2, 2);
    expect(duration(byName.get('collapse'))).toBeCloseTo(1.6, 2);
    expect(duration(byName.get('yawn'))).toBeCloseTo(2.0, 2);
    expect(duration(byName.get('walk'))).toBeCloseTo(1.0, 2);
  });

  it('is sampled at 30 fps', () => {
    const walk = byName.get('walk');
    const ch = channel(walk, 'pelvis', 'translation');
    expect(ch).not.toBeNull();
    const dt = ch!.times[1] - ch!.times[0];
    expect(dt).toBeCloseTo(1 / 30, 4);
  });

  it('every looping clip is seamless (first key == last key on every rotation channel)', () => {
    for (const name of ANIM_STATES) {
      if (['pickup', 'collapse', 'yawn'].includes(name)) continue;
      const a = byName.get(name);
      for (const ch of a.channels) {
        if (ch.target.path !== 'rotation' && ch.target.path !== 'translation') continue;
        const s = a.samplers[ch.sampler];
        const v = floats(s.output);
        const k = ch.target.path === 'rotation' ? 4 : 3;
        const first = v.slice(0, k);
        const last = v.slice(v.length - k);
        if (k === 4) {
          const dot = Math.abs(first[0] * last[0] + first[1] * last[1] + first[2] * last[2] + first[3] * last[3]);
          expect(dot, `${name} ${nodes[ch.target.node].name}`).toBeGreaterThan(0.99999);
        } else {
          for (let i = 0; i < 3; i++) expect(Math.abs(first[i] - last[i]), `${name}`).toBeLessThan(1e-5);
        }
      }
    }
  });

  it('is in place: root never moves, pelvis stays near the origin horizontally', () => {
    for (const name of ANIM_STATES) {
      const a = byName.get(name);
      const root = channel(a, 'root', 'translation');
      if (root) for (const v of root.values) expect(Math.abs(v)).toBeLessThan(1e-6);
      const pel = channel(a, 'pelvis', 'translation');
      expect(pel, name).not.toBeNull();
      for (let i = 0; i < pel!.values.length; i += 3) {
        expect(Math.abs(pel!.values[i]), `${name} x`).toBeLessThan(0.2);
        expect(Math.abs(pel!.values[i + 2]), `${name} z`).toBeLessThan(0.45);
      }
    }
  });
});

describe('manifest.characters.json', () => {
  const man = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

  it('matches the GLB bytes and sha256', () => {
    const buf = readFileSync(GLB_PATH);
    expect(man.bytes).toBe(buf.length);
    expect(man.sha256).toBe(createHash('sha256').update(buf).digest('hex'));
    expect(man.file).toBe('models/characters/zombie.glb');
    expect(typeof man.version).toBe('number');
  });

  it('lists animations, morphs and nodes consistent with the GLB', () => {
    const names: string[] = man.animations.map((a: any) => a.name);
    for (const core of ANIM_STATES) expect(names).toContain(core);
    const oneShots = new Set<string>(['pickup', 'collapse', 'yawn', ...EXTRA_ONE_SHOT_STATES]);
    for (const a of man.animations) expect(a.loop, a.name).toBe(!oneShots.has(a.name));
    expect(man.morphs).toEqual([...FACE_MORPHS]);
    for (const n of requiredNodes()) expect(man.nodes).toContain(n);
    expect(man.triangles).toBeLessThanOrEqual(14000);
  });
});
