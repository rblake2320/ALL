/**
 * Camera rig math — pure, unit-tested.
 *
 * Conventions: the camera orbits a ground target. `yaw` is the facing angle (dimensions.ts convention: 0 = +Z,
 * PI/2 = +X) of the direction FROM the target TO the camera, so yaw 0 = camera on the street side (+Z) looking
 * toward -Z, exactly as CameraState documents. `pitch` is the elevation angle above the ground plane.
 * rotateCamera(+1) orbits the camera 45° clockwise as seen from above (yaw decreases by PI/4).
 */
import { clamp, finiteOr, wrapAngle } from '../core/math';

export const CAMERA_LIMITS = {
  pitchMin: 0.35,
  pitchMax: 1.25,
  distanceMin: 6,
  distanceMax: 60,
  /** Vertical field of view (degrees). */
  fovDeg: 32,
  /** Target may leave the lot by this many tiles. */
  boundsMargin: 4,
} as const;

export const YAW_STEP = Math.PI / 4;

export interface CameraGoal {
  targetX: number;
  targetZ: number;
  yaw: number;
  pitch: number;
  distance: number;
}

export interface LotBounds {
  width: number;
  depth: number;
}

export function clampPitch(p: unknown): number {
  return clamp(finiteOr(p, 0.75), CAMERA_LIMITS.pitchMin, CAMERA_LIMITS.pitchMax);
}

export function clampDistance(d: unknown): number {
  return clamp(finiteOr(d, 30), CAMERA_LIMITS.distanceMin, CAMERA_LIMITS.distanceMax);
}

/** Lot dims sanitiser (garbage → 30×30). */
export function sanitizeBounds(b: Partial<LotBounds> | null | undefined): LotBounds {
  const w = b && typeof b.width === 'number' && Number.isFinite(b.width) && b.width > 0 ? b.width : 30;
  const d = b && typeof b.depth === 'number' && Number.isFinite(b.depth) && b.depth > 0 ? b.depth : 30;
  return { width: Math.min(w, 10000), depth: Math.min(d, 10000) };
}

/** Clamp a ground target into the lot bounds plus margin. NaN → lot centre. */
export function clampTarget(
  x: unknown,
  z: unknown,
  bounds: LotBounds,
  margin: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const m = Number.isFinite(margin) && margin >= 0 ? margin : CAMERA_LIMITS.boundsMargin;
  const cx = bounds.width / 2;
  const cz = bounds.depth / 2;
  out.x = clamp(finiteOr(x, cx), -m, bounds.width + m);
  out.z = clamp(finiteOr(z, cz), -m, bounds.depth + m);
  return out;
}

/**
 * Next yaw goal after `steps` 45° rotations (+ = clockwise from above = yaw decreasing). The first step snaps
 * to the next 45° multiple in the direction of travel, so an orbited (off-grid) camera lands on the grid.
 */
export function stepYaw(goalYaw: number, steps: number): number {
  const g = finiteOr(goalYaw, 0);
  const s = Math.trunc(finiteOr(steps, 0));
  if (s === 0) return g;
  const n = Math.min(Math.abs(s), 64);
  const eps = 1e-4;
  if (s > 0) {
    const first = Math.floor((g - eps) / YAW_STEP) * YAW_STEP;
    return first - (n - 1) * YAW_STEP;
  }
  const first = Math.ceil((g + eps) / YAW_STEP) * YAW_STEP;
  return first + (n - 1) * YAW_STEP;
}

/** Offset from the target to the camera for (yaw, pitch, distance). */
export function cameraOffset(yaw: number, pitch: number, distance: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  out.x = Math.sin(yaw) * cp * distance;
  out.y = Math.sin(pitch) * distance;
  out.z = Math.cos(yaw) * cp * distance;
  return out;
}

/** Camera's right vector on the ground for a yaw. */
export function cameraRight(yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = Math.cos(yaw);
  out.z = -Math.sin(yaw);
  return out;
}

/** Horizontal view direction (camera → target) for a yaw. */
export function viewDirection(yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  out.x = -Math.sin(yaw);
  out.z = -Math.cos(yaw);
  return out;
}

/**
 * Camera-relative world pan (WASD): +dx moves the target toward the camera's right, +dz toward the camera
 * (screen-down). At yaw 0 this is the identity (dx → +X, dz → +Z). Inputs are clamped to ±1000 tiles.
 */
export function panWorldDelta(dx: number, dz: number, yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  const a = clamp(finiteOr(dx, 0), -1000, 1000);
  const b = clamp(finiteOr(dz, 0), -1000, 1000);
  const y = finiteOr(yaw, 0);
  const c = Math.cos(y);
  const s = Math.sin(y);
  out.x = a * c + b * s;
  out.z = -a * s + b * c;
  return out;
}

/**
 * Screen drag → ground delta ("grab the world" semantics): dragging right by dx CSS px moves the world right,
 * i.e. the target moves left. Vertical drags are stretched by 1/sin(pitch) to follow the tilted ground.
 */
export function panScreenDelta(
  dxPx: number,
  dyPx: number,
  yaw: number,
  pitch: number,
  distance: number,
  fovDeg: number,
  viewportHeightPx: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const h = Number.isFinite(viewportHeightPx) && viewportHeightPx > 1 ? viewportHeightPx : 720;
  const fov = (clamp(finiteOr(fovDeg, CAMERA_LIMITS.fovDeg), 5, 120) * Math.PI) / 180;
  const unitsPerPx = (2 * clampDistance(distance) * Math.tan(fov / 2)) / h;
  const dx = clamp(finiteOr(dxPx, 0), -10000, 10000) * unitsPerPx;
  const dy = (clamp(finiteOr(dyPx, 0), -10000, 10000) * unitsPerPx) / Math.max(0.3, Math.sin(clampPitch(pitch)));
  // world moves with the cursor → target moves opposite in camera space: right: -dx, toward camera: -dy
  return panWorldDelta(-dx, -dy, yaw, out);
}

/** Default framing: from the street (+Z), three-quarter yaw, elevated, the whole lot in view. */
export function defaultCameraGoal(bounds: LotBounds): CameraGoal {
  const span = Math.max(bounds.width, bounds.depth);
  return {
    targetX: bounds.width / 2,
    targetZ: bounds.depth * 0.52,
    yaw: Math.PI / 4,
    pitch: 0.8,
    distance: clampDistance(span * 0.9),
  };
}

/** Zoom: + delta = closer. One unit ≈ one mouse-wheel notch (≈ 12% distance). Clamped per call to ±10 notches. */
export function zoomDistance(distance: number, delta: number): number {
  const d = clampDistance(distance);
  const z = clamp(finiteOr(delta, 0), -10, 10);
  return clampDistance(d * Math.pow(0.88, z));
}

/** Wrap a (possibly large, unwrapped) yaw for reporting. */
export function reportYaw(yaw: number): number {
  return wrapAngle(yaw);
}
