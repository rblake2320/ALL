/**
 * Premium bodies (tools/blender/cast/premium/build_premium.py -> public/assets/manifest.premium.json).
 *
 * Every body is one design published in two representations on the 22-bone cast rig: `high` under the budget
 * declared in tools/blender/cast/premium/bodies.json and `low` under the unchanged cast budget (TRI_BUDGET /
 * TEX_MAX / GLB_BYTES_BUDGET in ../cast-assets/helpers.ts). The validator reads the real files; the adversarial
 * block runs the same validator on tampered copies and expects each one to be rejected.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAST_BONES, GLB_BYTES_BUDGET, HEIGHT_TOL, ROOT, TEX_MAX, TRI_BUDGET, ZOMBIE_GLB, images, jointNames,
  packGlb, parseGlb, quatAngleDeg, restRotations, sha256, triangles,
} from '../cast-assets/helpers';
import { CAST_BODY_IDS } from '../../../src/shared/cast';

const ASSETS = resolve(ROOT, 'public/assets');
const spec = JSON.parse(readFileSync(resolve(ROOT, 'tools/blender/cast/premium/bodies.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(ASSETS, 'manifest.premium.json'), 'utf8'));
const zombieRot = restRotations(parseGlb(readFileSync(ZOMBIE_GLB)));
const REPS = ['high', 'low'] as const;

type Read = (file: string) => Buffer | null;
const disk: Read = (f) => (existsSync(resolve(ASSETS, f)) ? readFileSync(resolve(ASSETS, f)) : null);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function webpSize(buf: Buffer): [number, number] | null {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  return null;
}

function limitsOf(rep: string): { tris: number; bytes: number; tex: number } | null {
  const r = spec.representations[rep];
  return r ? { tris: r.triBudget, bytes: r.bytesBudget, tex: r.texBase } : null;
}

/**
 * Skin and geometry numbers of one GLB: every position finite; every weight finite, within [0, 1] and each vertex
 * summing to 1; every joint index inside the skin. NaN compares false with everything, so each test is written as
 * "not (finite and in range)" - a bare `Math.abs(sum - 1) > tol` lets NaN through.
 */
function skinProblems(g: ReturnType<typeof parseGlb>, tag: string): string[] {
  const p: string[] = [];
  const prim = g.json.meshes[0].primitives[0];
  const read = (name: string): { count: number; n: number; at: (i: number, k: number) => number } | null => {
    const acc = g.json.accessors[prim.attributes[name]];
    if (!acc) return null;
    const view = g.json.bufferViews[acc.bufferView];
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[acc.type];
    const size = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[acc.componentType];
    const stride = view.byteStride ?? n * size;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const get = acc.componentType === 5126 ? (o: number) => g.bin.readFloatLE(o)
      : acc.componentType === 5123 ? (o: number) => g.bin.readUInt16LE(o)
        : acc.componentType === 5125 ? (o: number) => g.bin.readUInt32LE(o) : (o: number) => g.bin.readUInt8(o);
    return { count: acc.count, n, at: (i, k) => get(base + i * stride + k * size) };
  };
  const pos = read('POSITION');
  const w = read('WEIGHTS_0');
  const j = read('JOINTS_0');
  if (!pos || !w || !j) return [`${tag}: POSITION / WEIGHTS_0 / JOINTS_0 missing`];
  if (w.count !== pos.count || j.count !== pos.count) p.push(`${tag}: skin attribute counts differ from POSITION`);
  const joints = g.json.skins[0].joints.length;
  let badPos = 0, badW = 0, badSum = 0, badJ = 0;
  for (let i = 0; i < pos.count; i++) {
    for (let k = 0; k < 3; k++) if (!Number.isFinite(pos.at(i, k))) badPos++;
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const x = w.at(i, k);
      if (!(Number.isFinite(x) && x >= 0 && x <= 1 + 1e-6)) badW++;
      sum += x;
      const ji = j.at(i, k);
      if (!(Number.isInteger(ji) && ji >= 0 && ji < joints)) badJ++;
    }
    if (!(Number.isFinite(sum) && Math.abs(sum - 1) <= 1e-3)) badSum++;
  }
  if (badPos) p.push(`${tag}: ${badPos} non-finite position components`);
  if (badW) p.push(`${tag}: ${badW} weights not finite or outside [0, 1]`);
  if (badSum) p.push(`${tag}: ${badSum} vertices whose weights do not sum to 1`);
  if (badJ) p.push(`${tag}: ${badJ} joint indices outside the skin`);
  return p;
}

/** Problems of a premium manifest against the files `read` returns. Empty = valid. */
function validatePremium(m: any, read: Read): string[] {
  const p: string[] = [];
  const want = spec.bodies.map((b: any) => b.id);
  const got = (m.bodies ?? []).map((b: any) => b.id);
  if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`bodies ${got} != bodies.json ${want}`);
  let total = 0;
  for (const b of m.bodies ?? []) {
    const def = spec.bodies.find((d: any) => d.id === b.id);
    if (!def) { p.push(`${b.id}: unknown id`); continue; }
    const names = Object.keys(b.representations ?? {}).sort();
    if (JSON.stringify(names) !== JSON.stringify([...REPS].sort())) p.push(`${b.id}: representations ${names}`);
    for (const rep of names) {
      const lim = limitsOf(rep);
      const tag = `${b.id}/${rep}`;
      if (!lim) { p.push(`${tag}: unknown representation`); continue; }
      const r = b.representations[rep];
      const suffix = spec.representations[rep].suffix;
      if (r.file !== `models/characters/premium/${b.id}${suffix}.glb`) p.push(`${tag}: file ${r.file}`);
      const buf = read(r.file);
      if (!buf) { p.push(`${tag}: file missing`); continue; }
      total += buf.length;
      if (buf.length !== r.bytes) p.push(`${tag}: bytes ${buf.length} != manifest ${r.bytes}`);
      if (sha256(buf) !== r.sha256) p.push(`${tag}: sha256 mismatch`);
      if (buf.length > lim.bytes) p.push(`${tag}: ${buf.length} bytes > ${lim.bytes}`);
      let g;
      try { g = parseGlb(buf); } catch (e) { p.push(`${tag}: ${(e as Error).message}`); continue; }
      const joints = jointNames(g);
      if (JSON.stringify([...joints].sort()) !== JSON.stringify([...CAST_BONES].sort())) p.push(`${tag}: bone set ${joints}`);
      if (JSON.stringify(r.bones) !== JSON.stringify(joints)) p.push(`${tag}: manifest bones != GLB joints`);
      const rr = restRotations(g);
      for (const n of CAST_BONES) {
        if (!rr[n] || !zombieRot[n]) continue;
        const a = quatAngleDeg(rr[n], zombieRot[n]);
        if (a > 0.001) p.push(`${tag}: ${n} rest rotation differs from zombie.glb by ${a.toFixed(4)} deg`);
      }
      if ((g.json.animations ?? []).length) p.push(`${tag}: carries animations (clips must be shared)`);
      const meshNodes = g.json.nodes.filter((n: any) => n.mesh !== undefined).map((n: any) => n.name);
      if (JSON.stringify(meshNodes) !== JSON.stringify(['Body'])) p.push(`${tag}: mesh nodes ${meshNodes}`);
      const tris = triangles(g);
      if (tris > lim.tris) p.push(`${tag}: ${tris} triangles > ${lim.tris}`);
      if (tris !== r.triangles) p.push(`${tag}: triangles ${tris} != manifest ${r.triangles}`);
      for (const im of images(g)) {
        if (im.mime !== 'image/jpeg') p.push(`${tag}: texture ${im.mime}`);
        if (!im.size || Math.max(...im.size) > lim.tex) p.push(`${tag}: texture size ${im.size} > ${lim.tex}`);
      }
      const pos = g.json.accessors[g.json.meshes[0].primitives[0].attributes.POSITION];
      if (Math.abs(pos.max[1] - def.height) > HEIGHT_TOL) p.push(`${tag}: height ${pos.max[1]} != ${def.height}`);
      if (Math.abs(pos.min[1]) > 0.005) p.push(`${tag}: feet at y=${pos.min[1]}`);
      p.push(...skinProblems(g, tag));
    }
    if (Math.abs(b.height - def.height) > 1e-9) p.push(`${b.id}: manifest height ${b.height} != bodies.json ${def.height}`);
  }
  if (total !== m.totalBytes) p.push(`totalBytes ${m.totalBytes} != ${total}`);
  if (total > spec.totalBytesBudget) p.push(`total ${total} bytes > ${spec.totalBytesBudget}`);
  return p;
}

describe('manifest.premium.json', () => {
  it('validates against the published files with zero problems', () => {
    expect(validatePremium(manifest, disk)).toEqual([]);
  });

  it('the low representation is inside the unchanged cast budget', () => {
    const low = spec.representations.low;
    expect(low.triBudget).toBe(TRI_BUDGET);
    expect(low.texBase).toBe(TEX_MAX);
    expect(low.bytesBudget).toBe(GLB_BYTES_BUDGET);
    for (const b of manifest.bodies) {
      const r = b.representations.low;
      expect(r.triangles).toBeLessThanOrEqual(TRI_BUDGET);
      expect(r.bytes).toBeLessThanOrEqual(GLB_BYTES_BUDGET);
    }
  });

  it('the high representation really carries more detail than the low one', () => {
    for (const b of manifest.bodies) {
      expect(b.representations.high.triangles).toBeGreaterThan(b.representations.low.triangles * 2);
      const size = (rep: string): number => Math.max(...b.representations[rep].textures.map((t: any) => Math.max(...t.size)));
      expect(size('high')).toBeGreaterThan(size('low'));
    }
  });

  it('shares the clip source and pelvis rule of the cast kit', () => {
    expect(manifest.animationsShared).toBe(true);
    expect(manifest.clipSourceSha256).toBe(sha256(readFileSync(ZOMBIE_GLB)));
    expect(manifest.bones).toEqual(CAST_BONES);
    const cast = JSON.parse(readFileSync(resolve(ASSETS, 'manifest.cast.json'), 'utf8'));
    expect(manifest.pelvisRule).toEqual(cast.pelvisRule);
  });

  it('premium ids never collide with a cast body id or with the classic body', () => {
    const taken = new Set<string>(['classic', ...CAST_BODY_IDS]);
    for (const b of spec.bodies) expect(taken.has(b.id)).toBe(false);
    expect(new Set(spec.bodies.map((b: any) => b.id)).size).toBe(spec.bodies.length);
  });

  it('every body has a 256 px thumbnail and limbs that collapse cleanly', () => {
    for (const b of manifest.bodies) {
      const t = disk(`ui/premium/${b.id}.webp`);
      expect(t, b.id).not.toBeNull();
      expect(webpSize(t!)).toEqual([256, 256]);
      for (const rep of REPS) {
        for (const q of Object.values(b.representations[rep].limbCollapse)) expect(q).toBe('clean');
      }
    }
  });

  it('every position and weight is finite, weights are in range and sum to 1, joint indices are inside the skin', () => {
    for (const b of manifest.bodies) {
      for (const rep of REPS) {
        expect(skinProblems(parseGlb(disk(b.representations[rep].file)!), `${b.id}/${rep}`)).toEqual([]);
      }
    }
  });
});

describe('the premium validator rejects tampered kits', () => {
  const first = manifest.bodies[0];
  const highFile: string = first.representations.high.file;

  it('a flipped byte in a GLB', () => {
    const buf = Buffer.from(disk(highFile)!);
    buf[buf.length - 9] ^= 0xff;
    const probs = validatePremium(manifest, (f) => (f === highFile ? buf : disk(f)));
    expect(probs.some((s) => s.includes('sha256 mismatch'))).toBe(true);
  });

  it('a missing file', () => {
    expect(validatePremium(manifest, (f) => (f === highFile ? null : disk(f)))).toContain(`${first.id}/high: file missing`);
  });

  it('a high-detail file passed off as the low representation', () => {
    const m = clone(manifest);
    m.bodies[0].representations.low = clone(m.bodies[0].representations.high);
    const probs = validatePremium(m, disk);
    expect(probs.some((s) => s.startsWith(`${first.id}/low:`) && s.includes('triangles >'))).toBe(true);
    expect(probs.some((s) => s.startsWith(`${first.id}/low:`) && s.includes('texture size'))).toBe(true);
  });

  it('an unknown representation, and a body with only one representation', () => {
    const m = clone(manifest);
    m.bodies[0].representations.ultra = clone(m.bodies[0].representations.high);
    expect(validatePremium(m, disk).some((s) => s.includes('unknown representation'))).toBe(true);
    const n = clone(manifest);
    delete n.bodies[1].representations.low;
    expect(validatePremium(n, disk).some((s) => s.includes('representations high'))).toBe(true);
  });

  it('an unknown body, a missing body, and a wrong order', () => {
    const m = clone(manifest);
    m.bodies[0].id = 'intruder';
    expect(validatePremium(m, disk).some((s) => s.includes('intruder: unknown id'))).toBe(true);
    const n = clone(manifest);
    n.bodies.pop();
    expect(validatePremium(n, disk)[0]).toMatch(/!= bodies\.json/);
    const o = clone(manifest);
    o.bodies.reverse();
    expect(validatePremium(o, disk)[0]).toMatch(/!= bodies\.json/);
  });

  it('a GLB that carries an animation, an extra bone, or a renamed mesh', () => {
    const src = parseGlb(disk(highFile)!);
    const variants: [string, (j: any) => void][] = [
      ['carries animations', (j) => { j.animations = [{ channels: [], samplers: [] }]; }],
      ['bone set', (j) => { j.nodes[j.skins[0].joints[3]].name = 'tail'; }],
      ['mesh nodes', (j) => { j.nodes.find((n: any) => n.mesh !== undefined).name = 'Torso'; }],
    ];
    for (const [expected, mutate] of variants) {
      const j = clone(src.json);
      mutate(j);
      const buf = packGlb(j, src.bin);
      const m = clone(manifest);
      m.bodies[0].representations.high.bytes = buf.length;
      m.bodies[0].representations.high.sha256 = sha256(buf);
      const probs = validatePremium(m, (f) => (f === highFile ? buf : disk(f)));
      expect(probs.some((s) => s.includes(expected)), expected).toBe(true);
    }
  });

  it('a NaN, infinite, negative or oversized weight, a joint index outside the skin, and a NaN position', () => {
    const src = parseGlb(disk(highFile)!);
    const prim = src.json.meshes[0].primitives[0];
    const offsetOf = (name: string): number => {
      const acc = src.json.accessors[prim.attributes[name]];
      return (src.json.bufferViews[acc.bufferView].byteOffset ?? 0) + (acc.byteOffset ?? 0);
    };
    const jointType: number = src.json.accessors[prim.attributes.JOINTS_0].componentType;
    const cases: [string, RegExp, (bin: Buffer) => void][] = [
      ['NaN weight', /weights not finite/, (bin) => bin.writeFloatLE(NaN, offsetOf('WEIGHTS_0'))],
      ['infinite weight', /weights not finite/, (bin) => bin.writeFloatLE(Infinity, offsetOf('WEIGHTS_0') + 4)],
      ['negative weight', /outside \[0, 1\]/, (bin) => bin.writeFloatLE(-0.25, offsetOf('WEIGHTS_0'))],
      ['weights summing to 2', /do not sum to 1/, (bin) => { for (let k = 0; k < 4; k++) bin.writeFloatLE(0.5, offsetOf('WEIGHTS_0') + k * 4); }],
      ['joint index outside the skin', /joint indices outside the skin/, (bin) => {
        if (jointType === 5123) bin.writeUInt16LE(200, offsetOf('JOINTS_0')); else bin.writeUInt8(200, offsetOf('JOINTS_0'));
      }],
      ['NaN position', /non-finite position/, (bin) => bin.writeFloatLE(NaN, offsetOf('POSITION'))],
    ];
    // control: the untouched file re-packed the same way is clean, so each rejection below is caused by the one edit
    expect(skinProblems(parseGlb(packGlb(src.json, Buffer.from(src.bin))), 'control')).toEqual([]);
    for (const [name, expected, mutate] of cases) {
      const bin = Buffer.from(src.bin);
      mutate(bin);
      const buf = packGlb(src.json, bin);
      const m = clone(manifest);
      m.bodies[0].representations.high.bytes = buf.length;      // hash and size updated: only the number is wrong
      m.bodies[0].representations.high.sha256 = sha256(buf);
      const probs = validatePremium(m, (f) => (f === highFile ? buf : disk(f)));
      expect(probs.some((s) => expected.test(s)), `${name}: ${probs.join(' | ')}`).toBe(true);
    }
  });

  it('a lying total', () => {
    const m = clone(manifest);
    m.totalBytes += 1;
    expect(validatePremium(m, disk).some((s) => s.startsWith('totalBytes'))).toBe(true);
  });
});
