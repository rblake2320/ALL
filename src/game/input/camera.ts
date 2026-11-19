/**
 * Camera controls: drag orbit/pan, wheel zoom (invertZoom), held-key pan/zoom (WASD/arrows, =/-/Z/X),
 * edge scrolling, and the slow menu-demo orbit. Sensitivities scale with Settings.cameraSpeed.
 * All renderer calls are guarded so a misbehaving renderer cannot break input.
 */
import type { RendererAPI } from '../../render/contracts';
import type { Settings } from '../contracts';
import type { KeyAction } from './keyboard';

export const ORBIT_YAW_PER_PX = 0.006;
export const ORBIT_PITCH_PER_PX = 0.004;
export const PAN_TILES_PER_SEC = 12;
export const ZOOM_UNITS_PER_SEC = 4;
/** One mouse-wheel notch (~100 px) = one zoom unit. */
export const WHEEL_PX_PER_UNIT = 100;
export const EDGE_MARGIN_PX = 14;
export const DEMO_ORBIT_RAD_PER_SEC = 0.045;

/** Wheel delta in CSS pixels regardless of deltaMode (0 = px, 1 = lines, 2 = pages). */
export function normalizeWheel(deltaY: number, deltaMode: number, pageHeight = 800): number {
  if (!Number.isFinite(deltaY)) return 0;
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * pageHeight : deltaY;
  return Math.max(-1000, Math.min(1000, px));
}

/** Zoom units for a wheel event: positive = closer. */
export function wheelZoomUnits(deltaY: number, deltaMode: number, invert: boolean): number {
  const units = -normalizeWheel(deltaY, deltaMode) / WHEEL_PX_PER_UNIT;
  const clamped = Math.max(-3, Math.min(3, units));
  return invert ? -clamped : clamped;
}

/** Edge-scroll direction (-1..1 per axis) for a pointer near the viewport border. */
export function edgeDirection(x: number, y: number, width: number, height: number, margin = EDGE_MARGIN_PX): { dx: number; dz: number } {
  if (![x, y, width, height].every(Number.isFinite) || width <= margin * 2 || height <= margin * 2) return { dx: 0, dz: 0 };
  if (x < 0 || y < 0 || x > width || y > height) return { dx: 0, dz: 0 };
  const dx = x < margin ? -1 : x > width - margin ? 1 : 0;
  const dz = y < margin ? -1 : y > height - margin ? 1 : 0;
  return { dx, dz };
}

/** Held-key pan direction, diagonal-normalised. */
export function keyPanDirection(held: ReadonlySet<KeyAction>): { dx: number; dz: number } {
  let dx = 0;
  let dz = 0;
  if (held.has('panLeft')) dx -= 1;
  if (held.has('panRight')) dx += 1;
  if (held.has('panUp')) dz -= 1;
  if (held.has('panDown')) dz += 1;
  if (dx !== 0 && dz !== 0) {
    dx *= Math.SQRT1_2;
    dz *= Math.SQRT1_2;
  }
  return { dx, dz };
}

export interface CameraFrameInput {
  dt: number;
  held: ReadonlySet<KeyAction>;
  fast: boolean;
  pointer: { x: number; y: number } | null;
  pointerInside: boolean;
  dragging: boolean;
  focused: boolean;
  viewport: { width: number; height: number };
}

export class CameraController {
  constructor(
    private readonly renderer: RendererAPI,
    private readonly settings: () => Settings,
    private readonly onError: (where: string, err: unknown) => void,
  ) {}

  private speed(): number {
    const s = this.settings().cameraSpeed;
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  private guard(where: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.onError(where, e);
    }
  }

  orbitByPixels(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const s = this.speed();
    this.guard('camera.orbit', () => this.renderer.orbit(-dx * ORBIT_YAW_PER_PX * s, -dy * ORBIT_PITCH_PER_PX * s));
  }

  panByPixels(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.guard('camera.pan', () => this.renderer.pan(dx, dy));
  }

  wheel(deltaY: number, deltaMode: number): void {
    const z = wheelZoomUnits(deltaY, deltaMode, this.settings().invertZoom);
    if (z !== 0) this.guard('camera.zoom', () => this.renderer.zoom(z));
  }

  rotate(steps: number): void {
    this.guard('camera.rotate', () => this.renderer.rotateCamera(steps));
  }

  demoOrbit(dt: number): void {
    if (!(dt > 0)) return;
    this.guard('camera.demo', () => this.renderer.orbit(DEMO_ORBIT_RAD_PER_SEC * Math.min(dt, 0.1), 0));
  }

  frame(input: CameraFrameInput): void {
    const dt = Number.isFinite(input.dt) && input.dt > 0 ? Math.min(input.dt, 0.1) : 0;
    if (dt === 0) return;
    let { dx, dz } = keyPanDirection(input.held);
    if (dx === 0 && dz === 0 && this.settings().edgeScroll && input.pointerInside && input.focused && !input.dragging && input.pointer) {
      const e = edgeDirection(input.pointer.x, input.pointer.y, input.viewport.width, input.viewport.height);
      dx = e.dx;
      dz = e.dz;
    }
    if (dx !== 0 || dz !== 0) {
      let distFactor = 1;
      try {
        const d = this.renderer.getCamera().distance;
        if (Number.isFinite(d) && d > 0) distFactor = Math.min(2.5, Math.max(0.5, d / 20));
      } catch {
        /* default factor */
      }
      const v = PAN_TILES_PER_SEC * this.speed() * distFactor * (input.fast ? 2 : 1) * dt;
      this.guard('camera.panWorld', () => this.renderer.panWorld(dx * v, dz * v));
    }
    const zoom = (input.held.has('zoomIn') ? 1 : 0) - (input.held.has('zoomOut') ? 1 : 0);
    if (zoom !== 0) this.guard('camera.zoomKeys', () => this.renderer.zoom(zoom * ZOOM_UNITS_PER_SEC * dt));
  }
}
