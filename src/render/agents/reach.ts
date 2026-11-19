/**
 * Standing placement fits (pure, render only — the sim's positions are untouched): W-073 clipping audit root causes
 * "social spacing" and "work stand-off" (docs/audits/clipping-W073.md).
 *
 * The sim stands social partners on neighbouring tiles (0.5 … 1.4 m apart: runner.arriveHere stops the actor as soon
 * as it enters a neighbouring tile) and puts a zombie working at an object 0.22 m from the footprint edge
 * (faceObjectPose: approach tile centre + 0.28 toward the object). The clips lean / step forward by different amounts
 * per body (classic idle 0.31 m ahead of the root, the bear-suit mascot 0.61 m; the shared 'clean' clip bends 0.7 …
 * 1.2 m forward), so bodies went into each other and into counters.
 *
 * Every body × clip has a FRONT PROFILE (reachFit.ts, generated from the real rigs by
 * tests/unit/clip-audit/reachFit.test.ts): per 10 cm height band, how far ahead of the root the body reaches over
 * the clip ('hug' without the arms, which wrap the partner). The renderer then
 *   - socialSpacing: moves two partners facing each other apart (each by half the deficit, at most SOCIAL_PUSH_MAX)
 *     until no height band overlaps: max_b(frontA[b]·sA + frontB[b]·sB) + SOCIAL_GAP;
 *   - workStandoff: moves a zombie working at a faceObject slot back (at most WORK_STANDOFF_MAX) until no part of it
 *     below the object's top reaches past the footprint edge;
 *   - standApproach: a standing clip on a posed sit / lie / bath slot (repairing a bed or a desk — the stage targets
 *     the object's slots without a filter) is shown on the slot's first approach tile, facing the object, instead of
 *     standing inside the furniture;
 *   - lieLift: a lying clip on a 'lie' slot rests the back (LIE_FIT) on the slot's modelled surface (SlotSpec.lie)
 *     instead of the sim's pose height (the double bed's mattress is 5.5 cm above its slot pose).
 * Unknown bodies / clips get no fit.
 */
import { PHYSICAL_BY_ID, type PhysicalSpec, type SlotSpec } from '../../shared/catalog';
import { LIE_FIT, REACH_BAND, REACH_BANDS, REACH_FIT } from './reachFit';

/** Clearance kept between social partners' front profiles (m). */
export const SOCIAL_GAP = 0.02;
/** Most each partner is moved away from the other (m): about a third of a tile, so nobody is pushed through a wall. */
export const SOCIAL_PUSH_MAX = 0.35;
/** Root to the footprint edge at a faceObject slot (m): tile half (0.5) minus faceObjectPose's 0.28 step. */
export const WORK_FACE_DIST = 0.22;
/** Clearance kept in front of the object (m). */
export const WORK_MARGIN = 0.01;
/** Most a working zombie is moved back (m): back to its approach tile's centre, never out of the tile it reserved. */
export const WORK_STANDOFF_MAX = 0.28;

const decoded = new Map<string, Float32Array | null>();

/** Front profile (m per band at scale 1, NaN = empty band) of `body` playing `clip`, or null when unknown. */
export function frontProfile(body: string | undefined, clip: string): Float32Array | null {
  const b = typeof body === 'string' && body ? body : 'classic';
  const k = `${b}|${clip}`;
  let p = decoded.get(k);
  if (p !== undefined) return p;
  const row = Object.prototype.hasOwnProperty.call(REACH_FIT, b) ? REACH_FIT[b] : undefined;
  const s = row && Object.prototype.hasOwnProperty.call(row, clip) ? row[clip] : undefined;
  if (typeof s !== 'string' || s.length !== REACH_BANDS * 2) p = null;
  else {
    p = new Float32Array(REACH_BANDS);
    for (let i = 0; i < REACH_BANDS; i++) {
      const c = s.slice(i * 2, i * 2 + 2);
      p[i] = c === '..' ? NaN : parseInt(c, 36) / 100 - 1;
    }
  }
  decoded.set(k, p);
  return p;
}

/**
 * Root-to-root distance at which two bodies facing each other do not overlap in any height band (m), or null when a
 * profile is unknown. Scales are the rigs' height scales (profiles are measured at 1).
 */
export function socialSpacing(bodyA: string | undefined, clipA: string, sA: number, bodyB: string | undefined, clipB: string, sB: number): number | null {
  const a = frontProfile(bodyA, clipA);
  const b = frontProfile(bodyB, clipB);
  if (!a || !b) return null;
  const ka = Number.isFinite(sA) && sA > 0 ? sA : 1;
  const kb = Number.isFinite(sB) && sB > 0 ? sB : 1;
  let need = -Infinity;
  for (let i = 0; i < REACH_BANDS; i++) {
    const va = a[i];
    const vb = b[i];
    if (Number.isNaN(va) || Number.isNaN(vb)) continue;
    const d = va * ka + vb * kb;
    if (d > need) need = d;
  }
  return Number.isFinite(need) ? need + SOCIAL_GAP : null;
}

/** How far one partner moves away from the other (m, ≥ 0) when their roots are `dist` apart. */
export function socialPush(spacing: number | null, dist: number): number {
  if (spacing === null || !Number.isFinite(spacing) || !Number.isFinite(dist)) return 0;
  return Math.max(0, Math.min(SOCIAL_PUSH_MAX, (spacing - dist) / 2));
}

/** Height (m) below which a working body must stay behind the footprint edge: the work surface, else the model top. */
export function workTop(spec: PhysicalSpec): number {
  let top = -Infinity;
  for (const s of spec.surfaces ?? []) if (Number.isFinite(s.y) && s.y > top) top = s.y;
  return Number.isFinite(top) ? top : spec.height;
}

/**
 * Distance (m) from a standing work slot's root to the object's footprint edge along the slot's facing: WORK_FACE_DIST
 * for faceObject slots, the ray to the footprint rectangle for posed 'stand' slots outside the footprint (counters,
 * stoves: 0.22 m). null = not a standing work slot (rest slots, a shower stall's inside slot).
 */
export function workFaceDist(spec: PhysicalSpec, s: SlotSpec): number | null {
  if (s.faceObject || !s.pose) return WORK_FACE_DIST;
  if (s.kind !== 'stand') return null;
  const { w, d } = spec.footprint;
  const px = s.pose.x;
  const pz = s.pose.z;
  if (px > 0 && px < w && pz > 0 && pz < d) return null;
  const f = Number.isFinite(s.facing) ? (s.facing as number) : 0;
  const dx = Math.sin(f);
  const dz = Math.cos(f);
  // slab test against [0,w] x [0,d]
  let t0 = 0;
  let t1 = Infinity;
  for (const [o, dd, lo, hi] of [[px, dx, 0, w], [pz, dz, 0, d]] as const) {
    if (Math.abs(dd) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / dd;
    const b = (hi - o) / dd;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 >= t0 ? t0 : null;
}

/**
 * Stand-off (m, ≥ 0, back along the facing) of `body` playing `clip` at a standing work slot `face` m from an object
 * whose work surface / top is `top` high.
 */
export function workStandoff(body: string | undefined, clip: string, scale: number, top: number, face: number = WORK_FACE_DIST): number {
  const p = frontProfile(body, clip);
  if (!p || !Number.isFinite(top)) return 0;
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  let need = 0;
  for (let i = 0; i < REACH_BANDS; i++) {
    if (Number.isNaN(p[i]) || i * REACH_BAND * s >= top) continue;
    need = Math.max(need, p[i] * s - face + WORK_MARGIN);
  }
  return Math.min(WORK_STANDOFF_MAX, need);
}

/** Catalog slot `slot` of `defId` (null when unknown). */
export function catalogSlot(defId: unknown, slot: unknown): { spec: PhysicalSpec; slot: SlotSpec } | null {
  if (typeof defId !== 'string' || typeof slot !== 'number' || !Number.isInteger(slot)) return null;
  const spec = Object.prototype.hasOwnProperty.call(PHYSICAL_BY_ID, defId) ? PHYSICAL_BY_ID[defId] : undefined;
  const s = spec?.slots[slot];
  return spec && s ? { spec, slot: s } : null;
}

/** A posed slot built for a lying / seated / bathing body (a standing clip there would stand inside the furniture). */
export function isPosedRestSlot(s: SlotSpec): boolean {
  return !s.faceObject && !!s.pose && (s.kind === 'sit' || s.kind === 'lie' || s.kind === 'bath');
}

/** How far a lying back presses into the mattress / lining (m). */
export const LIE_SINK = 0.01;
/** Lie lift limits (m). */
export const LIE_LIFT_MIN = -0.05;
export const LIE_LIFT_MAX = 0.1;

/**
 * Root lift (m) for `body` (height scale `scale`) playing lying `clip` on a 'lie' slot whose modelled surface is
 * `lie.height` and whose sim pose is `poseY` high: rests the back (LIE_FIT, lowest spine / chest vertex) on the surface
 * (LIE_SINK into it). 0 for unknown clips or slots without lie geometry.
 */
export function lieLift(lie: { height: number } | undefined | null, poseY: number, body: string | undefined, clip: string, scale: number): number {
  if (!lie || !Number.isFinite(lie.height) || !Number.isFinite(poseY)) return 0;
  const key = typeof body === 'string' && body && Object.prototype.hasOwnProperty.call(LIE_FIT, body) ? body : 'classic';
  const row = LIE_FIT[key];
  const low = row && Object.prototype.hasOwnProperty.call(row, clip) ? row[clip] : undefined;
  if (low === undefined || !Number.isFinite(low)) return 0;
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.max(LIE_LIFT_MIN, Math.min(LIE_LIFT_MAX, lie.height - poseY - low * s - LIE_SINK));
}
