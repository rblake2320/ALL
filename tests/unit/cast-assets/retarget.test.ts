/**
 * Shared-clip runtime rule (docs/contract-requests/cast.md): a reference TS implementation poses every cast body
 * with zombie.glb's clips (CPU linear-blend skinning, no three.js) and checks the anchors the game relies on:
 * seat contact at SEAT_HEIGHT, feet on the floor while standing / walking, lying bodies resting on (not sinking
 * into) the mattress plane and centred, hands reaching table height in sitEat.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIM } from '../../../src/shared/dimensions';
import { ZOMBIE_GLB, accessor, parseGlb, readBodyGlb, readManifest, type Glb } from './helpers';

type V3 = number[];
type Q = number[];
type M4 = Float64Array;

const manifest = readManifest();
const BODY_ROWS: [string, any][] = manifest.bodies.map((b: any): [string, any] => [b.id, b]);
const rule = manifest.pelvisRule;
const Z = parseGlb(readFileSync(ZOMBIE_GLB));

// ---------------------------------------------------------------- math
const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function compose(t: V3, q: Q): M4 {
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w); m[9] = 2 * (y * z - x * w); m[10] = 1 - 2 * (x * x + y * y);
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
function mmul(a: M4, b: M4): M4 {   // column-major
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// ---------------------------------------------------------------- clip sampling (zombie.glb)
function sample(anim: any, nodeName: string, path: string, t: number): number[] | null {
  const idx = Z.json.nodes.findIndex((n: any) => n.name === nodeName);
  const ch = anim.channels.find((c: any) => c.target.node === idx && c.target.path === path);
  if (!ch) return null;
  const s = anim.samplers[ch.sampler];
  const times = accessor(Z, s.input).map((r) => r[0]);
  const vals = accessor(Z, s.output);
  if (t <= times[0]) return vals[0];
  if (t >= times[times.length - 1]) return vals[vals.length - 1];
  let i = 0;
  while (times[i + 1] < t) i++;
  const f = (t - times[i]) / (times[i + 1] - times[i]);
  const a = vals[i], b = vals[i + 1];
  let sign = 1;
  if (path === 'rotation' && a.reduce((s2, x, k) => s2 + x * b[k], 0) < 0) sign = -1;
  const v = a.map((x, k) => x * (1 - f) + sign * b[k] * f);
  if (path === 'rotation') { const n = Math.hypot(...v); return v.map((x) => x / n); }
  return v;
}
const clipByName = (n: string): any => Z.json.animations.find((a: any) => a.name === n);
const duration = (a: any): number => Math.max(...a.samplers.map((s: any) => Z.json.accessors[s.input].max[0]));

/** The documented runtime rule for pelvis.position. */
function remapPelvis(p: V3, clip: string, body: any): V3 {
  if (rule.sitClips.includes(clip)) return p.map((x, k) => x + body.seatPelvisOffset[k]);
  const P0 = rule.zombiePelvisRest;
  const w = Math.min(1, Math.max(0, (rule.lyingY0 - p[1]) / rule.lyingSpan));
  return p.map((x, k) => body.pelvisRest[k] + (x - P0[k]) * body.pelvisScale + body.lyingOffset[k] * w);
}

/** sit* only: q' = qx(-sitThighLift) * q (rotation about the pelvis-local X axis, knees up). */
function liftThigh(q: Q, body: any): Q {
  const a = (-(body.sitThighLift ?? 0) * Math.PI) / 180;
  return qmul([Math.sin(a / 2), 0, 0, Math.cos(a / 2)], q);
}

// ---------------------------------------------------------------- skinning
interface Body { g: Glb; entry: any; pos: V3[]; joints: number[][]; weights: number[][]; ibm: M4[]; names: string[]; parent: Map<number, number> }
function loadBody(entry: any): Body {
  const g = parseGlb(readBodyGlb(entry.file));
  const prim = g.json.meshes[0].primitives[0];
  const skin = g.json.skins[0];
  const ibmRows = accessor(g, skin.inverseBindMatrices);
  const parent = new Map<number, number>();
  g.json.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
  return {
    g, entry, pos: accessor(g, prim.attributes.POSITION), joints: accessor(g, prim.attributes.JOINTS_0),
    weights: accessor(g, prim.attributes.WEIGHTS_0), ibm: ibmRows.map((r) => Float64Array.from(r)),
    names: skin.joints.map((j: number) => g.json.nodes[j].name), parent,
  };
}

function pose(b: Body, clip: string, t: number): V3[] {
  const anim = clipByName(clip);
  const nodes = b.g.json.nodes;
  const local = new Map<number, M4>();
  nodes.forEach((n: any, i: number) => {
    let tr: V3 = n.translation ?? [0, 0, 0];
    let q: Q = n.rotation ?? [0, 0, 0, 1];
    const r = anim && n.name ? sample(anim, n.name, 'rotation', t) : null;
    if (r) q = r;
    if (r && rule.sitClips.includes(clip) && (n.name === 'thigh_L' || n.name === 'thigh_R')) q = liftThigh(q, b.entry);
    if (anim && n.name === 'pelvis') {
      const p = sample(anim, 'pelvis', 'translation', t);
      if (p) tr = remapPelvis(p, clip, b.entry);
    }
    local.set(i, compose(tr, q));
  });
  const world = new Map<number, M4>();
  const W = (i: number): M4 => {
    if (world.has(i)) return world.get(i)!;
    const m = b.parent.has(i) ? mmul(W(b.parent.get(i)!), local.get(i)!) : local.get(i)!;
    world.set(i, m);
    return m;
  };
  const skinM = b.g.json.skins[0].joints.map((j: number, k: number) => mmul(W(j), b.ibm[k]));
  return b.pos.map((v, i) => {
    const o = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = b.weights[i][k];
      if (w <= 0) continue;
      const m = skinM[b.joints[i][k]];
      for (let r = 0; r < 3; r++) o[r] += w * (m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
    }
    return o;
  });
}

describe('pelvis rule (pure)', () => {
  const body = { pelvisRest: [0, 0.6, 0], pelvisScale: 0.8, seatPelvisOffset: [0, -0.01, 0], lyingOffset: [0, 0.1, 0.2] };
  it('maps the zombie rest pelvis to the body rest pelvis and scales deltas', () => {
    expect(remapPelvis(rule.zombiePelvisRest, 'idle', body)).toEqual([0, 0.6, 0]);
    const r = remapPelvis([0.05, 0.56, 0.27], 'hug', body);
    expect(r[0]).toBeCloseTo(0.04, 6); expect(r[1]).toBeCloseTo(0.52, 6); expect(r[2]).toBeCloseTo(0.216, 6);
  });
  it('keeps sit* absolute (seat height) plus the per-body offset', () => {
    expect(remapPelvis([0, 0.46, -0.03], 'sitEat', body)).toEqual([0, 0.45, -0.03]);
  });
  it('sitThighLift raises the knee (thigh tip moves up and forward)', () => {
    const down = [0, -1, 0];
    const rot = (q: Q, v: V3): V3 => {
      const m = compose([0, 0, 0], q);
      return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
    };
    const v = rot(liftThigh([0, 0, 0, 1], { sitThighLift: 30 }), down);
    expect(v[1]).toBeCloseTo(-Math.cos(Math.PI / 6), 6);
    expect(v[2]).toBeCloseTo(Math.sin(Math.PI / 6), 6);
    expect(liftThigh([0, 0, 0, 1], {})).toEqual([0, 0, 0, 1]);
  });
  it('applies the lying offset only to lying keys', () => {
    const lying = remapPelvis([0, 0.11, 0.15], 'sleep', body);
    expect(lying[1]).toBeCloseTo(0.6 - 0.55 * 0.8 + 0.1, 6);
    const kneel = remapPelvis([0, 0.35, -0.1], 'mourn', body);
    expect(kneel[1]).toBeCloseTo(0.6 - 0.31 * 0.8, 6);
  });
});

describe.each(BODY_ROWS)('%s posed with the shared clips', (...row: any[]) => {
  const entry = (row as [string, any])[1];
  const b = loadBody(entry);
  const minY = (vs: V3[]) => vs.reduce((m, v) => Math.min(m, v[1]), Infinity);
  const legBones = ['shin_L', 'shin_R', 'foot_L', 'foot_R'].map((n) => b.names.indexOf(n));
  const domJoint = (i: number) => b.joints[i][b.weights[i].indexOf(Math.max(...b.weights[i]))];
  // feet = low vertices owned by the lower legs (a cape / dress hem weighted to the pelvis is not a foot)
  const restFeet = b.pos.map((v, i) => (v[1] < 0.12 && legBones.includes(domJoint(i)) ? i : -1)).filter((i) => i >= 0);

  it('sit: hip mass on the seat (SEAT_HEIGHT) and feet not through the floor', () => {
    const anim = clipByName('sit');
    const vs = pose(b, 'sit', duration(anim) * 0.3);
    const pel = b.names.indexOf('pelvis');
    // hip mass = the build's seat probe (rest positions of the hip-mass vertices lowest when seated), located in
    // the GLB by position; posed with the runtime rule they must rest where the classic body's hip mass rests
    expect(entry.seatProbe.length).toBeGreaterThanOrEqual(8);
    const probe = entry.seatProbe.map((p: number[]) => {
      let best = -1, bd = Infinity;
      b.pos.forEach((v, i) => { const d = Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]); if (d < bd) { bd = d; best = i; } });
      expect(bd).toBeLessThan(1e-3);
      return best;
    });
    const seat = Math.min(...probe.map((i: number) => vs[i][1]));
    expect(seat).toBeGreaterThan(rule.seatContactY - 0.02);
    expect(seat).toBeLessThan(rule.seatContactY + 0.02);
    // the classic body's own hip mass sinks ~6 cm into the cushion below DIM.SEAT_HEIGHT
    expect(rule.seatContactY).toBeGreaterThan(DIM.SEAT_HEIGHT - 0.1);
    expect(rule.seatContactY).toBeLessThan(DIM.SEAT_HEIGHT);
    expect(pel).toBeGreaterThan(0);
    const feet = restFeet.map((i) => vs[i][1]);
    expect(Math.min(...feet)).toBeGreaterThan(-0.06);
  });

  it('idle / walk: feet stay on the floor (within 6 cm)', () => {
    for (const clip of ['idle', 'walk']) {
      const d = duration(clipByName(clip));
      for (const f of [0, 0.25, 0.5, 0.75]) {
        const vs = pose(b, clip, d * f);
        const fy = Math.min(...restFeet.map((i) => vs[i][1]));
        expect(fy).toBeGreaterThan(-0.06);
        expect(fy).toBeLessThan(0.05);
      }
    }
  });

  it('sleep: lies on y=0 (renderer lifts to BED_HEIGHT) without sinking, centred on z, head toward -Z', () => {
    const vs = pose(b, 'sleep', 0.5);
    // the back (torso-owned, not a cape trailing > 30 cm behind the hips) rests on the mattress plane like the
    // classic back; hats / hair / veils / held props may press into the pillow end (<= 25 cm), nothing floats
    const torsoJ = ['pelvis', 'spine', 'chest'].map((n) => b.names.indexOf(n));
    // (above 85 % of the pelvis height; 2nd percentile, so a bustle / cape fold of a few vertices may dip deeper)
    const back = b.pos.map((v, i) => (torsoJ.includes(domJoint(i)) && v[1] > 0.85 * entry.pelvisRest[1] ? i : -1))
      .filter((i) => i >= 0);
    const ys = back.map((i) => vs[i][1]).sort((x, y) => x - y);
    const backY = ys[Math.floor(ys.length * 0.02)];
    expect(backY).toBeGreaterThan(-0.08);
    expect(backY).toBeLessThan(0.03);
    expect(minY(vs)).toBeLessThan(0.03);
    const zs = vs.map((v) => v[2]);
    const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
    expect(Math.abs(zc)).toBeLessThan(0.12);
    const headIdx = b.pos.map((v, i) => (v[1] > entry.height * 0.85 ? i : -1)).filter((i) => i >= 0);
    const headZ = headIdx.reduce((s, i) => s + vs[i][2], 0) / headIdx.length;
    expect(headZ).toBeLessThan(-0.3);
    // whole body fits a 2.1 m bed
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(2.1);
  });

  it('sitEat: the left hand (plate) comes up to about table height', () => {
    const anim = clipByName('sitEat');
    const vs = pose(b, 'sitEat', 0.3);
    const hl = b.names.indexOf('hand_L');
    const hand = b.pos.map((_, i) => i).filter((i) => b.joints[i].some((j, k) => j === hl && b.weights[i][k] > 0.8));
    const y = hand.reduce((s, i) => s + vs[i][1], 0) / hand.length;
    expect(y).toBeGreaterThan(DIM.TABLE_HEIGHT - 0.25);
    expect(y).toBeLessThan(DIM.TABLE_HEIGHT + 0.45);
    expect(anim).toBeDefined();
  });

  // carry anchors are bone-relative: posed with the clip they must land at the hand that holds them (a bone-length
  // based scale once put the plate ~20 cm off the palm and the phone ~10 cm off the hand)
  it.each([['sitEat', 0.09], ['standEat', 0.09], ['phone', 0.07]])('%s carry anchor stays at the holding hand', (clip, tol) => {
    const a = entry.carryAnchors[clip as string];
    const vs = pose(b, clip as string, duration(clipByName(clip as string)) * 0.35);
    const node = b.g.json.nodes.findIndex((n: any) => n.name === a.bone);
    const world = new Map<number, M4>();
    const anim = clipByName(clip as string);
    const W = (i: number): M4 => {
      if (world.has(i)) return world.get(i)!;
      const n = b.g.json.nodes[i];
      const q: Q = sample(anim, n.name, 'rotation', duration(anim) * 0.35) ?? n.rotation ?? [0, 0, 0, 1];
      let tr: V3 = n.translation ?? [0, 0, 0];
      if (n.name === 'pelvis') { const p = sample(anim, 'pelvis', 'translation', duration(anim) * 0.35); if (p) tr = remapPelvis(p, clip as string, entry); }
      const loc = compose(tr, q);
      const m = b.parent.has(i) ? mmul(W(b.parent.get(i)!), loc) : loc;
      world.set(i, m);
      return m;
    };
    const A = mmul(W(node), Float64Array.from(a.matrix));
    const c = [A[12], A[13], A[14]];
    const hb = b.names.indexOf(a.bone);
    let gap = Infinity;
    b.pos.forEach((_, i) => {
      if (domJoint(i) !== hb) return;
      gap = Math.min(gap, Math.hypot(vs[i][0] - c[0], vs[i][1] - c[1], vs[i][2] - c[2]));
    });
    expect(gap).toBeLessThan(tol as number);
  });
});
