/**
 * CAST BODIES runtime (src/render/characters/cast.ts + castRig.ts + the factory's body switching), against a
 * synthetic cast GLB generated in-test (castFixture.ts: GLTFExporter -> GLTFLoader round trip).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ANIM_STATES, CARRY_ITEMS, EXPRESSIONS, defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import type { AnimState, LimbState, ZombieAppearance } from '../../../src/shared/appearance';
import { CAST_BODY_IDS } from '../../../src/shared/cast';
import type { CastBodyId } from '../../../src/shared/cast';
import { DIM } from '../../../src/shared/dimensions';
import { createCharacterFactory, sanitizeAppearance } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import {
  CAST_IDLE_KEEP, castGlbPath, filterClip, lyingWeight, parseCastManifest, retargetClip,
} from '../../../src/render/characters/cast';
import type { RetargetInfo } from '../../../src/render/characters/cast';
import { COLLAPSED_SCALE, CastRig } from '../../../src/render/characters/castRig';
import { bodyOf, castHeightScale } from '../../../src/render/characters/plan';
import { sanitizeAppearance as simSanitizeAppearance } from '../../../src/sim/engine/agents';
import { castGltf } from './castFixture';
import type { CastFixtureOptions } from './castFixture';
import { loadGltf } from './helpers';

const step = (rig: { update(dt: number): void }, sec: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(sec / dt); i++) rig.update(dt);
};
const look = (body?: CastBodyId | 'classic' | string, extra: Partial<ZombieAppearance> = {}): ZombieAppearance =>
  ({ ...defaultAppearance(), ...extra, ...(body === undefined ? {} : { body: body as CastBodyId }) });
const limbs = (o: Partial<LimbState> = {}): LimbState => ({ ...intactLimbs(), ...o });

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

interface Harness {
  f: ReturnType<typeof createCharacterFactory>;
  warnings: string[];
  urls: string[];
  manifestCalls: number;
}

/** Factory with the real zombie.glb and a synthetic cast GLB for every body (per-call options / failures). */
function harness(o: {
  fixture?: CastFixtureOptions;
  manifest?: unknown | 'missing';
  loadCast?: (url: string) => Promise<GLTF>;
} = {}): Harness {
  const h: Harness = { f: null as unknown as Harness['f'], warnings: [], urls: [], manifestCalls: 0 };
  h.f = createCharacterFactory({
    baseUrl: '/assets/',
    gltf: loadGltf(),
    warn: (m) => h.warnings.push(m),
    loadCast: (url) => {
      h.urls.push(url);
      return o.loadCast ? o.loadCast(url) : castGltf(o.fixture ?? {});
    },
    loadCastManifest: async () => {
      h.manifestCalls++;
      if (o.manifest === 'missing') throw new Error('HTTP 404');
      return o.manifest ?? { version: 1, bodies: [{ id: 'walker', eyeMaterial: 'CastEyes' }] };
    },
  });
  return h;
}

async function settled(h: Harness): Promise<void> {
  await h.f.ready;
  await h.f.castSettled();
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
  return out;
}

function inCarry(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.startsWith('carry_')) return true;
  return false;
}

function skeletons(root: THREE.Object3D): Set<THREE.Skeleton> {
  const s = new Set<THREE.Skeleton>();
  root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && s.add((o as THREE.SkinnedMesh).skeleton));
  return s;
}

const castImpl = (r: ZombieRigDebug): CastRig => {
  expect(r.impl).toBeInstanceOf(CastRig);
  return r.impl as CastRig;
};

const worldY = (r: ZombieRigDebug, bone: string): number => {
  const b = r.root.getObjectByName(bone);
  if (!b) throw new Error(`no ${bone}`);
  r.root.updateMatrixWorld(true);
  return b.getWorldPosition(new THREE.Vector3()).y;
};

// ───────────────────────────── pure parts

describe('appearance.body plumbing', () => {
  it('render sanitizeAppearance keeps known cast ids only and never adds a body key to classic looks', () => {
    expect(sanitizeAppearance(look('walker')).body).toBe('walker');
    for (const bad of ['classic', 'Walker', 'zombie', '', 42, null, { id: 'walker' }, '__proto__']) {
      const s = sanitizeAppearance({ ...defaultAppearance(), body: bad });
      expect('body' in s).toBe(false);
    }
    const old = defaultAppearance();
    expect(JSON.stringify(sanitizeAppearance(old))).toBe(JSON.stringify(old));
    expect(bodyOf(undefined)).toBe('classic');
    expect(bodyOf({ body: 'gold' })).toBe('gold');
  });

  it('sim sanitizeAppearance (requested in cast-ui.md #1) keeps a cast body; old appearances stay byte-identical', () => {
    expect(simSanitizeAppearance(look('bride')).body).toBe('bride');
    const old = defaultAppearance();
    expect(JSON.stringify(simSanitizeAppearance(old))).toBe(JSON.stringify(old));
    expect('body' in simSanitizeAppearance({ ...old, body: 'classic' })).toBe(false);
    expect('body' in simSanitizeAppearance({ ...old, body: 'nope' })).toBe(false);
    const keys = Object.keys(simSanitizeAppearance(look('boss')));
    expect(keys[keys.length - 1]).toBe('body'); // appended last: JSON of body-less appearances unchanged
  });

  it('castHeightScale is +-6 % around the sculpted height, total on garbage', () => {
    expect(castHeightScale(0)).toBeCloseTo(0.94, 6);
    expect(castHeightScale(0.5)).toBeCloseTo(1, 6);
    expect(castHeightScale(1)).toBeCloseTo(1.06, 6);
    for (const bad of [NaN, -5, 9, 'x', undefined]) {
      const s = castHeightScale(bad);
      expect(s).toBeGreaterThanOrEqual(0.94);
      expect(s).toBeLessThanOrEqual(1.06);
    }
  });
});

describe('manifest parsing', () => {
  it('accepts array / object shapes, fills defaults for every body, rejects hostile values', () => {
    const a = parseCastManifest({ bodies: [{ id: 'walker', file: 'models/characters/cast/walker.glb', eyeMaterial: 'Eyes', pelvisScale: 1.1 }] });
    expect(a.size).toBe(CAST_BODY_IDS.length);
    expect(a.get('walker')).toMatchObject({ eyeMaterial: 'Eyes', pelvisScale: 1.1 });
    expect(a.get('cone')).toMatchObject({ file: castGlbPath('cone'), eyeMaterial: null, pelvisScale: null });
    const b = parseCastManifest({ bodies: { gold: { height: 1.7, seatPelvisOffset: [0, 0.01, 0] } } });
    expect(b.get('gold')).toMatchObject({ height: 1.7, seatPelvisOffset: [0, 0.01, 0] });
    const hostile = parseCastManifest([
      { id: 'walker', file: '../../etc/passwd.glb', eyeMaterial: '<img onerror=x>', height: 9, pelvisScale: -1, lyingOffset: [1e9, 0, 0] },
      { id: 'nope', file: 'x.glb' },
      null, 7, 'str',
    ]);
    expect(hostile.get('walker')).toMatchObject({
      file: castGlbPath('walker'), eyeMaterial: null, height: 1.72, pelvisScale: null, lyingOffset: null,
    });
    const rule = parseCastManifest({ pelvisRule: { zombiePelvisRest: [0, 0.66, 0], sitClips: ['sit', 'bogus'], lyingY0: 0.3, lyingSpan: 'x' }, bodies: [] });
    expect(rule.get('boss')!.rule).toMatchObject({ zombiePelvisRest: [0, 0.66, 0], lyingY0: 0.3, lyingSpan: 0.14 });
    expect([...rule.get('boss')!.rule.sitClips]).toEqual(['sit']);
    for (const junk of [null, undefined, 'x', 42, [], {}, { bodies: 'x' }]) {
      expect(parseCastManifest(junk).size).toBe(CAST_BODY_IDS.length);
    }
  });
});

describe('shared-clip retargeting (cast.md rule)', () => {
  const q = new THREE.Quaternion();
  const info = (o: Partial<RetargetInfo> = {}): RetargetInfo => ({
    castRest: new Map([['spine', q]]), zombieRest: new Map([['spine', q]]),
    zombiePelvis: [0, 0.66, 0], castPelvis: [0, 0.8, 0.01], pelvisScale: 1.2,
    seatPelvisOffset: [0, 0, 0.02], lyingOffset: [0, 0.05, 0], ...o,
  });
  const clip = (name: string, ys: number[]) => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('pelvis.position', ys.map((_, i) => i), ys.flatMap((y) => [0.1, y, 0])),
    new THREE.QuaternionKeyframeTrack('spine.quaternion', [0], [0, 0.3826834, 0, 0.9238795]),
    new THREE.QuaternionKeyframeTrack('jaw.quaternion', [0], [0, 0, 0, 1]),
  ]);
  const bones = new Set(['pelvis', 'spine']);

  it('upright keys: Pc + (p - P0) * s; lying keys add the lying offset; sit* keeps the seat absolute', () => {
    const w = retargetClip(clip('walk', [0.66, 0.7]), info(), bones);
    const v = w.tracks.find((t) => t.name === 'pelvis.position')!.values;
    expect(v[0]).toBeCloseTo(0.12, 6); // 0 + 0.1 * 1.2
    expect(v[1]).toBeCloseTo(0.8, 6);
    expect(v[2]).toBeCloseTo(0.01, 6);
    expect(v[4]).toBeCloseTo(0.8 + 0.04 * 1.2, 6);
    const sleep = retargetClip(clip('sleep', [0.1]), info(), bones).tracks[0].values;
    expect(sleep[1]).toBeCloseTo(0.8 + (0.1 - 0.66) * 1.2 + 0.05 * lyingWeight(0.1), 6);
    const sit = retargetClip(clip('sit', [DIM.SEAT_HEIGHT]), info(), bones).tracks[0].values;
    expect([sit[0], sit[1], sit[2]].map((x) => +x.toFixed(6))).toEqual([0.1, DIM.SEAT_HEIGHT, 0.02]);
  });

  it('drops tracks for bones the body lacks; identical rests leave rotations untouched; differing rests re-base them', () => {
    const same = retargetClip(clip('idle', [0.66]), info(), bones);
    expect(same.tracks.map((t) => t.name)).toEqual(['pelvis.position', 'spine.quaternion']);
    expect(Array.from(same.tracks[1].values)).toEqual(Array.from(new Float32Array([0, 0.3826834, 0, 0.9238795])));
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);
    const diff = retargetClip(clip('idle', [0.66]), info({ castRest: new Map([['spine', rot]]) }), bones);
    const out = new THREE.Quaternion().fromArray(diff.tracks[1].values as unknown as number[]);
    const want = new THREE.Quaternion(0, 0.3826834, 0, 0.9238795).premultiply(rot);
    expect(Math.abs(out.dot(want))).toBeCloseTo(1, 5);
    expect(filterClip(clip('idle', [0.66]), new Set(['spine'])).tracks.map((t) => t.name)).toEqual(['spine.quaternion']);
    expect(lyingWeight(0.3)).toBe(0);
    expect(lyingWeight(0.05)).toBe(1);
  });
});

// ───────────────────────────── factory + rig

describe('cast rig lifecycle', () => {
  it('a cast body requested before anything loads swaps in place (same root, state replayed) once its GLB arrives', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    const root = r.root;
    expect(r.kind).toBe('fallback');
    expect(r.wantedBody).toBe('walker');
    r.setAnim('sitTV');
    r.setCarry('book');
    r.setHighlight('selected');
    r.setExpression('sad');
    await settled(h);
    expect(r.kind).toBe('cast');
    expect(r.body).toBe('walker');
    expect(r.root).toBe(root);
    expect(root.children).toHaveLength(1); // the stand-in was removed and disposed
    expect(h.urls).toEqual(['/assets/models/characters/cast/walker.glb']);
    step(r, 0.5);
    expect(r.stats().clip).toBe('sitTV');
    expect(root.getObjectByName('carry_book')).toBeTruthy();
    const c = castImpl(r);
    expect(c.postureWeight('sad')).toBeGreaterThan(0.5);
    expect(h.warnings).toEqual([]);
    h.f.dispose();
  });

  it('a body that is already loaded is created directly as a cast rig; classic looks never touch the cast loader', async () => {
    const h = harness();
    const classic = h.f.create(look(), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(classic.kind).toBe('gltf');
    expect(h.urls).toEqual([]);
    expect(h.manifestCalls).toBe(0);
    const a = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    const b = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    expect(b.kind).toBe('cast'); // synchronous: template cached
    expect(h.urls).toHaveLength(1);
    expect(h.f.castStats().refs.walker).toBe(2);
    a.dispose();
    b.dispose();
    classic.dispose();
    h.f.dispose();
  });

  it('plays all 45 states with the interruption-safe 0.25 s ramp (weights always sum to 1, no bind-pose leak)', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    const c = castImpl(r);
    for (const a of ANIM_STATES) {
      r.setAnim(a);
      r.update(0.04);
      const sum = c.activeClips().reduce((s, x) => s + x.effective, 0);
      expect(sum).toBeCloseTo(1, 5);
      expect(r.stats().clip.startsWith(a === 'limp' ? 'walk' : a)).toBe(true);
    }
    // rapid A -> B -> C mid-fade
    r.setAnim('walk');
    r.update(0.1);
    r.setAnim('cheer');
    r.update(0.05);
    r.setAnim('sleep');
    for (let i = 0; i < 10; i++) {
      r.update(0.03);
      const sum = c.activeClips().reduce((s, x) => s + x.effective, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
    step(r, 0.4);
    expect(c.activeClips().map((x) => x.clip)).toEqual(['sleep']);
    const top = r.headTop(new THREE.Vector3());
    expect(top.y).toBeLessThan(0.8); // lying: head top follows the pose
    h.f.dispose();
  });

  it('seat contact stays at SEAT_HEIGHT for every height; height scales +-6 %; headTop near the sculpted height', async () => {
    const h = harness({ fixture: { scale: 1.12 } }); // a taller sculpt (pelvis higher than zombie.glb's)
    const tall = h.f.create(look('walker', { height: 1 }), limbs()) as ZombieRigDebug;
    const short = h.f.create(look('walker', { height: 0 }), limbs()) as ZombieRigDebug;
    await settled(h);
    for (const r of [tall, short]) {
      r.setAnim('sit');
      step(r, 0.6);
      expect(worldY(r, 'pelvis')).toBeCloseTo(DIM.SEAT_HEIGHT, 3);
    }
    tall.setAnim('idle');
    short.setAnim('idle');
    step(tall, 0.6);
    step(short, 0.6);
    const ht = tall.headTop(new THREE.Vector3()).y;
    const hs = short.headTop(new THREE.Vector3()).y;
    expect(ht / hs).toBeGreaterThan(1.08);
    expect(ht / hs).toBeLessThan(1.16);
    // standing pelvis follows the taller sculpt (shared clip remap), not zombie.glb's 0.66 m
    expect(worldY(tall, 'pelvis')).toBeGreaterThan(worldY(short, 'pelvis') * 1.08);
    h.f.dispose();
  });

  it('per-zombie loop phase: two different cast zombies do not idle in lockstep; same look is reproducible', async () => {
    const h = harness();
    const a = h.f.create(look('walker', { hairColor: '#111111' }), limbs()) as ZombieRigDebug;
    const b = h.f.create(look('walker', { hairColor: '#222222' }), limbs()) as ZombieRigDebug;
    const a2 = h.f.create(look('walker', { hairColor: '#111111' }), limbs()) as ZombieRigDebug;
    await settled(h);
    for (const r of [a, b, a2]) r.setAnim('walk');
    const q = (r: ZombieRigDebug) => r.root.getObjectByName('thigh_L')!.quaternion.clone();
    for (const r of [a, b, a2]) r.update(1 / 30);
    const diff = (x: THREE.Quaternion, y: THREE.Quaternion) => Math.max(...x.toArray().map((v, i) => Math.abs(v - y.toArray()[i])));
    expect(diff(q(a), q(b))).toBeGreaterThan(1e-3);
    expect(diff(q(a), q(a2))).toBe(0);
    h.f.dispose();
  });
});

describe('limbs on cast bodies', () => {
  it('missing arm/leg collapses forearm/shin (whole sub-chain) + adds a body-tinted stump cap; clips substitute', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    const c = castImpl(r);
    r.setLimbs(limbs({ armR: 'missing', legL: 'missing' }));
    r.setAnim('walk');
    step(r, 0.4);
    expect(r.stats().clip).toBe('limp');
    expect(c.bone('forearm_R')!.scale.x).toBeCloseTo(COLLAPSED_SCALE, 9);
    expect(c.bone('shin_L')!.scale.x).toBeCloseTo(COLLAPSED_SCALE, 9);
    expect(c.bone('forearm_L')!.scale.x).toBe(1);
    // the hand follows the collapsed forearm to the elbow
    r.root.updateMatrixWorld(true);
    const elbow = c.bone('forearm_R')!.getWorldPosition(new THREE.Vector3());
    const hand = c.bone('hand_R')!.getWorldPosition(new THREE.Vector3());
    expect(elbow.distanceTo(hand)).toBeLessThan(0.002);
    const capA = r.root.getObjectByName('Stump_ArmR') as THREE.Mesh;
    const capL = r.root.getObjectByName('Stump_LegL') as THREE.Mesh;
    expect(capA.parent?.name).toBe('upperarm_R');
    expect(capL.parent?.name).toBe('thigh_L');
    expect(capA.castShadow).toBe(false);
    expect(r.stats().visibleNodes.sort()).toEqual(['Body', 'Stump_ArmR', 'Stump_LegL']);
    // right-handed clips mirror when the right arm is gone
    r.setAnim('wave');
    expect(r.stats().clip).toBe('wave (mirrored)');
    // both legs -> crawl
    r.setLimbs(limbs({ legL: 'missing', legR: 'missing' }));
    r.setAnim('idle');
    expect(r.stats().clip).toBe('crawl');
    // back to intact: everything restored, no caps left
    r.setLimbs(limbs());
    expect(c.bone('forearm_R')!.scale.x).toBe(1);
    expect(r.root.getObjectByName('Stump_ArmR')).toBeUndefined();
    expect(r.stats().visibleNodes).toEqual(['Body']);
    h.f.dispose();
  });

  it('prosthetics: wooden peg follows the collapsed bone animation and reaches the floor for a leg', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs({ legR: 'prosthetic', armL: 'prosthetic' })) as ZombieRigDebug;
    await settled(h);
    const c = castImpl(r);
    r.setAnim('walk');
    const pivot = r.root.getObjectByName('Prosthetic_LegR')!;
    expect(pivot).toBeTruthy();
    expect(r.root.getObjectByName('Prosthetic_ArmL')).toBeTruthy();
    expect(r.stats().clip).toBe('walk'); // prosthetic legs walk normally
    for (let i = 0; i < 12; i++) {
      r.update(1 / 15);
      expect(pivot.quaternion.equals(c.bone('shin_R')!.quaternion)).toBe(true);
      expect(pivot.position.distanceTo(c.bone('shin_R')!.position)).toBeLessThan(1e-9);
    }
    r.setAnim('idle');
    step(r, 1);
    const peg = pivot.children[0] as THREE.Mesh;
    r.root.updateMatrixWorld(true);
    const tip = new THREE.Vector3(0, 1, 0).applyMatrix4(peg.matrixWorld); // peg geometry spans y 0..1
    expect(Math.abs(tip.y)).toBeLessThan(0.06);
    expect(peg.castShadow).toBe(false);
    r.setLimbs(limbs());
    expect(r.root.getObjectByName('Prosthetic_LegR')).toBeUndefined();
    h.f.dispose();
  });
});

describe('carry, expression, highlight', () => {
  it('carry uses prop_R / prop_L and the zombie.glb anchors; follows the clip and the limbs', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    for (const item of CARRY_ITEMS) {
      r.setCarry(item);
      expect(r.root.getObjectByName(`carry_${item}`)?.parent?.name).toBe('prop_R');
    }
    r.setCarry('plate');
    r.setAnim('sitEat');
    expect(r.root.getObjectByName('carry_plate')?.parent?.name).toBe('hand_L');
    expect(r.root.getObjectByName('carry_fork')).toBeTruthy();
    r.setAnim('idle');
    r.setLimbs(limbs({ armR: 'missing' }));
    expect(r.root.getObjectByName('carry_plate')?.parent?.name).toBe('prop_L');
    r.setLimbs(limbs({ armR: 'missing', armL: 'missing' }));
    expect(r.root.getObjectByName('carry_plate')).toBeUndefined();
    r.setCarry(null);
    expect(meshes(r.root).filter(inCarry)).toHaveLength(0);
    h.f.dispose();
  });

  it('carries on the hand when the body has no prop bones', async () => {
    const h = harness({ fixture: { omitBones: ['prop_R', 'prop_L', 'jaw'] } });
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    r.setCarry('phone');
    expect(r.root.getObjectByName('carry_phone')?.parent?.name).toBe('hand_R');
    for (const a of ANIM_STATES) {
      r.setAnim(a);
      r.update(0.03);
    }
    expect(h.warnings).toEqual([]);
    h.f.dispose();
  });

  it('expression -> posture layer; eye material follows eyeColor with a subtle per-expression tint', async () => {
    const h = harness({ fixture: { eyes: true } });
    const r = h.f.create(look('walker', { eyeColor: '#3366cc' }), limbs()) as ZombieRigDebug;
    await settled(h);
    const c = castImpl(r);
    const eyes = c.getEyeMaterials();
    expect(eyes).toHaveLength(1);
    step(r, 0.2);
    const base = eyes[0].color.clone();
    const want = new THREE.Color().setRGB(0x33 / 255, 0x66 / 255, 0xcc / 255, THREE.SRGBColorSpace);
    expect(base.r).toBeCloseTo(want.r, 4);
    r.setExpression('angry');
    step(r, 1.5);
    expect(c.postureWeight('angry')).toBeGreaterThan(0.99);
    const angry = eyes[0].color;
    expect(angry.r).toBeGreaterThan(base.r);
    expect(eyes[0].emissive.r).toBeGreaterThan(0);
    // subtle: still clearly the zombie's own eye colour, never replaced by the tint
    expect(angry.b).toBeGreaterThan(base.b * 0.4);
    for (const e of EXPRESSIONS) {
      r.setExpression(e);
      step(r, 0.2);
    }
    r.setExpression('neutral');
    step(r, 3);
    expect(eyes[0].color.r).toBeCloseTo(base.r, 3);
    expect(eyes[0].emissive.r).toBeCloseTo(0, 3);
    h.f.dispose();
  });

  it('highlight: additive fresnel rim patched into every cast material', async () => {
    const h = harness({ fixture: { eyes: true } });
    const r = h.f.create(look('walker'), limbs({ armL: 'missing', legR: 'prosthetic' })) as ZombieRigDebug;
    await settled(h);
    const c = castImpl(r);
    const mats = c.getMaterials();
    expect(mats.length).toBeGreaterThanOrEqual(4); // body, eyes, stump, peg
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n#include <color_fragment>',
    };
    for (const m of mats) {
      expect(m.customProgramCacheKey()).toBe('zombie-std-v1');
      const s = { ...shader, uniforms: {} as Record<string, { value: unknown }> };
      m.onBeforeCompile(s as never, null as never);
      expect(s.fragmentShader).toContain('uRimStrength');
    }
    const rim = () => {
      const s = { ...shader, uniforms: {} as Record<string, { value: number }> };
      mats[0].onBeforeCompile(s as never, null as never);
      return s.uniforms.uRimStrength.value;
    };
    r.setHighlight('selected');
    step(r, 1);
    expect(rim()).toBeCloseTo(0.55, 3);
    r.setHighlight('hover');
    step(r, 1);
    expect(rim()).toBeCloseTo(0.25, 3);
    r.setHighlight('none');
    step(r, 1);
    expect(rim()).toBe(0);
    h.f.dispose();
  });
});

describe('budgets and resource ownership', () => {
  it('draw calls: 1 body draw + 1 shadow draw intact; tiny parts never cast; one Skeleton per rig', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(r.stats().drawCalls).toBe(1);
    expect(meshes(r.root).filter((m) => m.castShadow)).toHaveLength(1);
    expect(skeletons(r.root).size).toBe(1);
    r.setCarry('plate');
    expect(r.stats().drawCalls).toBe(2);
    r.setLimbs(limbs({ armL: 'missing', armR: 'prosthetic', legL: 'missing', legR: 'prosthetic' }));
    // worst case: body + 4 caps + 2 pegs + the carried plate; none of the limb extras cast a shadow
    expect(meshes(r.root).filter((m) => m.castShadow && !inCarry(m)).map((m) => m.name)).toEqual(['Body']);
    expect(r.stats().drawCalls).toBeLessThanOrEqual(8);
    h.f.dispose();
  });

  it('dispose frees the per-rig materials + bone texture exactly once and releases the template ref', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs({ armL: 'prosthetic' })) as ZombieRigDebug;
    await settled(h);
    const c = castImpl(r);
    const mats = [...c.getMaterials()];
    const sk = [...skeletons(r.root)][0];
    let matDisposed = 0;
    let skDisposed = 0;
    for (const m of mats) m.addEventListener('dispose', () => matDisposed++);
    const orig = sk.dispose.bind(sk);
    sk.dispose = () => {
      skDisposed++;
      orig();
    };
    expect(h.f.castStats().refs.walker).toBe(1);
    r.dispose();
    r.dispose();
    expect(matDisposed).toBe(mats.length);
    expect(skDisposed).toBe(1);
    expect(h.f.castStats().refs.walker).toBeUndefined();
    expect(h.f.castStats().idle).toEqual(['walker']); // kept warm
    // every call stays safe after dispose
    r.setAppearance(look('cone'));
    r.setAnim('walk');
    r.update(0.1);
    expect(Number.isFinite(r.headTop(new THREE.Vector3()).y)).toBe(true);
    h.f.dispose();
  });

  it('shared template survives one rig, idle LRU keeps CAST_IDLE_KEEP bodies and disposes older templates', async () => {
    const geoDisposed = new Map<string, number>();
    const h = harness({
      loadCast: async (url) => {
        const g = await castGltf();
        const id = /cast\/(\w+)\.glb$/.exec(url)![1];
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.geometry.addEventListener('dispose', () => geoDisposed.set(id, (geoDisposed.get(id) ?? 0) + 1));
        });
        return g;
      },
    });
    const ids: CastBodyId[] = ['walker', 'cone', 'hardhat', 'runner', 'thief'];
    const rigs = ids.map((id) => h.f.create(look(id), limbs()) as ZombieRigDebug);
    const twin = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(rigs.every((r) => r.kind === 'cast')).toBe(true);
    rigs[0].dispose();
    expect(h.f.castStats().refs.walker).toBe(1);
    step(twin, 0.2); // the twin still renders off the shared template
    twin.dispose();
    for (const r of rigs.slice(1)) r.dispose();
    expect(h.urls).toHaveLength(5); // a batch load never evicts bodies its rigs are about to use
    const st = h.f.castStats();
    expect(st.idle).toHaveLength(CAST_IDLE_KEEP);
    expect(st.idle).toEqual(['hardhat', 'runner', 'thief']);
    expect(geoDisposed.get('walker')).toBe(1);
    expect(geoDisposed.get('cone')).toBe(1);
    expect(geoDisposed.get('thief')).toBeUndefined();
    // an evicted body reloads transparently
    const again = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(again.kind).toBe('cast');
    h.f.dispose();
    expect(geoDisposed.get('thief')).toBe(1);
    expect(geoDisposed.get('walker')).toBe(2);
  });
});

describe('adversarial', () => {
  it('unknown body id -> classic rig, nothing loaded, no warning', async () => {
    const h = harness();
    const r = h.f.create(look('definitely-not-a-body'), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(r.kind).toBe('gltf');
    expect(r.wantedBody).toBe('classic');
    expect(h.urls).toEqual([]);
    expect(h.warnings).toEqual([]);
    h.f.dispose();
  });

  it('manifest missing -> warns once, loads conventional paths with defaults', async () => {
    const h = harness({ manifest: 'missing' });
    const a = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    const b = h.f.create(look('cone'), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(a.kind).toBe('cast');
    expect(b.kind).toBe('cast');
    expect(h.manifestCalls).toBe(1);
    expect(h.warnings.filter((w) => w.includes('manifest.cast.json'))).toHaveLength(1);
    expect(h.urls.sort()).toEqual(['/assets/models/characters/cast/cone.glb', '/assets/models/characters/cast/walker.glb']);
    h.f.dispose();
  });

  it('GLB 404 -> keeps the classic rig, warns once per body, never retries; other bodies unaffected', async () => {
    const h = harness({
      loadCast: (url) => (url.includes('gold') ? Promise.reject(new Error('HTTP 404')) : castGltf()),
    });
    const a = h.f.create(look('gold'), limbs()) as ZombieRigDebug;
    const b = h.f.create(look('gold'), limbs()) as ZombieRigDebug;
    const ok = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(a.kind).toBe('gltf');
    expect(b.kind).toBe('gltf');
    expect(a.wantedBody).toBe('gold');
    expect(ok.kind).toBe('cast');
    expect(h.warnings.filter((w) => w.includes("'gold'"))).toHaveLength(1);
    expect(h.f.castStats().failed).toEqual(['gold']);
    const c = h.f.create(look('gold'), limbs()) as ZombieRigDebug;
    a.setAppearance(look('gold', { height: 0.9 }));
    await settled(h);
    expect(c.kind).toBe('gltf');
    expect(h.urls.filter((u) => u.includes('gold'))).toHaveLength(1);
    // switching a failed-body zombie to a working body still works
    a.setAppearance(look('walker'));
    expect(a.kind).toBe('cast');
    h.f.dispose();
  });

  it('a structurally broken cast GLB (no skinned mesh) fails cleanly', async () => {
    const h = harness({ loadCast: async () => ({ scene: new THREE.Group(), animations: [] }) as unknown as GLTF });
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    expect(r.kind).toBe('gltf');
    expect(h.warnings.some((w) => w.includes("'walker'"))).toBe(true);
    h.f.dispose();
  });

  it('rig disposed mid-load: no swap, no leak; factory disposed mid-load: the late GLB is released', async () => {
    const d = deferred<GLTF>();
    const h = harness({ loadCast: () => d.promise });
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await h.f.ready;
    r.dispose();
    const late = await castGltf();
    let disposed = 0;
    late.scene.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.addEventListener('dispose', () => disposed++));
    h.f.dispose();
    d.resolve(late);
    await h.f.castSettled();
    await new Promise((res) => setTimeout(res, 0));
    expect(disposed).toBe(1);
    expect(r.root.children).toHaveLength(0);
    expect(h.f.castStats().loaded).toEqual([]);
  });

  it('rapid body switching (out-of-order arrivals) ends on the last requested body with consistent ref counts', async () => {
    const gates = new Map<string, Deferred<GLTF>>();
    const h = harness({
      loadCast: (url) => {
        const id = /cast\/(\w+)\.glb$/.exec(url)![1];
        const g = deferred<GLTF>();
        gates.set(id, g);
        return g.promise;
      },
    });
    const r = h.f.create(look(), limbs()) as ZombieRigDebug;
    await h.f.ready;
    const root = r.root;
    for (const b of ['walker', 'cone', 'classic', 'gold', 'cone'] as const) r.setAppearance(look(b === 'classic' ? undefined : b));
    await new Promise((res) => setTimeout(res, 0));
    expect(r.kind).toBe('gltf');
    // arrive in reverse order
    const tick = () => new Promise((res) => setTimeout(res, 5));
    for (const id of ['gold', 'cone', 'walker']) {
      gates.get(id)!.resolve(await castGltf());
      await tick();
      if (id === 'gold') expect(r.kind).toBe('gltf'); // gold arrived but is no longer wanted
    }
    await h.f.castSettled();
    expect(r.body).toBe('cone');
    expect(r.root).toBe(root);
    expect(root.children).toHaveLength(1);
    const st = h.f.castStats();
    expect(st.refs).toEqual({ cone: 1 });
    // now flip between ready bodies synchronously many times
    const order: (CastBodyId | undefined)[] = ['walker', 'gold', undefined, 'cone', 'walker', undefined, 'gold'];
    for (let i = 0; i < 40; i++) {
      r.setAppearance(look(order[i % order.length]));
      r.update(0.016);
    }
    await h.f.castSettled();
    expect(r.body).toBe(order[39 % order.length] ?? 'classic');
    const refs = h.f.castStats().refs;
    const total = Object.values(refs).reduce((s, n) => s + (n ?? 0), 0);
    expect(total).toBe(r.body === 'classic' ? 0 : 1);
    expect(root.children).toHaveLength(1);
    r.dispose();
    expect(h.f.castStats().refs).toEqual({});
    h.f.dispose();
  });

  it('zombie.glb failing does not block cast bodies (clips baked into the cast GLB still play)', async () => {
    const warnings: string[] = [];
    const f = createCharacterFactory({
      baseUrl: '/assets/',
      load: () => Promise.reject(new Error('zombie 404')),
      loadCast: () => castGltf({ bake: ['idle', 'walk', 'sit'] }),
      loadCastManifest: async () => ({}),
      warn: (m) => warnings.push(m),
    });
    const r = f.create(look('walker'), limbs()) as ZombieRigDebug;
    await f.ready;
    await f.castSettled();
    expect(f.failed()).toBe(true);
    expect(r.kind).toBe('cast');
    r.setAnim('sit');
    step(r, 0.5);
    expect(worldY(r, 'pelvis')).toBeCloseTo(DIM.SEAT_HEIGHT, 2);
    // a clip neither baked nor shareable falls back to idle (no throw, no warning spam)
    for (const a of ['dance', 'sleep', 'cook'] as AnimState[]) {
      r.setAnim(a);
      r.update(0.1);
    }
    expect(warnings.filter((w) => !w.includes('zombie.glb'))).toEqual([]);
    f.dispose();
  });

  it('every ZombieRig call survives garbage input on a cast rig', async () => {
    const h = harness();
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    const junk: unknown[] = [null, undefined, NaN, -1, 'x', {}, [], () => 1];
    for (const j of junk) {
      r.setAppearance(j as never);
      r.setLimbs(j as never);
      r.setDecay(j as never);
      r.setAnim(j as never);
      r.setExpression(j as never);
      r.setCarry(j as never);
      r.setHighlight(j as never);
      r.setMoveSpeed(j as never);
      r.setTalking(j as never);
      r.update(j as never);
    }
    // garbage appearance = default look = classic
    expect(r.wantedBody).toBe('classic');
    expect(r.kind).toBe('gltf');
    r.setAppearance(look('walker'));
    r.setDecay(1);
    r.setTalking(true);
    step(r, 0.5);
    expect(Number.isFinite(r.headTop(new THREE.Vector3()).y)).toBe(true);
    expect(h.warnings).toEqual([]);
    h.f.dispose();
  });
});

describe('saves carry the body (persistence schema)', () => {
  it('a world with cast bodies validates with zero issues and round-trips; body-less agents stay body-less', async () => {
    const { validateWorld } = await import('../../../src/persistence/validation/index');
    const { canonicalJson } = await import('../../../src/persistence/canonicalJson');
    const { makeWorld } = await import('../persistence/fixtures');
    const plain = makeWorld();
    const r0 = validateWorld(JSON.parse(JSON.stringify(plain)));
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    expect(r0.issues).toEqual([]);
    expect(canonicalJson(r0.world)).toBe(canonicalJson(plain));
    for (const a of Object.values(r0.world.agents)) expect('body' in a.appearance).toBe(false);
    const withBody = makeWorld();
    const first = Object.values(withBody.agents)[0];
    first.appearance = { ...first.appearance, body: 'ringmaster' };
    const r1 = validateWorld(JSON.parse(JSON.stringify(withBody)));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.issues).toEqual([]);
    expect(r1.world.agents[first.id].appearance.body).toBe('ringmaster');
    expect(canonicalJson(r1.world)).toBe(canonicalJson(withBody));
    // an unknown id (future build) is repaired to absent, never `body: undefined`
    first.appearance = { ...first.appearance, body: 'future-body' as CastBodyId };
    const r2 = validateWorld(JSON.parse(JSON.stringify(withBody)));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect('body' in r2.world.agents[first.id].appearance).toBe(false);
    expect(() => canonicalJson(r2.world)).not.toThrow();
  });
});

describe('cast.md data sources', () => {
  it('without a manifest the Rig extras drive the pelvis rule and head top; manifest values win over extras', async () => {
    const rigExtras = { castBody: 'walker', pelvisRest: [0, 0.7, 0], pelvisScale: 1.0, seatPelvisOffset: [0, 0.02, 0], lyingOffset: [0, 0, 0], headTop: 1.9 };
    const noManifest = harness({ manifest: 'missing', fixture: { rigExtras } });
    const a = noManifest.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(noManifest);
    a.setAnim('sit');
    step(a, 0.6);
    expect(worldY(a, 'pelvis')).toBeCloseTo(DIM.SEAT_HEIGHT + 0.02, 3); // seatPelvisOffset from the extras
    a.setAnim('idle');
    step(a, 0.6);
    a.root.updateMatrixWorld(true);
    const restTop = a.headTop(new THREE.Vector3()).y;
    expect(restTop).toBeGreaterThan(1.85); // headTop 1.9 (+ clearance), not the measured box top
    noManifest.f.dispose();
    const withManifest = harness({
      fixture: { rigExtras },
      manifest: { bodies: [{ id: 'walker', seatPelvisOffset: [0, -0.01, 0], headTop: 1.6 }] },
    });
    const b = withManifest.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(withManifest);
    b.setAnim('sit');
    step(b, 0.6);
    expect(worldY(b, 'pelvis')).toBeCloseTo(DIM.SEAT_HEIGHT - 0.01, 3);
    b.setAnim('idle');
    step(b, 0.6);
    expect(b.headTop(new THREE.Vector3()).y).toBeLessThan(1.75);
    withManifest.f.dispose();
  });

  it('per-body manifest carryAnchors replace zombie.glb anchors (sitEat plate on the left hand at the new offset)', async () => {
    const m = new THREE.Matrix4().makeTranslation(0.01, 0.2, 0.03);
    const h = harness({
      manifest: { bodies: [{ id: 'walker', carryAnchors: { sitEat: { items: ['plate'], bone: 'hand_L', matrix: m.toArray(), variant: 'centered' } } }] },
    });
    const r = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    r.setCarry('plate');
    r.setAnim('sitEat');
    const plate = r.root.getObjectByName('carry_plate')!;
    expect(plate.parent?.name).toBe('hand_L');
    expect(plate.position.y).toBeCloseTo(0.2, 6);
    expect(r.root.getObjectByName('carry_fork')).toBeUndefined(); // this body's anchor has no extra
    h.f.dispose();
  });
});

describe('talking on a jawless body', () => {
  it('nods the head while talking (vs an identical silent twin) and leaves no residue once it stops', async () => {
    const h = harness({ fixture: { omitBones: ['jaw'] } });
    const talker = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    const twin = h.f.create(look('walker'), limbs()) as ZombieRigDebug;
    await settled(h);
    for (const r of [talker, twin]) r.setAnim('sitTalk');
    talker.setTalking(true);
    const headOf = (r: ZombieRigDebug) => r.root.getObjectByName('head')!.quaternion;
    let maxDev = 0;
    for (let i = 0; i < 60; i++) {
      talker.update(1 / 30);
      twin.update(1 / 30);
      maxDev = Math.max(maxDev, headOf(talker).angleTo(headOf(twin)));
    }
    expect(maxDev).toBeGreaterThan(0.01);
    expect(maxDev).toBeLessThan(0.08);
    talker.setTalking(false);
    for (let i = 0; i < 60; i++) {
      talker.update(1 / 30);
      twin.update(1 / 30);
    }
    expect(headOf(talker).angleTo(headOf(twin))).toBeLessThan(1e-3);
    h.f.dispose();
  });
});
