/**
 * Agent pose interpolation between simulation ticks. Pure + allocation free.
 */
import { angleDelta, wrapAngle } from '../core/math';

/** Positions further apart than this in one tick are teleports (spawn, despawn, cheats) → snap, don't glide. */
export const TELEPORT_DISTANCE = 3;

/** Interpolation factor sanitiser: NaN/garbage → 1 (show the newest tick), clamped to [0,1]. */
export function sanitizeAlpha(alpha: unknown): number {
  if (typeof alpha !== 'number' || Number.isNaN(alpha)) return 1;
  if (alpha <= 0) return 0;
  if (alpha >= 1) return 1;
  return alpha;
}

/** Interpolate an angle along the shortest arc; result wrapped into [-PI, PI). */
export function lerpAngle(from: number, to: number, t: number): number {
  const f = Number.isFinite(from) ? from : Number.isFinite(to) ? to : 0;
  const g = Number.isFinite(to) ? to : f;
  const k = sanitizeAlpha(t);
  return wrapAngle(f + angleDelta(f, g) * k);
}

export interface AgentPose {
  x: number;
  y: number;
  z: number;
  facing: number;
  /** False when the inputs were unusable (keep the previous pose). */
  valid: boolean;
}

export function createAgentPose(): AgentPose {
  return { x: 0, y: 0, z: 0, facing: 0, valid: false };
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

interface V2Like {
  x: number;
  z: number;
}

/**
 * prevPos → pos by alpha, prevFacing → facing along the shortest arc, root height = posY.
 * Missing/NaN previous values fall back to the current ones; a missing current pos yields valid=false.
 */
export function interpolateAgentPose(
  prevPos: V2Like | null | undefined,
  pos: V2Like | null | undefined,
  prevFacing: unknown,
  facing: unknown,
  posY: unknown,
  alpha: unknown,
  out: AgentPose,
): AgentPose {
  const a = sanitizeAlpha(alpha);
  const cx = pos && isNum(pos.x) ? pos.x : NaN;
  const cz = pos && isNum(pos.z) ? pos.z : NaN;
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
    out.valid = false;
    return out;
  }
  let px = prevPos && isNum(prevPos.x) ? prevPos.x : cx;
  let pz = prevPos && isNum(prevPos.z) ? prevPos.z : cz;
  if (Math.hypot(cx - px, cz - pz) > TELEPORT_DISTANCE) {
    px = cx;
    pz = cz;
  }
  out.x = px + (cx - px) * a;
  out.z = pz + (cz - pz) * a;
  out.y = isNum(posY) ? posY : 0;
  const f1 = isNum(facing) ? facing : isNum(prevFacing) ? prevFacing : 0;
  const f0 = isNum(prevFacing) ? prevFacing : f1;
  out.facing = lerpAngle(f0, f1, a);
  out.valid = true;
  return out;
}

/**
 * Speed (tiles per game minute) that ZombieRig.setMoveSpeed(1) corresponds to. The rig contract (and
 * ASSETS-CHARACTERS) define scale = actualSpeed / 1.3 for every locomotion clip (limp/crawl clips are authored
 * for that convention), so all three share the same reference.
 */
export function nominalMoveSpeed(anim: string): number {
  switch (anim) {
    case 'walk':
    case 'limp':
    case 'crawl':
      return 1.3;
    default:
      return 0;
  }
}

/**
 * Walk-cycle speed scale for the rig from the measured on-screen speed (tiles per real second at the current
 * game speed): actualSpeed / 1.3. Non-locomotion anims always get 1.
 */
export function moveSpeedScale(anim: string, measuredTilesPerSec: number): number {
  const nominal = nominalMoveSpeed(anim);
  if (nominal <= 0) return 1;
  if (!Number.isFinite(measuredTilesPerSec) || measuredTilesPerSec <= 0) return 0;
  const s = measuredTilesPerSec / nominal;
  return s > 6 ? 6 : s;
}
