/**
 * Spatial hints for world sounds: stereo pan from the on-screen x position, gain from the distance to the camera
 * focus, camera zoom and on-screen visibility. Pure; never throws (returns undefined = play centred, full gain).
 */
import type { SpatialHint } from '../audio/contracts';
import type { CameraState } from '../render/contracts';

export interface SpatialSource {
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean };
  getCamera(): CameraState;
  /** Where the view listens from when that is not the orbit camera (shoulder / first person); absent = getCamera(). */
  getListener?(): CameraState;
}

export const PAN_WIDTH = 0.85;
/** Tiles from the camera focus within which sounds play at full gain. */
export const NEAR_TILES = 4;
/** Each FALLOFF_TILES beyond NEAR roughly halves the gain. */
export const FALLOFF_TILES = 8;
/** Camera distance at which zoom attenuation starts. */
export const REFERENCE_CAMERA_DISTANCE = 14;
export const MIN_ZOOM_GAIN = 0.35;
export const OFFSCREEN_GAIN = 0.4;
/** Tiles from the listening point within which a sound is never "off-screen" (a first-person zombie's own voice and steps). */
export const SELF_TILES = 1;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function computeSpatial(
  p: { x: number; y: number; z: number },
  source: SpatialSource,
  viewport: { width: number; height: number },
): SpatialHint | undefined {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return undefined;
  try {
    const s = source.worldToScreen(p.x, p.y, p.z);
    const width = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 1;
    let pan = Number.isFinite(s?.x) ? (s.x / width) * 2 - 1 : 0;
    pan = clamp(pan, -1, 1) * PAN_WIDTH;
    const cam = source.getListener?.() ?? source.getCamera();
    const tx = Number.isFinite(cam?.target?.x) ? cam.target.x : p.x;
    const tz = Number.isFinite(cam?.target?.z) ? cam.target.z : p.z;
    const d = Math.hypot(p.x - tx, p.z - tz);
    // The listener's own sounds (a first-person zombie's voice and steps) sit at or behind the camera, where the screen
    // projection is meaningless (picker.project marks them not visible): centre those. A sound within a tile that IS on
    // screen (a stove just ahead and to the right) keeps its real screen pan.
    const self = s?.visible === false && d <= SELF_TILES;
    if (self) pan = 0;
    const distGain = 1 / (1 + Math.max(0, d - NEAR_TILES) / FALLOFF_TILES);
    const camDist = Number.isFinite(cam?.distance) && cam.distance > 0 ? cam.distance : REFERENCE_CAMERA_DISTANCE;
    const zoomGain = clamp(REFERENCE_CAMERA_DISTANCE / camDist, MIN_ZOOM_GAIN, 1);
    const vis = s?.visible === false && !self ? OFFSCREEN_GAIN : 1;
    const gain = clamp(distGain * zoomGain * vis, 0, 1);
    if (!Number.isFinite(pan) || !Number.isFinite(gain)) return undefined;
    return { pan, gain };
  } catch {
    return undefined;
  }
}
