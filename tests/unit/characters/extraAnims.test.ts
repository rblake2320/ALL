/**
 * W-056: runtime support for EXTRA_ANIM_STATES (src/shared/appearance.ts).
 *  - planning: an extra plays its own clip when the loaded set has it, else EXTRA_ANIM_FALLBACK; missing-limb
 *    substitution / mirroring then apply to whichever state plays;
 *  - classic rig on the shipped zombie.glb (no extras yet): every extra plays its fallback;
 *  - classic rig on a synthetic zombie.glb that carries extra clips: the real clip plays (pose-checked), extra
 *    one-shots hold their last frame, seat-contact extras keep their seat at any height scale;
 *  - cast bodies inherit extras from zombie.glb (shared-clip rule) and may bake their own.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  ANIM_STATES, EXTRA_ANIM_FALLBACK, EXTRA_ANIM_STATES, EXTRA_ONE_SHOT_STATES, defaultAppearance, intactLimbs,
} from '../../../src/shared/appearance';
import type { AnyAnimState, ExtraAnimState, LimbState } from '../../../src/shared/appearance';
import { DIM } from '../../../src/shared/dimensions';
import { createCharacterFactory } from '../../../src/render/characters/index';
import type { ZombieRigDebug } from '../../../src/render/characters/index';
import {
  EXTRA_SEATED_ANIMS, LOCOMOTION_ANIMS, OFF_FEET_ANIMS, ONE_SHOT_ANIMS, RIGHT_HANDED_ANIMS, SEATED_ANIMS,
  effectiveAnim, heightScale, resolveAnim, sanitizeAnim, sanitizeAnyAnim, seatContactHeight,
} from '../../../src/render/characters/plan';
import { retargetClip } from '../../../src/render/characters/cast';
import type { RetargetInfo } from '../../../src/render/characters/cast';
import { castGltf } from './castFixture';
import { loadGltf } from './helpers';
import { AgentManager } from '../../../src/render/agents/agents';
import { FxSystem } from '../../../src/render/fx/fx';
import { ThrottledWarn } from '../../../src/render/core/diagnostics';
import type { CharacterFactory, ZombieRig } from '../../../src/render/contracts';
import type { AgentState, WorldState } from '../../../src/sim/types';

const quiet = () => undefined;
const step = (rig: { update(dt: number): void }, sec: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(sec / dt); i++) rig.update(dt);
};
const limbs = (p: Partial<LimbState>): LimbState => ({ ...intactLimbs(), ...p });
const ALL: (n: string) => boolean = () => true;
const CORE = new Set<string>(ANIM_STATES);

// ───────────────────────────── synthetic clips
const Q_SELFIE = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.7, 0));
const Q_JUMP_A = new THREE.Quaternion();
const Q_JUMP_B = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0.3));
const Q_SAW = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, 0.25, 0.4));

/** Constant-pose clip: `bone` held at `q`, every other track copied from `base` (so the body stays plausible). */
function heldClip(name: string, base: THREE.AnimationClip, bone: string, q: THREE.Quaternion): THREE.AnimationClip {
  const tracks = base.tracks.filter((t) => t.name !== `${bone}.quaternion`).map((t) => t.clone());
  tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, base.duration], [...q.toArray(), ...q.toArray()]));
  return new THREE.AnimationClip(name, base.duration, tracks);
}

function renamed(name: string, base: THREE.AnimationClip): THREE.AnimationClip {
  return new THREE.AnimationClip(name, base.duration, base.tracks.map((t) => t.clone()));
}

/** Extra clips authored on the zombie rig, the way Astra's 80-clip GLB carries them (same bone names). */
function extraClips(src: readonly THREE.AnimationClip[]): THREE.AnimationClip[] {
  const by = (n: string) => src.find((c) => c.name === n)!;
  const idle = by('idle');
  const jump = new THREE.AnimationClip('jump', 1.6, [
    new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 1.6], [...Q_JUMP_A.toArray(), ...Q_JUMP_B.toArray()]),
  ]);
  return [
    heldClip('selfie', idle, 'head', Q_SELFIE),
    jump,
    heldClip('saw', idle, 'upperarm_R', Q_SAW),
    renamed('drive', by('sit')),
    renamed('rideBike', by('sit')),
  ];
}

/** Fresh parse of zombie.glb with extra clips appended (a synthetic "80-clip" GLB). */
async function gltfWithExtras(): Promise<GLTF> {
  const g = await loadGltf(true);
  g.animations = [...g.animations, ...extraClips(g.animations)];
  return g;
}

async function factory(gltf: GLTF | Promise<GLTF>) {
  const f = createCharacterFactory({ baseUrl: '/assets/', gltf, warn: quiet });
  await f.ready;
  return f;
}

function boneQ(rig: ZombieRigDebug, name: string): THREE.Quaternion {
  return rig.root.getObjectByName(name)!.quaternion.clone();
}

const close = (a: THREE.Quaternion, b: THREE.Quaternion, eps = 1e-3) => Math.abs(a.dot(b)) > 1 - eps;

// ───────────────────────────── planning (pure)
describe('W-056 planning: extras resolve to their clip or EXTRA_ANIM_FALLBACK', () => {
  it('without the clip, every one of the 35 extras plays its core fallback', () => {
    expect(EXTRA_ANIM_STATES).toHaveLength(35);
    for (const s of EXTRA_ANIM_STATES) {
      expect(effectiveAnim(s), s).toBe(EXTRA_ANIM_FALLBACK[s]);
      expect(resolveAnim(s, intactLimbs()).clip, s).toBe(EXTRA_ANIM_FALLBACK[s]);
      expect(CORE.has(resolveAnim(s, intactLimbs()).clip), s).toBe(true);
    }
  });

  it('with the clip present, every extra plays itself (intact limbs, never mirrored)', () => {
    for (const s of EXTRA_ANIM_STATES) {
      expect(resolveAnim(s, intactLimbs(), ALL), s).toEqual({ clip: s, mirror: false, timeScale: 1 });
    }
  });

  it('availability is asked per state: only the extras the GLB has play, the rest fall back', () => {
    const have = new Set<string>(['selfie', 'dig']);
    const has = (n: string) => have.has(n);
    expect(resolveAnim('selfie', intactLimbs(), has).clip).toBe('selfie');
    expect(resolveAnim('dig', intactLimbs(), has).clip).toBe('dig');
    expect(resolveAnim('fishCast', intactLimbs(), has).clip).toBe('wave');
    // core states never consult the predicate
    let asked = 0;
    resolveAnim('wave', intactLimbs(), () => (asked++, false));
    expect(asked).toBe(0);
  });

  it('adversarial: unknown / non-string / prototype names read as idle; a throwing or non-boolean predicate falls back', () => {
    for (const v of ['moonwalk', '', 'toString', '__proto__', 'constructor', 'SELFIE', null, undefined, 3, {}, ['jump']]) {
      expect(sanitizeAnyAnim(v)).toBe('idle');
      expect(resolveAnim(v, intactLimbs(), ALL).clip).toBe('idle');
    }
    expect(resolveAnim('selfie', intactLimbs(), () => { throw new Error('boom'); }).clip).toBe('phone');
    expect(resolveAnim('selfie', intactLimbs(), (() => 1) as unknown as (n: string) => boolean).clip).toBe('phone');
    // the core-only API is unchanged: sanitizeAnim still rejects extras
    expect(sanitizeAnim('selfie')).toBe('idle');
    expect(sanitizeAnyAnim('selfie')).toBe('selfie');
  });

  it('missing-limb substitution applies to the fallback when the clip is missing', () => {
    // selfie -> phone (right-handed): mirrored when the right arm is gone
    expect(resolveAnim('selfie', limbs({ armR: 'missing' }))).toMatchObject({ clip: 'phone', mirror: true });
    // chase -> walk -> limp with one leg, crawl with none
    expect(resolveAnim('chase', limbs({ legR: 'missing' }))).toMatchObject({ clip: 'limp', mirror: true });
    expect(resolveAnim('chase', limbs({ legL: 'missing', legR: 'missing' }))).toMatchObject({ clip: 'crawl', timeScale: 1 });
    // drive -> sit stays seated without legs
    expect(resolveAnim('drive', limbs({ legL: 'missing', legR: 'missing' }))).toMatchObject({ clip: 'sit' });
  });

  it('missing-limb substitution + mirroring apply to the extra clip itself when present', () => {
    const legless = limbs({ legL: 'missing', legR: 'missing' });
    // upright extras crawl (slowly unless travelling)
    expect(resolveAnim('selfie', legless, ALL)).toEqual({ clip: 'crawl', mirror: false, timeScale: 0.35 });
    expect(resolveAnim('jump', legless, ALL)).toEqual({ clip: 'crawl', mirror: false, timeScale: 0.35 });
    expect(resolveAnim('chase', legless, ALL)).toEqual({ clip: 'crawl', mirror: false, timeScale: 1 });
    // off-feet extras keep playing (seats, saddles, the vehicle entry)
    for (const s of ['drive', 'row', 'playKeys', 'rideBike', 'rideMoped', 'swing', 'enterVehicle'] as const) {
      expect(resolveAnim(s, legless, ALL).clip, s).toBe(s);
    }
    // one leg: chase limps (mirrored for the right leg), like walk
    expect(resolveAnim('chase', limbs({ legL: 'missing' }), ALL)).toMatchObject({ clip: 'limp', mirror: false });
    expect(resolveAnim('chase', limbs({ legR: 'missing' }), ALL)).toMatchObject({ clip: 'limp', mirror: true });
    // right-handed extras mirror onto the left arm; never when both arms are gone or the right is a prosthetic
    expect(resolveAnim('saw', limbs({ armR: 'missing' }), ALL)).toEqual({ clip: 'saw', mirror: true, timeScale: 1 });
    expect(resolveAnim('saw', limbs({ armR: 'missing', armL: 'missing' }), ALL)).toMatchObject({ mirror: false });
    expect(resolveAnim('saw', limbs({ armR: 'prosthetic' }), ALL)).toMatchObject({ mirror: false });
    // two-handed extras are never mirrored
    expect(resolveAnim('officiate', limbs({ armR: 'missing' }), ALL)).toMatchObject({ clip: 'officiate', mirror: false });
  });

  it('classification: extra one-shots, locomotion, seat contacts', () => {
    for (const s of EXTRA_ONE_SHOT_STATES) expect(ONE_SHOT_ANIMS.has(s), s).toBe(true);
    for (const s of EXTRA_ANIM_STATES) {
      if (!EXTRA_ONE_SHOT_STATES.includes(s)) expect(ONE_SHOT_ANIMS.has(s), s).toBe(false);
      // fallbacks are never one-shots, so a looping extra keeps looping while its clip is missing
      expect(ONE_SHOT_ANIMS.has(EXTRA_ANIM_FALLBACK[s]), `${s} -> ${EXTRA_ANIM_FALLBACK[s]}`).toBe(false);
    }
    expect(LOCOMOTION_ANIMS.has('chase')).toBe(true);
    for (const s of EXTRA_SEATED_ANIMS) {
      expect(SEATED_ANIMS.has(s)).toBe(true);
      expect(seatContactHeight(s)).toBe(DIM.SEAT_HEIGHT);
    }
    expect(seatContactHeight('sit')).toBe(DIM.SEAT_HEIGHT);
    expect(seatContactHeight('rideBike')).toBeCloseTo(0.72, 6);
    expect(seatContactHeight('rideMoped')).toBeCloseTo(0.62, 6);
    expect(seatContactHeight('swing')).toBeCloseTo(0.64, 6);
    for (const s of ['idle', 'walk', 'sleep', 'jump', 'enterVehicle', 'pray'] as const) expect(seatContactHeight(s), s).toBe(0);
    // every classified name is a real state
    const any = new Set<string>([...ANIM_STATES, ...EXTRA_ANIM_STATES]);
    for (const set of [ONE_SHOT_ANIMS, LOCOMOTION_ANIMS, SEATED_ANIMS, OFF_FEET_ANIMS, RIGHT_HANDED_ANIMS]) {
      for (const s of set) expect(any.has(s), s).toBe(true);
    }
  });
});

// ───────────────────────────── classic rig, shipped GLB
describe('W-056 classic rig on the shipped zombie.glb', () => {
  it('the shipped GLB carries no extras yet (this suite must be revisited when the 80-clip GLB lands)', async () => {
    const g = await loadGltf();
    const names = new Set(g.animations.map((a) => a.name));
    const present = EXTRA_ANIM_STATES.filter((s) => names.has(s));
    // documents the expectation of the fallback test below; with extras shipped it simply covers fewer states
    expect(present.length === 0 || present.length === EXTRA_ANIM_STATES.length).toBe(true);
  });

  it('every extra plays its fallback (or its own clip once shipped), never idle by accident, never throws', async () => {
    const g = await loadGltf();
    const names = new Set(g.animations.map((a) => a.name));
    const f = await factory(g);
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(rig.kind).toBe('gltf');
    for (const s of EXTRA_ANIM_STATES) {
      rig.setAnim(s);
      step(rig, 0.3);
      const want = names.has(s) ? s : EXTRA_ANIM_FALLBACK[s];
      expect(rig.stats().clip, s).toBe(want);
    }
    rig.dispose();
    f.dispose();
  });

  it('the capsule fallback rig (no GLB) poses extras as their fallback', async () => {
    const f = createCharacterFactory({ baseUrl: '/nope/', load: () => Promise.reject(new Error('404')), warn: quiet });
    await f.ready;
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    expect(rig.kind).toBe('fallback');
    for (const s of EXTRA_ANIM_STATES) {
      rig.setAnim(s);
      step(rig, 0.1);
      expect(rig.stats().clip, s).toContain(EXTRA_ANIM_FALLBACK[s]);
    }
    rig.dispose();
    f.dispose();
  });
});

// ───────────────────────────── classic rig, synthetic GLB with extras
describe('W-056 classic rig on a GLB that carries extra clips', () => {
  it('plays the real extra clip (pose-checked), and its fallback once the request changes to one without a clip', async () => {
    const f = await factory(gltfWithExtras());
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    rig.setAnim('selfie');
    step(rig, 1);
    expect(rig.stats().clip).toBe('selfie');
    expect(close(boneQ(rig, 'head'), Q_SELFIE)).toBe(true);
    rig.setAnim('fishCast'); // not in this GLB -> wave
    step(rig, 1);
    expect(rig.stats().clip).toBe('wave');
    expect(close(boneQ(rig, 'head'), Q_SELFIE)).toBe(false);
    rig.dispose();
    f.dispose();
  });

  it('extra one-shots hold their last frame (jump), looping extras keep looping', async () => {
    const f = await factory(gltfWithExtras());
    const rig = f.create(defaultAppearance(), intactLimbs()) as ZombieRigDebug;
    rig.setAnim('jump');
    step(rig, 4); // 2.5x the clip length
    expect(rig.stats().clip).toBe('jump');
    expect(close(boneQ(rig, 'head'), Q_JUMP_B)).toBe(true);
    const fades = (rig.impl as unknown as { activeClips(): { clip: string; effective: number }[] }).activeClips();
    expect(fades).toEqual([expect.objectContaining({ clip: 'jump' })]);
    expect(fades[0].effective).toBeCloseTo(1, 6);
    rig.dispose();
    f.dispose();
  });

  it('mirrors a right-handed extra onto the left arm when the right arm is missing', async () => {
    const f = await factory(gltfWithExtras());
    const rig = f.create(defaultAppearance(), limbs({ armR: 'missing' })) as ZombieRigDebug;
    rig.setAnim('saw');
    step(rig, 1);
    expect(rig.stats().clip).toBe('saw (mirrored)');
    // mirror rule: (x, y, z, w) -> (x, -y, -z, w) onto the opposite bone
    const m = new THREE.Quaternion(Q_SAW.x, -Q_SAW.y, -Q_SAW.z, Q_SAW.w);
    expect(close(boneQ(rig, 'upperarm_L'), m)).toBe(true);
    rig.dispose();
    f.dispose();
  });

  it('legless zombies crawl instead of upright extras but keep seat extras', async () => {
    const f = await factory(gltfWithExtras());
    const rig = f.create(defaultAppearance(), limbs({ legL: 'missing', legR: 'missing' })) as ZombieRigDebug;
    rig.setAnim('selfie');
    step(rig, 0.5);
    expect(rig.stats().clip).toBe('crawl');
    rig.setAnim('drive');
    step(rig, 0.5);
    expect(rig.stats().clip).toBe('drive');
    // limbs restored mid-request: the stored extra request replays as itself
    rig.setAnim('selfie');
    rig.setLimbs(intactLimbs());
    step(rig, 0.5);
    expect(rig.stats().clip).toBe('selfie');
    rig.dispose();
    f.dispose();
  });

  it('seat-contact extras keep their seat at any height scale (chair seat for drive, saddle for rideBike)', async () => {
    const f = await factory(gltfWithExtras());
    for (const height of [0, 1]) {
      const rig = f.create({ ...defaultAppearance(), height }, intactLimbs()) as ZombieRigDebug;
      const inner = rig.root.getObjectByName('ZombieModel')!;
      const s = heightScale(height);
      for (const [anim, h] of [['drive', DIM.SEAT_HEIGHT], ['rideBike', 0.72], ['jump', 0]] as [AnyAnimState, number][]) {
        rig.setAnim(anim);
        step(rig, 1);
        expect(inner.position.y, `${anim} @ height ${height}`).toBeCloseTo(h * (1 - s), 6);
      }
      rig.dispose();
    }
    f.dispose();
  });
});

// ───────────────────────────── cast bodies
describe('W-056 cast bodies inherit extras (shared-clip rule)', () => {
  async function castRig(classic: GLTF | Promise<GLTF>, loadCast: () => Promise<GLTF> = () => castGltf()) {
    const f = createCharacterFactory({
      baseUrl: '/assets/', gltf: classic, warn: quiet, loadCast, loadCastManifest: async () => ({ version: 1, bodies: [] }),
    });
    await f.ready;
    const rig = f.create({ ...defaultAppearance(), body: 'walker' }, intactLimbs()) as ZombieRigDebug;
    await f.castSettled();
    expect(rig.kind).toBe('cast');
    return { f, rig };
  }

  it('a cast body plays zombie.glb\'s extra clip, retargeted (pose-checked)', async () => {
    const { f, rig } = await castRig(gltfWithExtras());
    rig.setAnim('selfie');
    step(rig, 1);
    expect(rig.stats().clip).toBe('selfie');
    expect(close(boneQ(rig, 'head'), Q_SELFIE)).toBe(true); // fixture rests equal zombie.glb's: retarget is a no-op
    rig.setAnim('jump');
    step(rig, 4);
    expect(close(boneQ(rig, 'head'), Q_JUMP_B)).toBe(true);
    rig.setLimbs(limbs({ armR: 'missing' }));
    rig.setAnim('saw');
    step(rig, 1);
    expect(rig.stats().clip).toBe('saw (mirrored)');
    rig.dispose();
    f.dispose();
  });

  it('with the shipped GLB (no extras) a cast body plays every fallback', async () => {
    const g = await loadGltf();
    const names = new Set(g.animations.map((a) => a.name));
    const { f, rig } = await castRig(g);
    for (const s of EXTRA_ANIM_STATES) {
      rig.setAnim(s as ExtraAnimState);
      step(rig, 0.2);
      expect(rig.stats().clip, s).toBe(names.has(s) ? s : EXTRA_ANIM_FALLBACK[s]);
    }
    rig.dispose();
    f.dispose();
  });

  it('an extra clip baked into the cast GLB plays even when zombie.glb lacks it', async () => {
    const g = await loadGltf();
    if (g.animations.some((a) => a.name === 'selfie')) return; // shipped extras: covered by the tests above
    const { f, rig } = await castRig(g, async () => {
      const c = await castGltf();
      const idle = (await loadGltf()).animations.find((a) => a.name === 'idle')!;
      c.animations = [...c.animations, heldClip('selfie', idle, 'head', Q_SELFIE)];
      return c;
    });
    rig.setAnim('selfie');
    step(rig, 1);
    expect(rig.stats().clip).toBe('selfie');
    expect(close(boneQ(rig, 'head'), Q_SELFIE)).toBe(true);
    rig.dispose();
    f.dispose();
  });
});

describe('W-056 cast pelvis retarget for seat-contact extras', () => {
  const q = new THREE.Quaternion();
  // a manifest rule that lists only the core sit clips (as manifest.cast.json does)
  const info: RetargetInfo = {
    castRest: new Map([['spine', q]]), zombieRest: new Map([['spine', q]]),
    zombiePelvis: [0, 0.66, 0], castPelvis: [0, 0.8, 0.01], pelvisScale: 1.2,
    seatPelvisOffset: [0, 0, 0.02], lyingOffset: [0, 0.05, 0], sitClips: new Set(['sit']),
  };
  const clip = (name: string, y: number) => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('pelvis.position', [0], [0.1, y, 0]),
  ]);
  const bones = new Set(['pelvis']);
  const pelvis = (name: string, y: number) => Array.from(retargetClip(clip(name, y), info, bones).tracks[0].values).map((v) => +v.toFixed(6));

  it('seat extras keep the seat absolute (p + seatPelvisOffset) even when the manifest lists only core sit clips', () => {
    for (const [name, y] of [['drive', DIM.SEAT_HEIGHT], ['row', DIM.SEAT_HEIGHT], ['playKeys', DIM.SEAT_HEIGHT], ['rideBike', 0.72], ['rideMoped', 0.62], ['swing', 0.64]] as const) {
      expect(pelvis(name, y), name).toEqual([0.1, y, 0.02]);
    }
  });

  it('standing extras use the upright rule (Pc + (p - P0) * s)', () => {
    for (const name of ['jump', 'selfie', 'enterVehicle']) expect(pelvis(name, 0.7), name).toEqual([0.12, 0.848, 0.01]);
  });
});

// ───────────────────────────── agent bridge (render/agents/agents.ts)
describe('W-056 agent bridge forwards extra states to the rig', () => {
  function recordingFactory(log: string[]): CharacterFactory {
    return {
      ready: Promise.resolve(),
      progress: () => 1,
      create(): ZombieRig {
        const root = new THREE.Group();
        return {
          root, setAppearance() {}, setLimbs() {}, setDecay() {}, setExpression() {}, setTalking() {}, setCarry() {},
          setHighlight() {}, setMoveSpeed() {}, update() {}, dispose() {},
          setAnim(s: AnyAnimState) { log.push(s); },
          headTop: (out: THREE.Vector3) => out.set(0, 1.78, 0),
        };
      },
      dispose() {},
    };
  }
  const agentWith = (anim: unknown): AgentState => ({
    id: 'z1', presence: 'onLot', appearance: defaultAppearance(), limbs: intactLimbs(), pos: { x: 3, z: 3 },
    prevPos: { x: 3, z: 3 }, posY: 0, facing: 0, prevFacing: 0, anim, expression: 'neutral', carrying: null,
    needs: { hunger: 80, energy: 80, preservation: 70, social: 50, fun: 50, hygiene: 50 },
  }) as unknown as AgentState;
  const EXTRA = new Set<string>(EXTRA_ANIM_STATES);

  it('every extra state in AgentState.anim reaches setAnim unchanged; unknown / prototype / non-string names read as idle', () => {
    const log: string[] = [];
    const atlas = () => ({ width: 64, height: 64 }) as unknown as HTMLCanvasElement;
    const fx = new FxSystem({ particleCapacity: 16, particleScale: 1 }, atlas);
    const am = new AgentManager(recordingFactory(log), fx, new ThrottledWarn(1e9, () => 0));
    const agents: Record<string, AgentState> = {};
    const state = { tick: 0, agents, objects: {} } as unknown as WorldState;
    const seq: unknown[] = [
      ...EXTRA_ANIM_STATES, 'walk', 'jump', 'notAState', 'idle', 'constructor', '__proto__', 'selfie', 42, null, 'toString',
    ];
    const expected: string[] = [];
    let prev = 'idle'; // a fresh entry starts by playing idle
    for (const anim of seq) {
      agents.z1 = agentWith(anim);
      am.sync(state, 1, 1 / 60);
      const want = typeof anim === 'string' && (CORE.has(anim) || EXTRA.has(anim)) ? anim : 'idle';
      if (want !== prev) expected.push(want);
      prev = want;
    }
    expect(log.filter((s, i) => !(i === 0 && s === 'idle'))).toEqual(expected);
    expect(log.filter((s) => EXTRA.has(s)).length).toBe(EXTRA_ANIM_STATES.length + 2);
    expect(log.every((s) => CORE.has(s) || EXTRA.has(s))).toBe(true);
    am.dispose();
    fx.dispose();
  });
});
