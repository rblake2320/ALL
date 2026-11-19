/**
 * The carpool hearse (binding decision #10): while `state.flags['people:carpool:until'] > state.tick` an
 * env_hearse eases in along the near lane and idles at the curb by the first entry point, then drives off and
 * hides. Model front is +X (hood/headlights), so it drives with yaw 0. Headlamps follow the lamps-on period.
 */
import * as THREE from 'three';
import type { ModelLibrary, ObjectVisualState } from '../contracts';
import type { ThrottledWarn } from '../core/diagnostics';

export type CarpoolPhase = 'away' | 'arriving' | 'idle' | 'leaving';

const TRAVEL = 42;
const DURATION = 4.5;
const LANE_OFFSET = 0.25 + 1.45; // curb width + half a lane-ish from the lot edge

/** Pure motion curve: x offset (relative to the stop point) for a phase at progress s ∈ [0,1]. */
export function carpoolOffset(phase: CarpoolPhase, s: number): number {
  const k = Math.min(1, Math.max(0, Number.isFinite(s) ? s : 1));
  if (phase === 'arriving') return -TRAVEL * (1 - k) * (1 - k); // decelerate into the stop
  if (phase === 'leaving') return TRAVEL * k * k; // accelerate away
  if (phase === 'idle') return 0;
  return TRAVEL;
}

/** Next phase given whether the carpool should be present (pure). */
export function nextCarpoolPhase(phase: CarpoolPhase, active: boolean, progressDone: boolean): CarpoolPhase {
  switch (phase) {
    case 'away':
      return active ? 'arriving' : 'away';
    case 'arriving':
      return !active ? 'leaving' : progressDone ? 'idle' : 'arriving';
    case 'idle':
      return active ? 'idle' : 'leaving';
    case 'leaving':
      return progressDone ? (active ? 'arriving' : 'away') : 'leaving';
  }
}

export class CarpoolHearse {
  readonly group = new THREE.Group();
  private obj: THREE.Object3D | null = null;
  private phase: CarpoolPhase = 'away';
  private progress = 1;
  private readonly visual: ObjectVisualState = { powered: true, inUse: false, broken: false, lit: false, servings: 0, progress: 0, flag: false, dirt: 0, burning: false };

  constructor(
    private readonly models: ModelLibrary,
    private readonly warn: ThrottledWarn,
  ) {
    this.group.name = 'carpool';
    this.group.visible = false;
  }

  get state(): CarpoolPhase {
    return this.phase;
  }

  /** @param stopX/stopZ curb stop point (world); `depth` = lot depth (lane runs just beyond it). */
  update(dt: number, timeSec: number, active: boolean, lampsOn: boolean, stopX: number, depth: number): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    const prev = this.phase;
    if (this.phase === 'arriving' || this.phase === 'leaving') this.progress = Math.min(1, this.progress + step / DURATION);
    const next = nextCarpoolPhase(this.phase, active, this.progress >= 1);
    if (next !== prev) {
      // reversing mid-way keeps the current position continuous
      if ((prev === 'arriving' && next === 'leaving') || (prev === 'leaving' && next === 'arriving')) this.progress = 0;
      else if (next === 'arriving' || next === 'leaving') this.progress = 0;
      this.phase = next;
    }
    if (this.phase === 'away') {
      this.group.visible = false;
      return;
    }
    if (!this.obj) {
      try {
        this.obj = this.models.create('env_hearse', null);
        this.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.receiveShadow = true;
        });
        this.group.add(this.obj);
      } catch (e) {
        this.warn.warn('carpool', 'carpool hearse model failed', e);
        return;
      }
    }
    this.group.visible = true;
    const x = (Number.isFinite(stopX) ? stopX : 0) + 1 + carpoolOffset(this.phase, this.progress);
    this.obj.position.set(x, 0, (Number.isFinite(depth) ? depth : 30) + LANE_OFFSET);
    this.obj.rotation.set(0, 0, 0);
    this.visual.lit = lampsOn;
    this.visual.inUse = this.phase !== 'idle';
    try {
      this.models.update(this.obj, this.visual, timeSec);
    } catch (e) {
      this.warn.warn('carpool-update', 'carpool hearse update failed', e);
    }
  }

  dispose(): void {
    if (this.obj) {
      this.group.remove(this.obj);
      try {
        this.models.release?.(this.obj);
      } catch {
        /* optional */
      }
    }
    this.obj = null;
  }
}
