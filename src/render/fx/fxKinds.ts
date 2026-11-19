/**
 * Burst + persistent emitter definitions for every FxKind. Pure data/functions over ParticlePool
 * (no three.js) — unit-tested for coverage and caps.
 */
import { FX_KINDS, type FxKind } from '../../sim/contracts';
import { FXF, MODE_ORBIT, MODE_SWAY, kindIndex, type ParticlePool } from './fxPool';

export type Rnd = () => number;

function rr(rnd: Rnd, a: number, b: number): number {
  return a + (b - a) * rnd();
}

function pm(rnd: Rnd, a: number): number {
  return (rnd() * 2 - 1) * a;
}

type C3 = readonly [number, number, number];
const TOXIC: C3 = [0.62, 0.91, 0.44];
const BONE: C3 = [0.91, 0.88, 0.78];
const CANDLE: C3 = [1.0, 0.7, 0.35];
const CRYO: C3 = [0.5, 0.88, 1.0];
const ROSE: C3 = [1.0, 0.5, 0.62];
const PLUM: C3 = [0.62, 0.45, 0.85];
const CONFETTI: readonly C3[] = [TOXIC, CANDLE, CRYO, ROSE, BONE, PLUM];

function tint(pool: ParticlePool, i: number, c: C3, mul: number, alpha: number, additive: number): void {
  pool.color(i, c[0] * mul, c[1] * mul, c[2] * mul, alpha, additive);
}

/** Count after quality scaling (at least 1 when the base count is ≥ 1). */
function n(base: number, scale: number): number {
  const s = Number.isFinite(scale) ? Math.min(Math.max(scale, 0), 2) : 1;
  return Math.max(base > 0 ? 1 : 0, Math.round(base * s));
}

export type BurstFn = (pool: ParticlePool, rnd: Rnd, x: number, y: number, z: number, scale: number) => void;

const K = (kind: FxKind) => kindIndex(kind);

export const FX_BURSTS: Record<FxKind, BurstFn> = {
  puff(pool, rnd, x, y, z, s) {
    const k = K('puff');
    for (let c = 0; c < n(10, s); c++) {
      const a = rnd() * Math.PI * 2;
      const sp = rr(rnd, 0.3, 0.7);
      const i = pool.emit(k, x + pm(rnd, 0.25), y + 0.3 + rnd() * 0.3, z + pm(rnd, 0.25), Math.cos(a) * sp, rr(rnd, 0.15, 0.45), Math.sin(a) * sp, rr(rnd, 0.7, 1.1), rr(rnd, 0.3, 0.4), rr(rnd, 0.8, 1.0), rnd() < 0.5 ? FXF.puff : FXF.puff2);
      if (i < 0) break;
      tint(pool, i, BONE, 1, 0.75, 0);
      pool.drag[i] = 2.5;
      pool.rotV[i] = pm(rnd, 1);
      pool.rot[i] = rnd() * 6.28;
    }
  },
  sparkle(pool, rnd, x, y, z, s) {
    const k = K('sparkle');
    for (let c = 0; c < n(14, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.4), y + 0.6 + pm(rnd, 0.4), z + pm(rnd, 0.4), pm(rnd, 0.5), rr(rnd, 0.1, 0.6), pm(rnd, 0.5), rr(rnd, 0.6, 1.1), rr(rnd, 0.1, 0.16), 0.03, rnd() < 0.6 ? FXF.sparkle : FXF.star);
      if (i < 0) break;
      const roll = rnd();
      tint(pool, i, roll < 0.5 ? TOXIC : roll < 0.75 ? BONE : CANDLE, 2.2, 1, 1);
      pool.flicker[i] = 0.6;
      pool.drag[i] = 1.5;
      pool.rotV[i] = pm(rnd, 2);
    }
  },
  hearts(pool, rnd, x, y, z, s) {
    const k = K('hearts');
    for (let c = 0; c < n(6, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.2), y + 1.6 + pm(rnd, 0.1), z + pm(rnd, 0.2), 0, rr(rnd, 0.45, 0.7), 0, rr(rnd, 1.4, 2.0), 0.16, 0.24, FXF.heart);
      if (i < 0) break;
      tint(pool, i, ROSE, 1, 1, 0);
      pool.age[i] = -c * 0.12;
      pool.mode[i] = MODE_SWAY;
      pool.p0[i] = rr(rnd, 3, 4);
      pool.p1[i] = rnd() * 6.28;
      pool.p2[i] = 0.12;
      pool.rot[i] = pm(rnd, 0.3);
    }
  },
  flies(pool, rnd, x, y, z, s) {
    const k = K('flies');
    for (let c = 0; c < n(10, s); c++) {
      const i = pool.emit(k, x, y + 1.0, z, 0, 0, 0, rr(rnd, 3.5, 5), 0.06, 0.06, FXF.fly);
      if (i < 0) break;
      initFly(pool, i, rnd, -1);
    }
  },
  stench(pool, rnd, x, y, z, s) {
    const k = K('stench');
    for (let c = 0; c < n(5, s); c++) emitWisp(pool, k, rnd, x, y + 0.6, z, c * 0.25);
  },
  zzz(pool, rnd, x, y, z, s) {
    const k = K('zzz');
    for (let c = 0; c < n(3, s); c++) emitZee(pool, k, rnd, x, y, z, c * 0.6);
  },
  skillUp(pool, rnd, x, y, z, s) {
    const k = K('skillUp');
    const a = pool.emit(k, x, y + 1.95, z, 0, 0.55, 0, 1.4, 0.3, 0.42, FXF.arrow);
    if (a >= 0) tint(pool, a, TOXIC, 1.8, 1, 0.35);
    for (let c = 0; c < n(12, s); c++) {
      const ang = (c / 12) * Math.PI * 2;
      const i = pool.emit(k, x + Math.cos(ang) * 0.35, y + 0.4 + rnd() * 0.6, z + Math.sin(ang) * 0.35, Math.cos(ang) * 0.15, rr(rnd, 0.8, 1.2), Math.sin(ang) * 0.15, rr(rnd, 0.9, 1.4), 0.12, 0.03, FXF.star);
      if (i < 0) break;
      tint(pool, i, TOXIC, 2.4, 1, 1);
      pool.flicker[i] = 0.5;
      pool.rotV[i] = pm(rnd, 3);
    }
  },
  money(pool, rnd, x, y, z, s) {
    const k = K('money');
    for (let c = 0; c < n(8, s); c++) {
      const i = pool.emit(k, x, y + 1.4, z, pm(rnd, 0.8), rr(rnd, 1.6, 2.4), pm(rnd, 0.8), rr(rnd, 1.2, 1.6), 0.16, 0.14, rnd() < 0.6 ? FXF.coin : FXF.bill);
      if (i < 0) break;
      pool.gravity[i] = -5;
      pool.rotV[i] = pm(rnd, 6);
      pool.age[i] = -c * 0.04;
    }
  },
  fire(pool, rnd, x, y, z, s) {
    for (let c = 0; c < n(14, s); c++) emitEmber(pool, rnd, x, y, z);
    for (let c = 0; c < n(4, s); c++) emitFlame(pool, rnd, x, y, z);
    for (let c = 0; c < n(3, s); c++) emitSmoke(pool, rnd, x, y + 0.6, z, 0.55);
  },
  smoke(pool, rnd, x, y, z, s) {
    for (let c = 0; c < n(8, s); c++) {
      const i = emitSmoke(pool, rnd, x + pm(rnd, 0.3), y + 0.4, z + pm(rnd, 0.3), 0.6);
      if (i < 0) break;
      pool.age[i] = -c * 0.08;
    }
  },
  limbDrop(pool, rnd, x, y, z, s) {
    const k = K('limbDrop');
    for (let c = 0; c < n(6, s); c++) {
      const i = pool.emit(k, x, y + 0.9, z, pm(rnd, 1.2), rr(rnd, 1, 2), pm(rnd, 1.2), rr(rnd, 0.9, 1.2), rr(rnd, 0.08, 0.12), 0.08, FXF.splat);
      if (i < 0) break;
      pool.color(i, 0.45, 0.62, 0.26, 1, 0);
      pool.gravity[i] = -9;
      pool.rot[i] = rnd() * 6.28;
    }
    const b = pool.emit(k, x, y + 0.9, z, pm(rnd, 0.4), 2.2, pm(rnd, 0.4), 1.1, 0.22, 0.22, FXF.bone);
    if (b >= 0) {
      tint(pool, b, BONE, 1, 1, 0);
      pool.gravity[b] = -9;
      pool.rotV[b] = 8;
    }
    for (let c = 0; c < n(4, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.2), y + 0.08, z + pm(rnd, 0.2), pm(rnd, 0.5), 0.15, pm(rnd, 0.5), rr(rnd, 0.8, 1.1), 0.2, 0.55, FXF.dust);
      if (i < 0) break;
      pool.color(i, 0.7, 0.66, 0.58, 0.5, 0);
      pool.drag[i] = 2;
    }
  },
  reanimate(pool, rnd, x, y, z, s) {
    const k = K('reanimate');
    const f = pool.emit(k, x, y + 0.9, z, 0, 0, 0, 0.7, 1.1, 2.2, FXF.glow);
    // toxic-green flash (kept below white so the bolts inside it stay readable under bloom)
    if (f >= 0) pool.color(f, 0.55, 1.1, 0.8, 0.7, 1);
    for (let c = 0; c < n(10, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.5), y + rr(rnd, 0.5, 1.7), z + pm(rnd, 0.5), 0, 0, 0, rr(rnd, 0.12, 0.3), rr(rnd, 0.6, 0.9), rr(rnd, 0.6, 0.9), rnd() < 0.5 ? FXF.bolt1 : FXF.bolt2);
      if (i < 0) break;
      tint(pool, i, CRYO, 2.1, 1, 1);
      pool.rot[i] = rnd() * 6.28;
      pool.age[i] = -rnd() * 1.2;
      pool.flicker[i] = 0.4;
    }
    for (let c = 0; c < n(16, s); c++) {
      const ang = rnd() * Math.PI * 2;
      const i = pool.emit(k, x + Math.cos(ang) * 0.5, y + 0.1, z + Math.sin(ang) * 0.5, -Math.sin(ang) * 0.6, rr(rnd, 0.8, 1.5), Math.cos(ang) * 0.6, rr(rnd, 1, 1.6), 0.1, 0.03, FXF.sparkle);
      if (i < 0) break;
      tint(pool, i, rnd() < 0.5 ? CRYO : TOXIC, 2.4, 1, 1);
      pool.age[i] = -rnd() * 0.6;
    }
  },
  crumble(pool, rnd, x, y, z, s) {
    const k = K('crumble');
    for (let c = 0; c < n(16, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.3), y + rr(rnd, 0.3, 1.4), z + pm(rnd, 0.3), pm(rnd, 0.6), rr(rnd, 0, 0.8), pm(rnd, 0.6), rr(rnd, 1.2, 1.8), rr(rnd, 0.08, 0.14), 0.1, FXF.chunk);
      if (i < 0) break;
      pool.color(i, 0.78, 0.74, 0.64, 1, 0);
      pool.gravity[i] = -7;
      pool.rotV[i] = pm(rnd, 5);
    }
    for (let c = 0; c < n(8, s); c++) {
      const a = rnd() * Math.PI * 2;
      const i = pool.emit(k, x + pm(rnd, 0.4), y + rr(rnd, 0.1, 0.5), z + pm(rnd, 0.4), Math.cos(a) * 0.4, 0.15, Math.sin(a) * 0.4, rr(rnd, 1.6, 2.2), 0.4, 1.1, FXF.dust);
      if (i < 0) break;
      pool.color(i, 0.75, 0.7, 0.62, 0.55, 0);
      pool.drag[i] = 1.5;
    }
  },
  splash(pool, rnd, x, y, z, s) {
    const k = K('splash');
    for (let c = 0; c < n(12, s); c++) {
      const i = pool.emit(k, x, y + 0.3, z, pm(rnd, 1.2), rr(rnd, 1.5, 2.5), pm(rnd, 1.2), rr(rnd, 0.6, 0.9), 0.07, 0.06, FXF.drop);
      if (i < 0) break;
      pool.color(i, 0.55, 0.8, 1, 0.9, 0.2);
      pool.gravity[i] = -9;
    }
    for (let c = 0; c < n(2, s); c++) {
      const i = pool.emit(k, x, y + 0.08, z, 0, 0, 0, rr(rnd, 0.6, 0.8), 0.2, 0.9, FXF.ring);
      if (i < 0) break;
      pool.color(i, 0.7, 0.9, 1, 0.7, 0.2);
      pool.age[i] = -c * 0.15;
    }
  },
  notes(pool, rnd, x, y, z, s) {
    const k = K('notes');
    for (let c = 0; c < n(4, s); c++) emitNote(pool, k, rnd, x, y, z, c * 0.25);
  },
  anger(pool, rnd, x, y, z, s) {
    const k = K('anger');
    for (let c = 0; c < n(3, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.25), y + rr(rnd, 1.75, 1.95), z + pm(rnd, 0.25), 0, 0.05, 0, rr(rnd, 0.9, 1.2), 0.16, 0.26, FXF.anger);
      if (i < 0) break;
      pool.color(i, 0.95, 0.25, 0.2, 1, 0);
      pool.age[i] = -c * 0.18;
      pool.rot[i] = pm(rnd, 0.4);
    }
    for (let c = 0; c < n(3, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.1), y + 1.7, z + pm(rnd, 0.1), pm(rnd, 0.2), 0.6, pm(rnd, 0.2), 0.8, 0.15, 0.4, FXF.smoke);
      if (i < 0) break;
      pool.color(i, 0.3, 0.28, 0.3, 0.5, 0);
    }
  },
  confetti(pool, rnd, x, y, z, s) {
    const k = K('confetti');
    for (let c = 0; c < n(30, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.2), y + 1.0, z + pm(rnd, 0.2), pm(rnd, 1.5), rr(rnd, 2, 3.5), pm(rnd, 1.5), rr(rnd, 2.2, 3), rr(rnd, 0.06, 0.09), 0.07, rnd() < 0.7 ? FXF.confetti : FXF.streamer);
      if (i < 0) break;
      tint(pool, i, CONFETTI[Math.floor(rnd() * CONFETTI.length) % CONFETTI.length], 1.1, 1, 0);
      pool.gravity[i] = -3.5;
      pool.drag[i] = 1.2;
      pool.rotV[i] = pm(rnd, 10);
      pool.mode[i] = MODE_SWAY;
      pool.p0[i] = rr(rnd, 4, 6);
      pool.p1[i] = rnd() * 6.28;
      pool.p2[i] = 0.12;
    }
  },
  frost(pool, rnd, x, y, z, s) {
    const k = K('frost');
    for (let c = 0; c < n(12, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.5), y + rr(rnd, 0.6, 1.6), z + pm(rnd, 0.5), pm(rnd, 0.1), rr(rnd, -0.3, -0.15), pm(rnd, 0.1), rr(rnd, 1.8, 2.4), rr(rnd, 0.08, 0.14), 0.06, FXF.flake);
      if (i < 0) break;
      tint(pool, i, CRYO, 1.4, 1, 0.6);
      pool.rotV[i] = pm(rnd, 1);
      pool.mode[i] = MODE_SWAY;
      pool.p0[i] = 2;
      pool.p1[i] = rnd() * 6.28;
      pool.p2[i] = 0.1;
    }
    for (let c = 0; c < n(6, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.4), y + rr(rnd, 0.3, 1.2), z + pm(rnd, 0.4), 0, 0.1, 0, rr(rnd, 0.5, 0.9), 0.1, 0.02, FXF.shard);
      if (i < 0) break;
      tint(pool, i, CRYO, 2.2, 1, 1);
      pool.flicker[i] = 0.5;
    }
  },
  zap(pool, rnd, x, y, z, s) {
    const k = K('zap');
    for (let c = 0; c < n(8, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.25), y + rr(rnd, 0.8, 1.4), z + pm(rnd, 0.25), pm(rnd, 1.5), pm(rnd, 1.5), pm(rnd, 1.5), rr(rnd, 0.15, 0.35), 0.12, 0.04, FXF.spark);
      if (i < 0) break;
      pool.color(i, 0.6 * 2.5, 0.7 * 2.5, 1 * 2.5, 1, 1);
      pool.flicker[i] = 0.7;
      pool.rot[i] = rnd() * 6.28;
    }
    for (let c = 0; c < n(2, s); c++) {
      const i = pool.emit(k, x + pm(rnd, 0.2), y + rr(rnd, 0.9, 1.3), z + pm(rnd, 0.2), 0, 0, 0, 0.12, 0.5, 0.5, c % 2 === 0 ? FXF.bolt1 : FXF.bolt2);
      if (i < 0) break;
      pool.color(i, 0.7 * 2.5, 0.8 * 2.5, 1 * 2.5, 1, 1);
      pool.age[i] = -rnd() * 0.15;
      pool.rot[i] = rnd() * 6.28;
    }
  },
  tears(pool, rnd, x, y, z, s) {
    const k = K('tears');
    for (let c = 0; c < n(6, s); c++) {
      const side = c % 2 === 0 ? 1 : -1;
      const i = pool.emit(k, x + side * 0.08, y + 1.5, z + pm(rnd, 0.06), side * rr(rnd, 0.25, 0.45), 0.4, pm(rnd, 0.2), rr(rnd, 0.8, 1.1), 0.06, 0.07, FXF.tear);
      if (i < 0) break;
      pool.color(i, 0.55, 0.75, 1, 0.95, 0.1);
      pool.gravity[i] = -4;
      pool.age[i] = -c * 0.18;
    }
  },
};

// ───────────── shared emit helpers (used by bursts and persistent emitters) ─────────────

function initFly(pool: ParticlePool, i: number, rnd: Rnd, anchor: number): void {
  pool.color(i, 0.14, 0.12, 0.11, 1, 0);
  pool.mode[i] = MODE_ORBIT;
  pool.anchor[i] = anchor;
  pool.p0[i] = rr(rnd, 0.22, 0.5);
  pool.p1[i] = (rnd() < 0.5 ? -1 : 1) * rr(rnd, 3, 6);
  pool.p2[i] = rnd() * Math.PI * 2;
  pool.p3[i] = pm(rnd, 0.3);
}

function emitWisp(pool: ParticlePool, k: number, rnd: Rnd, x: number, y: number, z: number, delay: number): number {
  const i = pool.emit(k, x + pm(rnd, 0.3), y + rnd() * 0.3, z + pm(rnd, 0.3), 0, rr(rnd, 0.25, 0.4), 0, rr(rnd, 2, 2.8), 0.25, 0.55, FXF.wisp);
  if (i < 0) return i;
  pool.color(i, 0.55, 0.75, 0.3, 0.7, 0);
  pool.age[i] = -delay;
  pool.mode[i] = MODE_SWAY;
  pool.p0[i] = 2;
  pool.p1[i] = rnd() * 6.28;
  pool.p2[i] = 0.15;
  pool.rotV[i] = pm(rnd, 0.4);
  return i;
}

function emitZee(pool: ParticlePool, k: number, rnd: Rnd, x: number, y: number, z: number, delay: number): number {
  const i = pool.emit(k, x + 0.1, y + 0.15, z, 0.15, 0.35, 0.05, 2.2, 0.12, 0.3, FXF.zee);
  if (i < 0) return i;
  pool.color(i, 0.85, 0.88, 1, 0.95, 0);
  pool.age[i] = -delay;
  pool.mode[i] = MODE_SWAY;
  pool.p0[i] = 2.5;
  pool.p1[i] = rnd() * 6.28;
  pool.p2[i] = 0.08;
  pool.rot[i] = pm(rnd, 0.25);
  return i;
}

function emitNote(pool: ParticlePool, k: number, rnd: Rnd, x: number, y: number, z: number, delay: number): number {
  const i = pool.emit(k, x + pm(rnd, 0.3), y + rr(rnd, 1.1, 1.5), z + pm(rnd, 0.3), 0, rr(rnd, 0.4, 0.6), 0, rr(rnd, 1.6, 2.2), 0.14, 0.2, rnd() < 0.5 ? FXF.note1 : FXF.note2);
  if (i < 0) return i;
  const c = CONFETTI[Math.floor(rnd() * 4) % 4];
  tint(pool, i, c, 1.3, 1, 0.25);
  pool.age[i] = -delay;
  pool.mode[i] = MODE_SWAY;
  pool.p0[i] = 3;
  pool.p1[i] = rnd() * 6.28;
  pool.p2[i] = 0.15;
  pool.rot[i] = pm(rnd, 0.3);
  return i;
}

function emitEmber(pool: ParticlePool, rnd: Rnd, x: number, y: number, z: number): number {
  const i = pool.emit(K('fire'), x + pm(rnd, 0.25), y + rr(rnd, 0.15, 0.55), z + pm(rnd, 0.25), pm(rnd, 0.3), rr(rnd, 0.8, 1.6), pm(rnd, 0.3), rr(rnd, 0.6, 1.2), rr(rnd, 0.05, 0.08), 0.02, FXF.ember);
  if (i < 0) return i;
  pool.color(i, 2.2, 1.25, 0.5, 1, 1);
  pool.flicker[i] = 0.5;
  pool.drag[i] = 0.5;
  return i;
}

function emitFlame(pool: ParticlePool, rnd: Rnd, x: number, y: number, z: number): number {
  const i = pool.emit(K('fire'), x + pm(rnd, 0.15), y + rr(rnd, 0.15, 0.3), z + pm(rnd, 0.15), pm(rnd, 0.05), rr(rnd, 0.5, 0.8), pm(rnd, 0.05), rr(rnd, 0.4, 0.6), rr(rnd, 0.4, 0.5), 0.18, FXF.flame);
  if (i < 0) return i;
  pool.color(i, 1.6, 1.05, 0.5, 1, 1);
  pool.rot[i] = pm(rnd, 0.2);
  return i;
}

function emitSmoke(pool: ParticlePool, rnd: Rnd, x: number, y: number, z: number, alpha: number): number {
  const i = pool.emit(K('smoke'), x + pm(rnd, 0.15), y + rnd() * 0.2, z + pm(rnd, 0.15), pm(rnd, 0.15), rr(rnd, 0.35, 0.6), pm(rnd, 0.15), rr(rnd, 2, 3), rr(rnd, 0.35, 0.45), rr(rnd, 1.0, 1.3), rnd() < 0.6 ? FXF.smoke : FXF.puff2);
  if (i < 0) return i;
  pool.color(i, 0.3, 0.28, 0.3, alpha, 0);
  pool.drag[i] = 0.3;
  pool.rotV[i] = pm(rnd, 0.5);
  pool.rot[i] = rnd() * 6.28;
  return i;
}

// ───────────── persistent emitters (swarms, fire, zzz, notes) ─────────────

export type PersistentType = 'flySwarm' | 'stenchWisps' | 'sleepZ' | 'fireEmbers' | 'fireFlames' | 'fireSmoke' | 'musicNotes';

export interface PersistentDef {
  kind: FxKind;
  /** Seconds between emissions while active. */
  interval: number;
  /** Particles spawned immediately on activation (with randomised ages) so swarms start "full". */
  prewarm: number;
  emit(pool: ParticlePool, rnd: Rnd, x: number, y: number, z: number, anchor: number): number;
}

export const PERSISTENT_DEFS: Record<PersistentType, PersistentDef> = {
  flySwarm: {
    kind: 'flies',
    interval: 0.55,
    prewarm: 7,
    emit(pool, rnd, x, y, z, anchor) {
      const i = pool.emit(K('flies'), x, y, z, 0, 0, 0, rr(rnd, 3.4, 4.6), 0.055, 0.055, FXF.fly);
      if (i >= 0) initFly(pool, i, rnd, anchor);
      return i;
    },
  },
  stenchWisps: {
    kind: 'stench',
    interval: 0.75,
    prewarm: 2,
    emit(pool, rnd, x, y, z) {
      return emitWisp(pool, K('stench'), rnd, x, y, z, 0);
    },
  },
  sleepZ: {
    kind: 'zzz',
    interval: 1.3,
    prewarm: 1,
    emit(pool, rnd, x, y, z) {
      return emitZee(pool, K('zzz'), rnd, x, y, z, 0);
    },
  },
  fireEmbers: {
    kind: 'fire',
    interval: 0.06,
    prewarm: 6,
    emit(pool, rnd, x, y, z) {
      return emitEmber(pool, rnd, x, y, z);
    },
  },
  fireFlames: {
    kind: 'fire',
    interval: 0.11,
    prewarm: 4,
    emit(pool, rnd, x, y, z) {
      return emitFlame(pool, rnd, x, y, z);
    },
  },
  fireSmoke: {
    kind: 'smoke',
    interval: 0.32,
    prewarm: 4,
    emit(pool, rnd, x, y, z) {
      return emitSmoke(pool, rnd, x, y + 0.7, z, 0.5);
    },
  },
  musicNotes: {
    kind: 'notes',
    interval: 0.8,
    prewarm: 1,
    emit(pool, rnd, x, y, z) {
      return emitNote(pool, K('notes'), rnd, x, y - 0.9, z, 0);
    },
  },
};

/** Fire a one-shot burst; unknown kinds are ignored (returns false). */
export function burst(kind: unknown, pool: ParticlePool, rnd: Rnd, x: number, y: number, z: number, scale = 1): boolean {
  if (typeof kind !== 'string' || !(FX_KINDS as readonly string[]).includes(kind)) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  FX_BURSTS[kind as FxKind](pool, rnd, x, y, z, scale);
  return true;
}
