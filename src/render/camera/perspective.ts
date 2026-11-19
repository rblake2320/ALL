/**
 * Perspectives (W-136, docs/DESIGN_OPEN_WORLD.md §4.1) — pure, unit-tested.
 *
 * Three ways to look at the same scene:
 *  - `overview`    the orbit camera above the lot (cameraMath.ts / CameraRig), untouched by this file;
 *  - `shoulder`    behind and above the selected zombie, looking past it;
 *  - `firstPerson` at the zombie's eye height, looking where the player points.
 *
 * Conventions match cameraMath.ts: `yaw` is the facing angle (0 = +Z, PI/2 = +X) of the direction FROM the subject
 * TO the camera, so the camera looks along `viewDirection(yaw)`; a camera straight behind a zombie facing `f` has
 * yaw `f + PI`. `pitch` is the elevation of that same direction: positive = the camera is above and looks down.
 */
import type { Perspective } from '../contracts';
import { clamp, finiteOr, wrapAngle } from '../core/math';

export type { Perspective };
/** Cycle order (the `V` key): down from the overview to the shoulder, into the eyes, back up. */
export const PERSPECTIVES: readonly Perspective[] = ['overview', 'shoulder', 'firstPerson'];

export function isPerspective(v: unknown): v is Perspective {
  return typeof v === 'string' && (PERSPECTIVES as readonly string[]).includes(v);
}

/** The next perspective in the cycle; garbage starts the cycle again from `overview`. */
export function nextPerspective(p: unknown): Perspective {
  const i = isPerspective(p) ? PERSPECTIVES.indexOf(p) : -1;
  return PERSPECTIVES[(i + 1) % PERSPECTIVES.length];
}

export const PERSPECTIVE_LIMITS = {
  shoulder: {
    /** Pivot above the zombie's feet (upper chest), and how far the pivot sits to the zombie's right. */
    pivotY: 1.3,
    side: 0.4,
    distance: 3.2,
    distanceMin: 1.4,
    distanceMax: 6,
    pitchMin: -0.2,
    pitchMax: 1.0,
    pitchDefault: 0.28,
    fovDeg: 50,
  },
  firstPerson: {
    /** Eye height above the feet (DIM.HEAD_TOP is 1.78). */
    eyeY: 1.55,
    /** The eye sits this far in front of the body axis so the view never starts inside the head mesh. */
    forward: 0.12,
    pitchMin: -1.1,
    pitchMax: 1.1,
    pitchDefault: 0.05,
    fovDeg: 68,
  },
  /** Camera never sinks below this height. */
  floorY: 0.2,
  /** Kept between the camera and a wall it was pulled in front of. */
  wallClearance: 0.3,
  /** Seconds for a perspective change to glide (0 under Reduce motion). */
  glideSec: 0.45,
} as const;

/** A zombie's rendered pose: feet position and facing (0 = +Z, PI/2 = +X). */
export interface PerspectiveSubject {
  x: number;
  y: number;
  z: number;
  facing: number;
}

/** Far beyond any world (`WORLD_SPAN_TILES` is 2 560): a pose out here is a broken pose, not a place. */
const SUBJECT_MAX = 1e6;
const sane = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= SUBJECT_MAX;

export function validSubject(s: Partial<PerspectiveSubject> | null | undefined): s is PerspectiveSubject {
  return !!s && typeof s === 'object' && sane(s.x) && sane(s.y) && sane(s.z) && sane(s.facing);
}

/** Camera position, the point it looks at, and its vertical field of view. */
export interface ViewPose {
  x: number;
  y: number;
  z: number;
  lx: number;
  ly: number;
  lz: number;
  fovDeg: number;
}

export function emptyViewPose(): ViewPose {
  return { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: -1, fovDeg: PERSPECTIVE_LIMITS.shoulder.fovDeg };
}

/** Yaw that puts the camera straight behind a zombie with this facing. */
export function behindYaw(facing: unknown): number {
  return wrapAngle(finiteOr(facing, 0) + Math.PI);
}

export function clampViewPitch(mode: Perspective, pitch: unknown): number {
  if (mode === 'firstPerson') {
    const l = PERSPECTIVE_LIMITS.firstPerson;
    return clamp(finiteOr(pitch, l.pitchDefault), l.pitchMin, l.pitchMax);
  }
  const l = PERSPECTIVE_LIMITS.shoulder;
  return clamp(finiteOr(pitch, l.pitchDefault), l.pitchMin, l.pitchMax);
}

export function clampShoulderDistance(d: unknown): number {
  const l = PERSPECTIVE_LIMITS.shoulder;
  return clamp(finiteOr(d, l.distance), l.distanceMin, l.distanceMax);
}

/** Shoulder zoom: + delta = closer, same 12% per notch as the overview camera. */
export function zoomShoulderDistance(distance: unknown, delta: unknown): number {
  return clampShoulderDistance(clampShoulderDistance(distance) * Math.pow(0.88, clamp(finiteOr(delta, 0), -10, 10)));
}

/** Shoulder pivot: upper chest, shifted to the camera's right so the zombie does not hide what is ahead. */
export function shoulderPivot(s: PerspectiveSubject, yaw: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const l = PERSPECTIVE_LIMITS.shoulder;
  const y = finiteOr(yaw, 0);
  // camera right for a yaw (cameraMath.cameraRight)
  out.x = s.x + Math.cos(y) * l.side;
  out.y = s.y + l.pivotY;
  out.z = s.z - Math.sin(y) * l.side;
  return out;
}

/**
 * Shoulder camera: `distance` back from the pivot along (yaw, pitch), looking at the pivot. `distance` is the
 * already wall-limited distance (see `clearDistance`); it may be shorter than `distanceMin` when a wall is close.
 */
export function shoulderPose(s: PerspectiveSubject, yaw: number, pitch: number, distance: number, out: ViewPose): ViewPose {
  const l = PERSPECTIVE_LIMITS.shoulder;
  const y = finiteOr(yaw, 0);
  const p = clampViewPitch('shoulder', pitch);
  const d = clamp(finiteOr(distance, l.distance), 0.05, l.distanceMax);
  const piv = shoulderPivot(s, y, PIVOT_TMP);
  const cp = Math.cos(p);
  out.x = piv.x + Math.sin(y) * cp * d;
  out.y = Math.max(s.y + PERSPECTIVE_LIMITS.floorY, piv.y + Math.sin(p) * d);
  out.z = piv.z + Math.cos(y) * cp * d;
  out.lx = piv.x;
  out.ly = piv.y;
  out.lz = piv.z;
  out.fovDeg = l.fovDeg;
  return out;
}

/** First-person camera: at the eyes, looking along (yaw, pitch). Positive pitch looks down. */
export function firstPersonPose(s: PerspectiveSubject, yaw: number, pitch: number, out: ViewPose): ViewPose {
  const l = PERSPECTIVE_LIMITS.firstPerson;
  const y = finiteOr(yaw, 0);
  const p = clampViewPitch('firstPerson', pitch);
  const dx = -Math.sin(y);
  const dz = -Math.cos(y);
  const cp = Math.cos(p);
  out.x = s.x + dx * l.forward;
  out.y = s.y + l.eyeY;
  out.z = s.z + dz * l.forward;
  out.lx = out.x + dx * cp;
  out.ly = out.y - Math.sin(p);
  out.lz = out.z + dz * cp;
  out.fovDeg = l.fovDeg;
  return out;
}

/**
 * How far a camera can back away from (ox, oz) along the horizontal direction (dx, dz) before it meets a wall.
 * `hasWall(kind, x, z)` answers for the lot's wall edges ('h:x:z' lies on Z = z from x to x+1; 'v:x:z' lies on
 * X = x from z to z+1 — src/sim/spatial/edges.ts). Returns a distance in [0, maxDist]: the first wall crossing minus
 * `clearance`, or `maxDist` when the way is clear. Garbage in (NaN, zero direction) returns 0 or `maxDist` safely.
 */
export function clearDistance(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDist: number,
  hasWall: (kind: 'h' | 'v', x: number, z: number) => boolean,
  clearance: number = PERSPECTIVE_LIMITS.wallClearance,
): number {
  const max = Number.isFinite(maxDist) && maxDist > 0 ? Math.min(maxDist, 64) : 0;
  if (max === 0 || !Number.isFinite(ox) || !Number.isFinite(oz)) return 0;
  const len = Math.hypot(dx, dz);
  if (!Number.isFinite(len) || len < 1e-9) return max;
  const ux = dx / len;
  const uz = dz / len;
  let hit = Infinity;
  // crossings of the lines X = k
  if (Math.abs(ux) > 1e-9) {
    const step = ux > 0 ? 1 : -1;
    let k = ux > 0 ? Math.floor(ox) + 1 : Math.ceil(ox) - 1;
    for (let n = 0; n < 80; n++, k += step) {
      const t = (k - ox) / ux;
      if (t > max || t >= hit) break;
      if (t < 0) continue;
      if (safeWall(hasWall, 'v', k, Math.floor(oz + uz * t))) {
        hit = t;
        break;
      }
    }
  }
  // crossings of the lines Z = k
  if (Math.abs(uz) > 1e-9) {
    const step = uz > 0 ? 1 : -1;
    let k = uz > 0 ? Math.floor(oz) + 1 : Math.ceil(oz) - 1;
    for (let n = 0; n < 80; n++, k += step) {
      const t = (k - oz) / uz;
      if (t > max || t >= hit) break;
      if (t < 0) continue;
      if (safeWall(hasWall, 'h', Math.floor(ox + ux * t), k)) {
        hit = t;
        break;
      }
    }
  }
  if (hit === Infinity) return max;
  const c = Number.isFinite(clearance) && clearance >= 0 ? clearance : PERSPECTIVE_LIMITS.wallClearance;
  return clamp(hit - c, 0, max);
}

function safeWall(hasWall: (kind: 'h' | 'v', x: number, z: number) => boolean, kind: 'h' | 'v', x: number, z: number): boolean {
  try {
    return hasWall(kind, x, z) === true;
  } catch {
    return false;
  }
}

/** Blend two view poses (k = 0 → a, 1 → b), for the glide between perspectives. */
export function mixViewPose(a: ViewPose, b: ViewPose, k: number, out: ViewPose): ViewPose {
  const t = smooth01(k);
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.lx = a.lx + (b.lx - a.lx) * t;
  out.ly = a.ly + (b.ly - a.ly) * t;
  out.lz = a.lz + (b.lz - a.lz) * t;
  out.fovDeg = a.fovDeg + (b.fovDeg - a.fovDeg) * t;
  return out;
}

/** Smoothstep on a clamped 0..1 (NaN → 1: a broken blend lands on the destination). */
export function smooth01(k: number): number {
  if (!Number.isFinite(k)) return 1;
  const t = clamp(k, 0, 1);
  return t * t * (3 - 2 * t);
}

const PIVOT_TMP = { x: 0, y: 0, z: 0 };
