/**
 * CLIP-AUDIT body reach: how far a posed body (real rig, real clip, CPU-skinned) extends around its own root over a
 * clip, in the root frame (+z = the way the zombie faces, +x = its left, metres). Used for
 *   - social spacing (front reach of two partners facing each other -> the root distance at which they touch),
 *   - wall clearance (back / side reach vs the wall face 0.44 m from a tile centre),
 *   - doorways (walking half-width vs the door opening).
 * `core` excludes the arms (shoulder / upper arm / forearm / hand / prop bones): the trunk, head and legs.
 */
import { boneOf, sampleTimes } from './audit';
import { playingDuration, poseRig, rigFor, sampleRig, type Look } from './rigs';
import type { AnimState } from '../../src/shared/appearance';
import type { TriMesh } from './geometry';
import { buildMatrix } from './scenarios';
import { PHYSICAL_SPECS } from '../../src/shared/catalog';
import { isPosedRestSlot, workFaceDist } from '../../src/render/agents/reach';
import { OFF_FEET_ANIMS, castHeightScale, heightScale } from '../../src/render/characters/plan';

export interface Reach {
  /** Max z of any body vertex (m, + = ahead of the root). */
  front: number;
  /** Max z of a core (non-arm) vertex. */
  frontCore: number;
  /** Max -z (m, + = behind the root). */
  back: number;
  /** Max |x| (m). */
  half: number;
  /** Max |x| of a core vertex. */
  halfCore: number;
  /** Highest vertex (m). */
  top: number;
  /** Duration of the played clip (s) and the sample times used. */
  times: number[];
}

const ARM = /^(shoulder|upperarm|forearm|hand|prop|finger\w*)_[LR]$/;

export function isArm(label: string): boolean {
  return ARM.test(boneOf(label));
}

function extents(m: TriMesh, ox: number, oz: number, acc: Reach): void {
  const isArmLabel = m.labels.map(isArm);
  const n = m.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const x = m.pos[i * 3] - ox;
    const y = m.pos[i * 3 + 1];
    const z = m.pos[i * 3 + 2] - oz;
    const arm = isArmLabel[m.vLabel[i]];
    if (z > acc.front) acc.front = z;
    if (-z > acc.back) acc.back = -z;
    if (Math.abs(x) > acc.half) acc.half = Math.abs(x);
    if (y > acc.top) acc.top = y;
    if (!arm) {
      if (z > acc.frontCore) acc.frontCore = z;
      if (Math.abs(x) > acc.halfCore) acc.halfCore = Math.abs(x);
    }
  }
}

const R3 = (v: number) => Math.round(v * 1000) / 1000;

/** Reach of `look` playing `anim` (no carry) over `n` evenly spread clip times, root at the origin facing +z. */
export async function bodyReach(look: Look, anim: AnimState, n = 8): Promise<Reach> {
  const lr = await rigFor(look, 'R');
  const pose = { x: 0, y: 0, z: 0, facing: 0 };
  poseRig(lr, { anim, carry: null }, pose, 0);
  const dur = playingDuration(lr);
  const times = sampleTimes(dur, n);
  const acc: Reach = { front: -Infinity, frontCore: -Infinity, back: -Infinity, half: 0, halfCore: 0, top: 0, times };
  for (const t of times) {
    poseRig(lr, { anim, carry: null }, pose, t);
    const s = sampleRig(lr);
    extents(s.body, 0, 0, acc);
  }
  return { front: R3(acc.front), frontCore: R3(acc.frontCore), back: R3(acc.back), half: R3(acc.half), halfCore: R3(acc.halfCore), top: R3(acc.top), times };
}

/** Clips whose front profile drops the arms (they wrap the partner). */
export const CORE_PROFILE_CLIPS: ReadonlySet<string> = new Set(['hug']);

/**
 * Clips src/render/agents/reachFit.ts carries: every social clip of the matrix (actor + target / fail anims) and every
 * standing clip the matrix plays at a faceObject slot or on a posed rest (sit / lie / bath) slot.
 */
export function fitClips(): AnimState[] {
  const out = new Set<AnimState>();
  for (const s of buildMatrix()) {
    if (s.kind === 'pair') {
      out.add(s.a.anim);
      out.add(s.b.anim);
    } else if (s.kind === 'slot') {
      const slot = PHYSICAL_SPECS.find((p) => p.id === s.objectId)?.slots[s.slotIndex];
      if (!slot || OFF_FEET_ANIMS.has(s.act.anim)) continue;
      const spec = PHYSICAL_SPECS.find((p) => p.id === s.objectId)!;
      if (workFaceDist(spec, slot) !== null || isPosedRestSlot(slot)) out.add(s.act.anim);
    }
  }
  return [...out].sort();
}

/** Lying clips played on 'lie' slots (lie fit). */
export const LIE_CLIPS: readonly AnimState[] = ['sleep', 'beEmbalmed'];

/**
 * Mean over the clip of the lowest back vertex (spine / chest bones; m, relative to the root, height scale 1) of `look`
 * playing a lying clip: how far the back rests below (−) or above (+) the rig root. Pelvis (skirts, capes), head (the
 * big cast heads sink — see docs/contract-requests/clipping.md) and arms are not support surfaces here.
 */
export async function lyingLow(look: Look, anim: AnimState, n = 6): Promise<number> {
  const lr = await rigFor(look, 'R');
  const pose = { x: 0, y: 0, z: 0, facing: 0 };
  poseRig(lr, { anim, carry: null }, pose, 0);
  const dur = playingDuration(lr);
  const k = look.body === 'classic' ? heightScale(look.height) : castHeightScale(look.height);
  let sum = 0;
  const times = sampleTimes(dur, n);
  for (const t of times) {
    poseRig(lr, { anim, carry: null }, pose, t);
    const m = sampleRig(lr).body;
    const back = m.labels.map((l) => /^(spine|chest)$/.test(boneOf(l)));
    let lo = Infinity;
    for (let i = 0; i < m.pos.length / 3; i++) if (back[m.vLabel[i]] && m.pos[i * 3 + 1] < lo) lo = m.pos[i * 3 + 1];
    sum += lo / k;
  }
  return sum / times.length;
}

/** Height band size of a front profile (m) and the band count (0 .. 2.4 m). */
export const BAND = 0.1;
export const BANDS = 24;

/**
 * Front profile of `look` playing `anim`: per 10 cm height band, the largest z (m, ahead of the root) of a body vertex
 * in that band over `n` clip times (null = no vertex in the band). `core` drops the arms (hug: arms wrap the partner).
 * Normalised to height scale 1 (divided by the look's rig scale) — the renderer multiplies by the agent's scale.
 */
export async function frontProfile(look: Look, anim: AnimState, n = 6, core = false): Promise<(number | null)[]> {
  const lr = await rigFor(look, 'R');
  const pose = { x: 0, y: 0, z: 0, facing: 0 };
  poseRig(lr, { anim, carry: null }, pose, 0);
  const dur = playingDuration(lr);
  const prof: (number | null)[] = new Array(BANDS).fill(null);
  const k = look.body === 'classic' ? heightScale(look.height) : castHeightScale(look.height);
  for (const t of sampleTimes(dur, n)) {
    poseRig(lr, { anim, carry: null }, pose, t);
    const m = sampleRig(lr).body;
    const arm = m.labels.map(isArm);
    const nv = m.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      if (core && arm[m.vLabel[i]]) continue;
      const b = Math.max(0, Math.min(BANDS - 1, Math.floor(m.pos[i * 3 + 1] / k / BAND)));
      const z = m.pos[i * 3 + 2] / k;
      const p = prof[b];
      if (p === null || z > p) prof[b] = z;
    }
  }
  return prof;
}
