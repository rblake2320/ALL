/**
 * CLIP-AUDIT character harness: the REAL runtime character factory (src/render/characters, GltfRig / CastRig with
 * every runtime layer - retargeted cast clips, seat-height offset, height scale, mood posture, carry hold blend,
 * carry anchors, limb collapse, mirrored clips) driven headless in Node, posed at an exact clip time and CPU-skinned
 * into world-space soups (body, carried item, anchor extra prop).
 *
 * Exact-time sampling reaches into the rig implementation's private `actions` map (pinned by
 * tests/unit/clip-audit/harness.test.ts, so a refactor that renames it fails loudly instead of silently sampling
 * the wrong frame).
 */
import * as THREE from 'three';
import { createCharacterFactory } from '../../src/render/characters/index';
import type { ZombieRigDebug } from '../../src/render/characters/index';
import { defaultAppearance, intactLimbs } from '../../src/shared/appearance';
import type { AnimState, CarryItem, Expression, LimbState, ZombieAppearance } from '../../src/shared/appearance';
import type { BodyId } from '../../src/shared/cast';
import type { PremiumDetail } from '../../src/shared/premiumBodies';
import { assetPath, loadGlb, parseGlb, readJson } from './assets';
import { readFileSync } from 'node:fs';
import { extractMeshes } from './assets';
import type { TriMesh } from './geometry';

export type Factory = ReturnType<typeof createCharacterFactory>;

const factories = new Map<PremiumDetail, Factory>();
const loadedPaths = new Map<PremiumDetail, Set<string>>();
const warnings: string[] = [];

/** Separate real runtime factories for each premium quality; pools must not reuse a high rig for a low look. */
export function auditFactory(detail: PremiumDetail = 'high'): Factory {
  const cached = factories.get(detail);
  if (cached) return cached;
  const paths = new Set<string>();
  loadedPaths.set(detail, paths);
  const factory = createCharacterFactory({
    baseUrl: '/assets/',
    gltf: loadGlb('models/characters/zombie.glb'),
    warn: (m) => warnings.push(m),
    loadCast: async (url) => { paths.add(url); return parseGlb(readFileSync(assetPath(url))); },
    loadCastManifest: async (url) => readJson(url.endsWith('manifest.premium.json') ? 'manifest.premium.json' : 'manifest.cast.json'),
    premiumDetail: () => detail,
  });
  factories.set(detail, factory);
  return factory;
}

/** Exact loader requests, used to reject fallback or mislabeled quality coverage in the gate tests. */
export function factoryLoadedPaths(detail: PremiumDetail): readonly string[] {
  return [...(loadedPaths.get(detail) ?? [])];
}

export function factoryWarnings(): readonly string[] {
  return warnings;
}

export interface Look {
  body: BodyId;
  /** appearance.height 0..1 (classic 0.88..1.08 scale, cast 0.94..1.06). */
  height: number;
  detail?: PremiumDetail;
  /** Classic-only outfit overrides. */
  app?: Partial<ZombieAppearance>;
  limbs?: Partial<LimbState>;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  facing: number;
}

export interface Act {
  anim: AnimState;
  expression?: Expression;
  carry?: CarryItem | null;
}

interface RigInternals {
  actions: Map<string, THREE.AnimationAction>;
  carryObj: THREE.Object3D | null;
  extraObj: THREE.Object3D | null;
}

export interface LiveRig {
  rig: ZombieRigDebug;
  key: string;
}

const pool = new Map<string, LiveRig>();

function appearanceFor(look: Look): ZombieAppearance {
  return { ...defaultAppearance(), ...(look.app ?? {}), height: look.height, body: look.body };
}

/** A rig for `look` (pooled per slot; `slot` lets two rigs of the same body coexist for social pairs). */
export async function rigFor(look: Look, slot = 'A'): Promise<LiveRig> {
  const f = auditFactory(look.detail);
  await f.ready;
  const key = `${look.body}|${look.detail ?? 'high'}|${slot}`;
  let lr = pool.get(key);
  const app = appearanceFor(look);
  const limbs = { ...intactLimbs(), ...(look.limbs ?? {}) };
  if (!lr) {
    const rig = f.create(app, limbs) as ZombieRigDebug;
    await f.castSettled();
    lr = { rig, key };
    pool.set(key, lr);
  }
  lr.rig.setAppearance(app);
  lr.rig.setLimbs(limbs);
  if (lr.rig.body !== look.body) throw new Error(`rig for ${look.body} came up as ${lr.rig.body} (${lr.rig.kind})`);
  return lr;
}

export function internals(rig: ZombieRigDebug): RigInternals {
  const impl = rig.impl as unknown as Partial<RigInternals>;
  if (!(impl.actions instanceof Map)) throw new Error(`rig implementation ${rig.kind} has no private 'actions' map (harness out of date)`);
  return impl as RigInternals;
}

const WARM_STEPS = 16;
/** One-shots are held just inside their last key (the renderer's clampWhenFinished end pose). */
export const ONE_SHOT_END_EPS = 1e-4;

/**
 * Clip-local time the renderer shows `t` s into a clip of `duration`, mirroring THREE.AnimationAction._updateTime
 * for the loop mode the rig gave the action (rig.ts / castRig.ts: ONE_SHOT_ANIMS -> LoopOnce + clampWhenFinished,
 * everything else LoopRepeat): a looping clip wraps (t mod duration), a one-shot clamps to its end pose.
 */
export function auditClipTime(t: number, duration: number, loop: THREE.AnimationActionLoopStyles): number {
  if (!(duration > 0) || !Number.isFinite(t)) return 0;
  if (loop === THREE.LoopRepeat) {
    const w = t % duration;
    return w < 0 ? w + duration : w;
  }
  return Math.max(0, Math.min(t, duration - ONE_SHOT_END_EPS));
}

/**
 * The action the renderer is showing after poseRig settled: the running (or finished-and-held one-shot) action with
 * the largest weight, or null. W-120: a STOPPED action keeps its last effective weight (1 when it had been fully
 * faded in), so picking "any action with weight > 0.5" could return the previous clip (idle, 4 s) and sample past
 * the end of the one playing.
 */
export function playingAction(lr: LiveRig): THREE.AnimationAction | null {
  let best: THREE.AnimationAction | null = null;
  for (const a of internals(lr.rig).actions.values()) {
    if (!a.isRunning() && !a.paused) continue; // paused = a finished one-shot holding its end pose
    if (!best || a.getEffectiveWeight() > best.getEffectiveWeight()) best = a;
  }
  return best && best.getEffectiveWeight() > 0.5 ? best : null;
}

/** Duration (s) of the clip playingAction() shows (2 s when none settled). */
export function playingDuration(lr: LiveRig): number {
  return playingAction(lr)?.getClip().duration ?? 2;
}

/**
 * Put the rig in `act` at the root pose and settle every runtime blend (crossfade, hold-pose blend, posture
 * weights, seat-height offset) by stepping 4 s, then jump the clip to `t` seconds and evaluate once. `t` beyond the
 * clip wraps for looping clips and clamps for one-shots, exactly as the renderer's AnimationMixer plays them
 * (W-120: it used to clamp every clip, so t = 2 on the 1.6 s crawl loop showed its last frame instead of 0.4 s).
 */
export function poseRig(lr: LiveRig, act: Act, pose: Pose, t: number): void {
  const r = lr.rig;
  r.root.position.set(pose.x, pose.y, pose.z);
  r.root.rotation.set(0, pose.facing, 0);
  r.setExpression(act.expression ?? 'neutral');
  r.setCarry(act.carry ?? null);
  r.setAnim(act.anim);
  for (let i = 0; i < WARM_STEPS; i++) r.update(0.25);
  const { actions } = internals(r);
  for (const a of actions.values()) {
    if (!a.isRunning() && a.getEffectiveWeight() === 0) continue;
    a.time = auditClipTime(t, a.getClip().duration, a.loop);
  }
  r.update(1e-6);
  r.root.updateMatrixWorld(true);
}

export interface RigSample {
  body: TriMesh;
  carryAttached: boolean;
  /** Carried item (null when none). */
  item: TriMesh | null;
  /** Anchor extra prop (fork while eating). */
  extra: TriMesh | null;
  /** World positions of a few bones (diagnostics). */
  bones: Record<string, [number, number, number]>;
  clip: string;
}

const BONES_OF_INTEREST = ['pelvis', 'chest', 'head', 'hand_L', 'hand_R', 'foot_L', 'foot_R', 'prop_L', 'prop_R'];

export function sampleRig(lr: LiveRig): RigSample {
  const r = lr.rig;
  const inn = internals(r);
  const carry = inn.carryObj;
  const extra = inn.extraObj;
  r.root.updateMatrixWorld(true);
  const isProp = (o: THREE.Object3D) => o === carry || o === extra;
  const body = extractMeshes(r.root, {
    skip: isProp,
    // stump caps / pegs are static meshes under bones: label them after their parent bone
    label: (m) => (m.parent ? `${m.name || 'part'}@${m.parent.name}` : m.name),
  });
  const item = carry ? extractMeshes(carry, { label: () => 'item' }) : null;
  const ex = extra ? extractMeshes(extra, { label: () => 'extra' }) : null;
  const bones: Record<string, [number, number, number]> = {};
  const v = new THREE.Vector3();
  for (const n of BONES_OF_INTEREST) {
    const b = r.root.getObjectByName(n);
    if (b) {
      b.getWorldPosition(v);
      bones[n] = [v.x, v.y, v.z];
    }
  }
  return { body, carryAttached: carry !== null, item: item && item.tri.length ? item : null, extra: ex && ex.tri.length ? ex : null, bones, clip: r.stats().clip };
}

export function disposeRigs(): void {
  for (const lr of pool.values()) lr.rig.dispose();
  pool.clear();
  for (const f of factories.values()) f.dispose();
  factories.clear();
  loadedPaths.clear();
}
