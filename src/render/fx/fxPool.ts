/**
 * Particle pool — structure-of-arrays storage, dense (swap-remove) so the GPU upload is one contiguous range.
 * Pure (no three.js); per-kind caps + a global capacity. Unit-tested.
 */
import { FX_KINDS, type FxKind } from '../../sim/contracts';

export const FX_KIND_COUNT = FX_KINDS.length;

/** Atlas frame ids (8 × 4 grid of 64px cells, drawn by fxTextures.ts). */
export const FXF = {
  puff: 0,
  puff2: 1,
  sparkle: 2,
  glow: 3,
  heart: 4,
  fly: 5,
  wisp: 6,
  zee: 7,
  arrow: 8,
  coin: 9,
  bill: 10,
  ember: 11,
  flame: 12,
  smoke: 13,
  bone: 14,
  splat: 15,
  bolt1: 16,
  bolt2: 17,
  chunk: 18,
  dust: 19,
  drop: 20,
  ring: 21,
  note1: 22,
  note2: 23,
  anger: 24,
  confetti: 25,
  streamer: 26,
  flake: 27,
  shard: 28,
  spark: 29,
  tear: 30,
  star: 31,
} as const;
export const FX_ATLAS_COLS = 8;
export const FX_ATLAS_ROWS = 4;

/** Motion modes. */
export const MODE_BALLISTIC = 0;
/** Orbit an anchor (fly swarms): p0 radius, p1 angular speed, p2 phase, p3 height offset. */
export const MODE_ORBIT = 1;
/** Ballistic + horizontal sine sway: p0 sway frequency, p1 phase, p2 amplitude. */
export const MODE_SWAY = 2;

export const MAX_ANCHORS = 128;

/** Default per-kind caps at full quality. */
export const DEFAULT_KIND_CAPS: Record<FxKind, number> = {
  puff: 64,
  sparkle: 96,
  hearts: 32,
  flies: 200,
  stench: 48,
  zzz: 36,
  skillUp: 48,
  money: 40,
  fire: 240,
  smoke: 110,
  limbDrop: 40,
  reanimate: 96,
  crumble: 64,
  splash: 64,
  notes: 48,
  anger: 24,
  confetti: 160,
  frost: 64,
  zap: 48,
  tears: 32,
};

export function kindIndex(kind: unknown): number {
  return typeof kind === 'string' ? (FX_KINDS as readonly string[]).indexOf(kind) : -1;
}

export class ParticlePool {
  readonly capacity: number;
  count = 0;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Seconds alive; negative = delayed spawn (invisible until ≥ 0). */
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly rot: Float32Array;
  readonly rotV: Float32Array;
  readonly frame: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly a: Float32Array;
  readonly additive: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly flicker: Float32Array;
  readonly mode: Uint8Array;
  readonly kind: Uint8Array;
  readonly anchor: Int16Array;
  readonly p0: Float32Array;
  readonly p1: Float32Array;
  readonly p2: Float32Array;
  readonly p3: Float32Array;
  /** Stable per-particle random phase (survives swap-remove). */
  readonly seed: Float32Array;
  private seedCounter = 0;
  /** Anchor positions (xyz per anchor) for orbiting particles. */
  readonly anchors = new Float32Array(MAX_ANCHORS * 3);
  readonly countByKind = new Int32Array(FX_KIND_COUNT);
  readonly caps = new Int32Array(FX_KIND_COUNT);

  constructor(capacity: number, caps: Partial<Record<FxKind, number>> = DEFAULT_KIND_CAPS, capScale = 1) {
    const cap = Number.isFinite(capacity) && capacity > 0 ? Math.min(Math.floor(capacity), 65535) : 1;
    this.capacity = cap;
    const f = () => new Float32Array(cap);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size0 = f();
    this.size1 = f();
    this.rot = f();
    this.rotV = f();
    this.frame = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.a = f();
    this.additive = f();
    this.gravity = f();
    this.drag = f();
    this.flicker = f();
    this.mode = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.anchor = new Int16Array(cap);
    this.p0 = f();
    this.p1 = f();
    this.p2 = f();
    this.p3 = f();
    this.seed = f();
    this.setCaps(caps, capScale);
  }

  setCaps(caps: Partial<Record<FxKind, number>>, scale = 1): void {
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    for (let k = 0; k < FX_KIND_COUNT; k++) {
      const v = caps[FX_KINDS[k]];
      const base = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_KIND_CAPS[FX_KINDS[k]];
      this.caps[k] = Math.max(0, Math.floor(base * s));
    }
  }

  /** Free slots remaining for a kind (min of the kind cap and the global capacity). */
  room(kind: number): number {
    if (kind < 0 || kind >= FX_KIND_COUNT) return 0;
    return Math.max(0, Math.min(this.caps[kind] - this.countByKind[kind], this.capacity - this.count));
  }

  /**
   * Allocate and initialise a particle. Returns its index, or -1 when the kind cap or the pool is full
   * (bursts simply come out smaller — never an error).
   */
  emit(
    kind: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    frame: number,
  ): number {
    if (kind < 0 || kind >= FX_KIND_COUNT) return -1;
    if (this.count >= this.capacity || this.countByKind[kind] >= this.caps[kind]) return -1;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return -1;
    const i = this.count++;
    this.countByKind[kind]++;
    this.kind[i] = kind;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = Number.isFinite(vx) ? vx : 0;
    this.vy[i] = Number.isFinite(vy) ? vy : 0;
    this.vz[i] = Number.isFinite(vz) ? vz : 0;
    this.age[i] = 0;
    this.life[i] = Number.isFinite(life) && life > 0.01 ? life : 0.01;
    this.size0[i] = Number.isFinite(size0) ? size0 : 0.1;
    this.size1[i] = Number.isFinite(size1) ? size1 : this.size0[i];
    this.rot[i] = 0;
    this.rotV[i] = 0;
    this.frame[i] = frame;
    this.r[i] = 1;
    this.g[i] = 1;
    this.b[i] = 1;
    this.a[i] = 1;
    this.additive[i] = 0;
    this.gravity[i] = 0;
    this.drag[i] = 0;
    this.flicker[i] = 0;
    this.mode[i] = MODE_BALLISTIC;
    this.anchor[i] = -1;
    this.p0[i] = 0;
    this.p1[i] = 0;
    this.p2[i] = 0;
    this.p3[i] = 0;
    this.seedCounter = (this.seedCounter + 1) % 100000;
    this.seed[i] = ((this.seedCounter * 0.6180339887) % 1) * 100;
    return i;
  }

  color(i: number, r: number, g: number, b: number, a = 1, additive = 0): void {
    if (i < 0) return;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
    this.a[i] = a;
    this.additive[i] = additive;
  }

  /** Remove particle i (swap with the last). */
  kill(i: number): void {
    if (i < 0 || i >= this.count) return;
    const k = this.kind[i];
    if (this.countByKind[k] > 0) this.countByKind[k]--;
    const last = --this.count;
    if (i !== last) this.copy(last, i);
  }

  /** Remove every particle bound to an anchor (when its emitter is released). */
  killAnchor(anchor: number): void {
    for (let i = this.count - 1; i >= 0; i--) if (this.anchor[i] === anchor) this.kill(i);
  }

  clear(): void {
    this.count = 0;
    this.countByKind.fill(0);
  }

  private copy(from: number, to: number): void {
    this.px[to] = this.px[from];
    this.py[to] = this.py[from];
    this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.vz[to] = this.vz[from];
    this.age[to] = this.age[from];
    this.life[to] = this.life[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.rot[to] = this.rot[from];
    this.rotV[to] = this.rotV[from];
    this.frame[to] = this.frame[from];
    this.r[to] = this.r[from];
    this.g[to] = this.g[from];
    this.b[to] = this.b[from];
    this.a[to] = this.a[from];
    this.additive[to] = this.additive[from];
    this.gravity[to] = this.gravity[from];
    this.drag[to] = this.drag[from];
    this.flicker[to] = this.flicker[from];
    this.mode[to] = this.mode[from];
    this.kind[to] = this.kind[from];
    this.anchor[to] = this.anchor[from];
    this.p0[to] = this.p0[from];
    this.p1[to] = this.p1[from];
    this.p2[to] = this.p2[from];
    this.p3[to] = this.p3[from];
    this.seed[to] = this.seed[from];
  }

  /** Integrate motion and retire expired particles. dt is clamped to [0, 0.25] s. */
  update(dt: number): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    if (step === 0) return;
    for (let i = this.count - 1; i >= 0; i--) {
      const age = this.age[i] + step;
      this.age[i] = age;
      if (age >= this.life[i]) {
        this.kill(i);
        continue;
      }
      if (age < 0) continue; // delayed
      const drag = this.drag[i];
      if (drag > 0) {
        const f = Math.max(0, 1 - drag * step);
        this.vx[i] *= f;
        this.vy[i] *= f;
        this.vz[i] *= f;
      }
      this.vy[i] += this.gravity[i] * step;
      if (this.mode[i] !== MODE_ORBIT) {
        this.px[i] += this.vx[i] * step;
        this.py[i] += this.vy[i] * step;
        this.pz[i] += this.vz[i] * step;
        // settle on the floor instead of sinking through it
        if (this.py[i] < 0.01 && this.vy[i] < 0) {
          this.py[i] = 0.01;
          this.vy[i] *= -0.25;
          this.vx[i] *= 0.6;
          this.vz[i] *= 0.6;
        }
      }
      this.rot[i] += this.rotV[i] * step;
    }
  }

  /** Normalised life 0..1 (0 while delayed). */
  lifeT(i: number): number {
    const a = this.age[i];
    if (a <= 0) return 0;
    const t = a / this.life[i];
    return t > 1 ? 1 : t;
  }

  /**
   * Write render attributes for every live particle into packed arrays:
   *   pos (xyz), sizeRot (size, rot), color (rgba incl. alpha fade), meta (frame, additive).
   * Returns the number of instances written (delayed particles are written with zero alpha/size).
   */
  writeRender(timeSec: number, pos: Float32Array, sizeRot: Float32Array, color: Float32Array, meta: Float32Array): number {
    const n = Math.min(this.count, Math.floor(pos.length / 3), Math.floor(sizeRot.length / 2), Math.floor(color.length / 4), Math.floor(meta.length / 2));
    const anchors = this.anchors;
    for (let i = 0; i < n; i++) {
      const age = this.age[i];
      let x = this.px[i];
      let y = this.py[i];
      let z = this.pz[i];
      const mode = this.mode[i];
      if (mode === MODE_ORBIT) {
        const an = this.anchor[i];
        if (an >= 0 && an < MAX_ANCHORS) {
          x = anchors[an * 3];
          y = anchors[an * 3 + 1];
          z = anchors[an * 3 + 2];
        }
        const sd = this.seed[i];
        const ang = this.p2[i] + this.p1[i] * timeSec;
        const rad = this.p0[i] * (1 + 0.35 * Math.sin(ang * 2.3 + sd));
        x += Math.cos(ang) * rad;
        z += Math.sin(ang * 1.13 + sd * 0.1) * rad;
        y += this.p3[i] + Math.sin(ang * 1.7 + sd * 0.5) * 0.12;
      } else if (mode === MODE_SWAY) {
        x += Math.sin(age * this.p0[i] + this.p1[i]) * this.p2[i];
      }
      const t = this.lifeT(i);
      // fade in over the first 12%, out over the last 30%
      let alpha = age < 0 ? 0 : this.a[i] * Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.3);
      const fl = this.flicker[i];
      if (fl > 0) alpha *= 1 - fl * (0.5 + 0.5 * Math.sin(timeSec * 31 + this.seed[i] * 1.7));
      const size = age < 0 ? 0 : this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      sizeRot[i * 2] = size;
      sizeRot[i * 2 + 1] = this.rot[i];
      color[i * 4] = this.r[i];
      color[i * 4 + 1] = this.g[i];
      color[i * 4 + 2] = this.b[i];
      color[i * 4 + 3] = alpha;
      meta[i * 2] = this.frame[i];
      meta[i * 2 + 1] = this.additive[i];
    }
    return n;
  }
}
