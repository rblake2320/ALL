/**
 * Orbit camera rig: smoothed (target, yaw, pitch, distance) goal → PerspectiveCamera. Pure math lives in
 * cameraMath.ts; this class adds damping, follow and cursor-anchored zoom.
 */
import * as THREE from 'three';
import type { CameraState } from '../contracts';
import {
  CAMERA_LIMITS,
  cameraOffset,
  clampDistance,
  clampPitch,
  clampTarget,
  defaultCameraGoal,
  panScreenDelta,
  panWorldDelta,
  sanitizeBounds,
  stepYaw,
  zoomDistance,
  type CameraGoal,
  type LotBounds,
} from './cameraMath';
import { angleDelta, dampFactor, finiteOr, wrapAngle } from '../core/math';
import {
  PERSPECTIVE_LIMITS,
  behindYaw,
  clampViewPitch,
  clearDistance,
  emptyViewPose,
  firstPersonPose,
  isPerspective,
  mixViewPose,
  shoulderPivot,
  shoulderPose,
  validSubject,
  zoomShoulderDistance,
  type Perspective,
  type PerspectiveSubject,
  type ViewPose,
} from './perspective';

const RATE_TARGET = 9;
const RATE_YAW = 8;
const RATE_PITCH = 10;
const RATE_DIST = 9;
/** Height of the orbit pivot above the ground (frames standing zombies nicely). */
const PIVOT_Y = 0.55;
const RATE_VIEW = 14;
/** Near plane while a perspective is (or is gliding to / from) shoulder or first person. */
const NEAR_PERSPECTIVE = 0.1;
/** Fog range stand-in (lighting takes the orbit distance) for the close views. */
const VIEW_FOG_DISTANCE = 16;
/** Pixel → radian factors when a "pan" drag looks around instead (shoulder / first person). */
const LOOK_YAW_PER_PX = 0.006;
const LOOK_PITCH_PER_PX = 0.004;

/** Answers whether the lot has a wall on an edge (for pulling the shoulder camera in front of drawn walls). */
export type WallProbe = (kind: 'h' | 'v', x: number, z: number) => boolean;

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private bounds: LotBounds = { width: 30, depth: 30 };
  readonly goal: CameraGoal;
  readonly current: CameraGoal;
  private readonly off = { x: 0, y: 0, z: 0 };
  private readonly tmp = { x: 0, z: 0 };
  /** Agent id being followed (resolved by the renderer each frame). */
  followId: string | null = null;
  /**
   * W-025 S5: extra pan area (scene tiles) on top of the lot bounds — the union of the drawn (active + warm) world
   * regions, so the camera may pan over the connected world but never into cold land. null = lot bounds only.
   */
  private panRect: { x0: number; z0: number; x1: number; z1: number } | null = null;

  // ── perspectives (W-136): shoulder / first person ride on top of the orbit state above, which they never touch ──
  private mode: Perspective = 'overview';
  /** 0..1 glide from `fromPose` (the camera as drawn when the perspective changed) to the pose of `mode`. */
  private mix = 1;
  private readonly fromPose: ViewPose = emptyViewPose();
  private readonly applied: ViewPose = emptyViewPose();
  private readonly modePose: ViewPose = emptyViewPose();
  private readonly finalPose: ViewPose = emptyViewPose();
  private readonly view = { yaw: 0, pitch: 0, distance: 0, goalYaw: 0, goalPitch: 0, goalDistance: 0 };
  private readonly subject: PerspectiveSubject = { x: 0, y: 0, z: 0, facing: 0 };
  private hasSubject = false;
  private readonly piv = { x: 0, y: 0, z: 0 };
  /** Set by the renderer: walls that are drawn at full height block the shoulder camera; null = nothing blocks. */
  wallProbe: WallProbe | null = null;
  /** Reduce motion: perspective changes cut instead of glide. */
  reduceMotion = false;
  private probing = false;

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(CAMERA_LIMITS.fovDeg, aspect, 0.3, 1200);
    this.camera.name = 'main-camera';
    this.goal = defaultCameraGoal(this.bounds);
    this.current = { ...this.goal };
    this.apply();
  }

  setBounds(b: Partial<LotBounds>, resetView = false): void {
    this.bounds = sanitizeBounds(b);
    if (resetView) {
      Object.assign(this.goal, defaultCameraGoal(this.bounds));
      Object.assign(this.current, this.goal);
    }
    this.clampGoal();
  }

  getBounds(): LotBounds {
    return this.bounds;
  }

  /** W-025 S5: set (or clear with null) the world pan area; the goal is re-clamped. Garbage = cleared. */
  setPanRect(r: { x0: number; z0: number; x1: number; z1: number } | null): void {
    const ok = r && [r.x0, r.z0, r.x1, r.z1].every(Number.isFinite) && r.x1 >= r.x0 && r.z1 >= r.z0;
    this.panRect = ok ? { x0: r!.x0, z0: r!.z0, x1: r!.x1, z1: r!.z1 } : null;
    this.clampGoal();
  }

  getPanRect(): { x0: number; z0: number; x1: number; z1: number } | null {
    return this.panRect;
  }

  private clampGoal(): void {
    clampTarget(this.goal.targetX, this.goal.targetZ, this.bounds, CAMERA_LIMITS.boundsMargin, this.tmp);
    const pr = this.panRect;
    if (pr) {
      // lot bounds ∪ the world pan area (an already-clamped NaN stays at the lot centre)
      const m = CAMERA_LIMITS.boundsMargin;
      const gx = Number.isFinite(this.goal.targetX) ? this.goal.targetX : this.tmp.x;
      const gz = Number.isFinite(this.goal.targetZ) ? this.goal.targetZ : this.tmp.z;
      this.tmp.x = Math.min(Math.max(gx, Math.min(-m, pr.x0)), Math.max(this.bounds.width + m, pr.x1));
      this.tmp.z = Math.min(Math.max(gz, Math.min(-m, pr.z0)), Math.max(this.bounds.depth + m, pr.z1));
    }
    this.goal.targetX = this.tmp.x;
    this.goal.targetZ = this.tmp.z;
    this.goal.pitch = clampPitch(this.goal.pitch);
    this.goal.distance = clampDistance(this.goal.distance);
    this.goal.yaw = finiteOr(this.goal.yaw, 0);
    // keep the unwrapped goal near the current yaw so damping never spins the long way round
    if (Math.abs(this.goal.yaw - this.current.yaw) > Math.PI * 4) this.goal.yaw = this.current.yaw + angleDelta(this.current.yaw, this.goal.yaw);
  }

  rotate(steps: number): void {
    if (this.mode !== 'overview') {
      this.view.goalYaw = stepYaw(this.view.goalYaw, steps);
      return;
    }
    this.goal.yaw = stepYaw(this.goal.yaw, steps);
    this.clampGoal();
  }

  orbit(dYaw: number, dPitch: number): void {
    if (this.mode !== 'overview') {
      this.look(dYaw, dPitch);
      return;
    }
    this.goal.yaw += Math.max(-Math.PI, Math.min(Math.PI, finiteOr(dYaw, 0)));
    this.goal.pitch += Math.max(-1, Math.min(1, finiteOr(dPitch, 0)));
    this.clampGoal();
  }

  /** + = closer. Anchors toward the ground point under the cursor when given ("zoom toward cursor"). */
  zoom(delta: number, cursor: { x: number; z: number } | null): void {
    if (this.mode !== 'overview') {
      if (this.mode === 'shoulder') this.view.goalDistance = zoomShoulderDistance(this.view.goalDistance, delta);
      return;
    }
    const d0 = this.goal.distance;
    const d1 = zoomDistance(d0, delta);
    this.goal.distance = d1;
    if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.z) && d0 > 0) {
      const k = (1 - d1 / d0) * 0.85;
      this.goal.targetX += (cursor.x - this.goal.targetX) * k;
      this.goal.targetZ += (cursor.z - this.goal.targetZ) * k;
    }
    this.clampGoal();
  }

  pan(dxPx: number, dyPx: number, viewportHeightPx: number): void {
    if (this.mode !== 'overview') {
      // there is nothing to pan in a view attached to a zombie: any drag looks around
      this.look(-finiteOr(dxPx, 0) * LOOK_YAW_PER_PX, -finiteOr(dyPx, 0) * LOOK_PITCH_PER_PX);
      return;
    }
    panScreenDelta(dxPx, dyPx, this.current.yaw, this.current.pitch, this.current.distance, CAMERA_LIMITS.fovDeg, viewportHeightPx, this.tmp);
    this.goal.targetX += this.tmp.x;
    this.goal.targetZ += this.tmp.z;
    this.followId = null;
    this.clampGoal();
  }

  panWorld(dx: number, dz: number): void {
    if (this.mode !== 'overview') return;
    panWorldDelta(dx, dz, this.current.yaw, this.tmp);
    this.goal.targetX += this.tmp.x;
    this.goal.targetZ += this.tmp.z;
    this.followId = null;
    this.clampGoal();
  }

  focus(x: number, z: number, instant: boolean): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.goal.targetX = x;
    this.goal.targetZ = z;
    this.clampGoal();
    if (instant) {
      this.current.targetX = this.goal.targetX;
      this.current.targetZ = this.goal.targetZ;
      this.apply();
    }
  }

  setState(s: Partial<CameraState> | null | undefined, instant: boolean): void {
    if (!s || typeof s !== 'object') return;
    if (s.target && typeof s.target === 'object') {
      this.goal.targetX = finiteOr(s.target.x, this.goal.targetX);
      this.goal.targetZ = finiteOr(s.target.z, this.goal.targetZ);
    }
    if (s.yaw !== undefined) this.goal.yaw = this.current.yaw + angleDelta(this.current.yaw, finiteOr(s.yaw, this.goal.yaw));
    if (s.pitch !== undefined) this.goal.pitch = finiteOr(s.pitch, this.goal.pitch);
    if (s.distance !== undefined) this.goal.distance = finiteOr(s.distance, this.goal.distance);
    this.clampGoal();
    if (instant) {
      Object.assign(this.current, this.goal);
      this.apply();
    }
  }

  /** Settled (goal) state, yaw wrapped into [-PI, PI). */
  /**
   * W-116 framing probe: run `fn` with the camera placed at the GOAL pose looking at (targetX, targetZ), then put the
   * camera back exactly where it was. Lets a solver project points for a candidate focus without moving the view.
   */
  probe<T>(targetX: number, targetZ: number, fn: () => T): T {
    const saved = { ...this.current };
    Object.assign(this.current, this.goal, { targetX, targetZ });
    this.probing = true;
    this.apply();
    try {
      return fn();
    } finally {
      Object.assign(this.current, saved);
      this.probing = false;
      this.apply();
    }
  }

  // ───────────────────────────── perspectives ─────────────────────────────

  getPerspective(): Perspective {
    return this.mode;
  }

  /**
   * Change the perspective. `shoulder` and `firstPerson` need a subject (the selected zombie's rendered pose);
   * without one the rig stays in / returns to `overview`. Returns the perspective now in effect. The orbit state
   * (goal / current) is never written, so going back to `overview` shows exactly the view the player left.
   */
  setPerspective(mode: unknown, subject: Partial<PerspectiveSubject> | null | undefined, instant = false): Perspective {
    let next: Perspective = isPerspective(mode) ? mode : 'overview';
    if (next !== 'overview' && !validSubject(subject)) next = 'overview';
    if (next === this.mode) {
      if (next !== 'overview' && validSubject(subject)) this.setSubject(subject);
      return this.mode;
    }
    const prev = this.mode;
    Object.assign(this.fromPose, this.applied);
    this.mix = instant || this.reduceMotion ? 1 : 0;
    this.mode = next;
    if (next !== 'overview' && validSubject(subject)) {
      this.setSubject(subject);
      const v = this.view;
      // Keep the bearing the player already has (the camera drops down along it); only a first-person view entered
      // straight from above starts out looking where the zombie faces.
      const yaw = prev === 'overview' ? (next === 'firstPerson' ? behindYaw(subject.facing) : wrapAngle(this.current.yaw)) : v.goalYaw;
      v.goalYaw = yaw;
      v.yaw = yaw;
      v.goalPitch = clampViewPitch(next, undefined);
      v.pitch = v.goalPitch;
      if (next === 'shoulder') {
        v.goalDistance = PERSPECTIVE_LIMITS.shoulder.distance;
        v.distance = v.goalDistance;
      }
    } else this.hasSubject = false;
    this.apply();
    return this.mode;
  }

  private setSubject(s: PerspectiveSubject): void {
    this.subject.x = s.x;
    this.subject.y = s.y;
    this.subject.z = s.z;
    this.subject.facing = s.facing;
    this.hasSubject = true;
  }

  private look(dYaw: number, dPitch: number): void {
    const v = this.view;
    v.goalYaw += Math.max(-Math.PI, Math.min(Math.PI, finiteOr(dYaw, 0)));
    // an orbit drag raises the camera; in first person the same drag tips the head the way the pointer moves
    const dp = Math.max(-1, Math.min(1, finiteOr(dPitch, 0)));
    v.goalPitch = clampViewPitch(this.mode, v.goalPitch + (this.mode === 'firstPerson' ? -dp : dp));
  }

  /** Yaw the scene is being looked at with (walls cut away toward it, the moon is placed by it). */
  viewYaw(): number {
    return this.mode === 'overview' ? this.current.yaw : this.view.yaw;
  }

  /** Distance that drives the fog range. */
  viewDistance(): number {
    return this.mode === 'overview' ? this.current.distance : VIEW_FOG_DISTANCE;
  }

  /** Ground point the view is about (lamp budget, focus): the orbit target, or the zombie. */
  viewCentre(out: { x: number; z: number }): { x: number; z: number } {
    if (this.mode !== 'overview' && this.hasSubject) {
      out.x = this.subject.x;
      out.z = this.subject.z;
    } else {
      out.x = this.current.targetX;
      out.z = this.current.targetZ;
    }
    return out;
  }

  /** 0 = fully the overview, 1 = fully a close view (for effects that belong to the overview only). */
  closeness(): number {
    return this.mode === 'overview' ? 1 - this.mix : this.mix;
  }

  /** The camera sits inside the zombie's head (first person, glide finished enough to hide the body). */
  insideSubject(): boolean {
    return this.mode === 'firstPerson' && this.mix > 0.6;
  }

  /** Camera pose and field of view as last applied (tests, diagnostics). */
  appliedPose(): Readonly<ViewPose> {
    return this.applied;
  }

  getState(): CameraState {
    return {
      target: { x: this.goal.targetX, z: this.goal.targetZ },
      yaw: wrapAngle(this.goal.yaw),
      distance: this.goal.distance,
      pitch: this.goal.pitch,
    };
  }

  /**
   * Where the view listens from (spatial audio, ambience): the orbit state in the overview; in a close view the
   * zombie, at the close camera's own distance (the orbit state is not what is on screen there).
   */
  listenerState(): CameraState {
    if (this.mode === 'overview' || !this.hasSubject) return this.getState();
    return {
      target: { x: this.subject.x, z: this.subject.z },
      yaw: wrapAngle(this.view.yaw),
      distance: this.mode === 'shoulder' ? this.view.distance : PERSPECTIVE_LIMITS.firstPerson.forward,
      pitch: this.view.pitch,
    };
  }

  /**
   * Advance damping; `followPos` (if any) becomes the goal target. `subject` = the perspective's zombie this frame
   * (null while it has no rendered pose: the close view then holds its last pose until the renderer drops it).
   */
  update(dt: number, followPos: { x: number; z: number } | null, subject: Partial<PerspectiveSubject> | null = null): void {
    if (this.mode !== 'overview' && validSubject(subject)) this.setSubject(subject);
    if (this.mix < 1) {
      const step = Number.isFinite(dt) && dt > 0 ? dt / PERSPECTIVE_LIMITS.glideSec : 0;
      this.mix = this.reduceMotion ? 1 : Math.min(1, this.mix + step);
    }
    if (this.mode !== 'overview') {
      const v = this.view;
      const kv = dampFactor(RATE_VIEW, dt);
      v.yaw += (v.goalYaw - v.yaw) * kv;
      v.pitch += (v.goalPitch - v.pitch) * kv;
      v.distance += (v.goalDistance - v.distance) * kv;
      if (Math.abs(v.goalYaw - v.yaw) < 1e-5) v.yaw = v.goalYaw;
      if (v.yaw === v.goalYaw && Math.abs(v.goalYaw) > Math.PI * 8) {
        v.goalYaw = wrapAngle(v.goalYaw);
        v.yaw = v.goalYaw;
      }
    }
    if (followPos && Number.isFinite(followPos.x) && Number.isFinite(followPos.z)) {
      this.goal.targetX = followPos.x;
      this.goal.targetZ = followPos.z;
      this.clampGoal();
    }
    const c = this.current;
    const g = this.goal;
    const kt = dampFactor(RATE_TARGET, dt);
    c.targetX += (g.targetX - c.targetX) * kt;
    c.targetZ += (g.targetZ - c.targetZ) * kt;
    c.yaw += (g.yaw - c.yaw) * dampFactor(RATE_YAW, dt);
    c.pitch += (g.pitch - c.pitch) * dampFactor(RATE_PITCH, dt);
    c.distance += (g.distance - c.distance) * dampFactor(RATE_DIST, dt);
    // settle exactly to avoid endless micro-updates
    if (Math.abs(g.yaw - c.yaw) < 1e-5) c.yaw = g.yaw;
    if (Math.abs(g.distance - c.distance) < 1e-4) c.distance = g.distance;
    // renormalise the unwrapped yaw pair once settled
    if (c.yaw === g.yaw && Math.abs(g.yaw) > Math.PI * 8) {
      const w = wrapAngle(g.yaw);
      g.yaw = w;
      c.yaw = w;
    }
    this.apply();
  }

  private apply(): void {
    const c = this.current;
    const overviewOnly = this.probing || (this.mode === 'overview' && this.mix >= 1);
    const m = this.modePose;
    if (this.probing || this.mode === 'overview' || !this.hasSubject) {
      cameraOffset(c.yaw, c.pitch, c.distance, this.off);
      m.x = c.targetX + this.off.x;
      m.y = PIVOT_Y + this.off.y;
      m.z = c.targetZ + this.off.z;
      m.lx = c.targetX;
      m.ly = PIVOT_Y;
      m.lz = c.targetZ;
      m.fovDeg = CAMERA_LIMITS.fovDeg;
    } else if (this.mode === 'firstPerson') firstPersonPose(this.subject, this.view.yaw, this.view.pitch, m);
    else {
      const v = this.view;
      let d = v.distance;
      if (this.wallProbe) {
        const piv = shoulderPivot(this.subject, v.yaw, this.piv);
        const cp = Math.cos(clampViewPitch('shoulder', v.pitch));
        const flat = clearDistance(piv.x, piv.z, Math.sin(v.yaw), Math.cos(v.yaw), d * cp, this.wallProbe);
        d = cp > 1e-3 ? Math.min(d, flat / cp) : d;
      }
      shoulderPose(this.subject, v.yaw, v.pitch, d, m);
    }
    const f = overviewOnly || this.mix >= 1 ? m : mixViewPose(this.fromPose, m, this.mix, this.finalPose);
    this.camera.position.set(f.x, f.y, f.z);
    // a look point on top of the camera would leave the orientation undefined: keep the last one
    if (Math.abs(f.lx - f.x) + Math.abs(f.ly - f.y) + Math.abs(f.lz - f.z) > 1e-6) this.camera.lookAt(f.lx, f.ly, f.lz);
    const near = overviewOnly ? Math.min(2, Math.max(0.15, c.distance * 0.04)) : NEAR_PERSPECTIVE;
    let dirty = false;
    if (Math.abs(this.camera.near - near) > 1e-3) {
      this.camera.near = near;
      dirty = true;
    }
    if (Math.abs(this.camera.fov - f.fovDeg) > 1e-4) {
      this.camera.fov = f.fovDeg;
      dirty = true;
    }
    if (dirty) this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    if (!this.probing) Object.assign(this.applied, f);
  }

  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

type PerspectiveCamera = THREE.PerspectiveCamera;
