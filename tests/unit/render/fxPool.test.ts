import { describe, it, expect } from 'vitest';
import { ParticlePool, DEFAULT_KIND_CAPS, FX_KIND_COUNT, kindIndex, MODE_ORBIT, MAX_ANCHORS, FX_ATLAS_COLS, FX_ATLAS_ROWS, FXF } from '../../../src/render/fx/fxPool';
import { FX_BURSTS, PERSISTENT_DEFS, burst } from '../../../src/render/fx/fxKinds';
import { FX_KINDS } from '../../../src/sim/contracts';
import { mulberry32 } from '../../../src/render/core/math';

describe('particle pool caps', () => {
  it('global capacity is never exceeded', () => {
    const pool = new ParticlePool(50);
    const rnd = mulberry32(1);
    for (let i = 0; i < 200; i++) for (const k of FX_KINDS) burst(k, pool, rnd, 5, 0, 5);
    expect(pool.count).toBeLessThanOrEqual(50);
    expect(pool.count).toBe(50);
  });

  it('per-kind caps are never exceeded even with a huge pool', () => {
    const pool = new ParticlePool(20000);
    const rnd = mulberry32(2);
    for (let i = 0; i < 100; i++) for (const k of FX_KINDS) burst(k, pool, rnd, 5, 0, 5);
    for (let k = 0; k < FX_KIND_COUNT; k++) {
      expect(pool.countByKind[k]).toBeLessThanOrEqual(DEFAULT_KIND_CAPS[FX_KINDS[k]]);
    }
    // per-kind counters add up to the total
    const sum = pool.countByKind.reduce((a, b) => a + b, 0);
    expect(sum).toBe(pool.count);
  });

  it('cap scaling (quality) shrinks caps; garbage scale is ignored', () => {
    const half = new ParticlePool(1000, DEFAULT_KIND_CAPS, 0.5);
    expect(half.caps[kindIndex('confetti')]).toBe(Math.floor(DEFAULT_KIND_CAPS.confetti * 0.5));
    const g = new ParticlePool(1000, DEFAULT_KIND_CAPS, NaN);
    expect(g.caps[kindIndex('confetti')]).toBe(DEFAULT_KIND_CAPS.confetti);
    const zero = new ParticlePool(1000, { puff: 0 });
    expect(zero.emit(kindIndex('puff'), 0, 0, 0, 0, 0, 0, 1, 1, 1, 0)).toBe(-1);
  });

  it('room() reports the remaining space', () => {
    const pool = new ParticlePool(10);
    const k = kindIndex('puff');
    expect(pool.room(k)).toBe(10);
    for (let i = 0; i < 4; i++) pool.emit(k, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0);
    expect(pool.room(k)).toBe(6);
    expect(pool.room(-1)).toBe(0);
    expect(pool.room(999)).toBe(0);
  });

  it('expired particles are retired and counters stay consistent through swap-removes', () => {
    const pool = new ParticlePool(100);
    const rnd = mulberry32(3);
    burst('confetti', pool, rnd, 0, 0, 0);
    burst('puff', pool, rnd, 0, 0, 0);
    const start = pool.count;
    expect(start).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) pool.update(0.1); // 4 s > every life in these bursts
    expect(pool.count).toBe(0);
    expect(pool.countByKind.every((c) => c === 0)).toBe(true);
  });

  it('particles never sink below the floor', () => {
    const pool = new ParticlePool(100);
    const rnd = mulberry32(4);
    burst('money', pool, rnd, 0, 0, 0);
    for (let i = 0; i < 12; i++) {
      pool.update(0.1);
      for (let p = 0; p < pool.count; p++) expect(pool.py[p]).toBeGreaterThanOrEqual(0.0099);
    }
  });

  it('killAnchor removes only that anchor’s orbiters', () => {
    const pool = new ParticlePool(100);
    const rnd = mulberry32(5);
    for (let i = 0; i < 5; i++) PERSISTENT_DEFS.flySwarm.emit(pool, rnd, 0, 1, 0, 3);
    for (let i = 0; i < 4; i++) PERSISTENT_DEFS.flySwarm.emit(pool, rnd, 0, 1, 0, 7);
    expect(pool.count).toBe(9);
    pool.killAnchor(3);
    expect(pool.count).toBe(4);
    for (let i = 0; i < pool.count; i++) {
      expect(pool.anchor[i]).toBe(7);
      expect(pool.mode[i]).toBe(MODE_ORBIT);
    }
  });

  it('writeRender packs every live particle with finite values; delayed particles are invisible', () => {
    const pool = new ParticlePool(256);
    const rnd = mulberry32(6);
    for (const k of FX_KINDS) burst(k, pool, rnd, 3, 0.5, 4);
    pool.anchors[0] = 1;
    const n = pool.count;
    const pos = new Float32Array(n * 3);
    const sr = new Float32Array(n * 2);
    const col = new Float32Array(n * 4);
    const meta = new Float32Array(n * 2);
    pool.update(0.05);
    const w = pool.writeRender(1.5, pos, sr, col, meta);
    expect(w).toBe(pool.count);
    for (let i = 0; i < w; i++) {
      for (const v of [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], sr[i * 2], sr[i * 2 + 1], col[i * 4 + 3], meta[i * 2]]) expect(Number.isFinite(v)).toBe(true);
      expect(col[i * 4 + 3]).toBeGreaterThanOrEqual(0);
      if (pool.age[i] < 0) expect(col[i * 4 + 3]).toBe(0);
      expect(meta[i * 2]).toBeGreaterThanOrEqual(0);
      expect(meta[i * 2]).toBeLessThan(FX_ATLAS_COLS * FX_ATLAS_ROWS);
    }
    // undersized output buffers never overflow
    expect(pool.writeRender(0, new Float32Array(3), new Float32Array(2), new Float32Array(4), new Float32Array(2))).toBe(1);
  });

  describe('adversarial', () => {
    it('unknown kinds / non-finite positions are ignored', () => {
      const pool = new ParticlePool(64);
      const rnd = mulberry32(7);
      expect(burst('fireworks', pool, rnd, 0, 0, 0)).toBe(false);
      expect(burst(42, pool, rnd, 0, 0, 0)).toBe(false);
      expect(burst(null, pool, rnd, 0, 0, 0)).toBe(false);
      expect(burst('puff', pool, rnd, NaN, 0, 0)).toBe(false);
      expect(pool.emit(-1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0)).toBe(-1);
      expect(pool.emit(kindIndex('puff'), Infinity, 0, 0, 0, 0, 0, 1, 1, 1, 0)).toBe(-1);
      expect(pool.count).toBe(0);
    });

    it('garbage velocities / life / sizes are sanitised', () => {
      const pool = new ParticlePool(8);
      const i = pool.emit(kindIndex('puff'), 0, 1, 0, NaN, Infinity, -Infinity, NaN, NaN, NaN, FXF.puff);
      expect(i).toBe(0);
      expect([pool.vx[0], pool.vy[0], pool.vz[0]]).toEqual([0, 0, 0]);
      expect(pool.life[0]).toBeGreaterThan(0);
      expect(Number.isFinite(pool.size0[0]) && Number.isFinite(pool.size1[0])).toBe(true);
      pool.update(NaN);
      pool.update(-5);
      pool.update(1e9); // clamped to 0.25 s
      expect(pool.count).toBe(0); // life was sanitised to a tiny value and has elapsed
    });

    it('garbage capacity becomes 1; kill out of range is a no-op', () => {
      const pool = new ParticlePool(NaN);
      expect(pool.capacity).toBe(1);
      pool.kill(5);
      pool.kill(-1);
      expect(pool.count).toBe(0);
    });

    it('burst scale garbage still emits something and never exceeds caps', () => {
      const pool = new ParticlePool(5000);
      const rnd = mulberry32(8);
      for (const k of FX_KINDS) {
        burst(k, pool, rnd, 0, 0, 0, NaN);
        burst(k, pool, rnd, 0, 0, 0, -3);
        burst(k, pool, rnd, 0, 0, 0, 1e6);
      }
      expect(pool.count).toBeGreaterThan(0);
      for (let k = 0; k < FX_KIND_COUNT; k++) expect(pool.countByKind[k]).toBeLessThanOrEqual(pool.caps[k]);
    });
  });
});

describe('fx definitions', () => {
  it('every FxKind has a burst that emits at least one particle of its own kind (or its smoke/fire family)', () => {
    for (const k of FX_KINDS) {
      expect(typeof FX_BURSTS[k]).toBe('function');
      const pool = new ParticlePool(512);
      burst(k, pool, mulberry32(9), 1, 0, 1);
      expect(pool.count, k).toBeGreaterThan(0);
    }
  });

  it('persistent emitters reference real kinds and respect caps', () => {
    for (const [name, def] of Object.entries(PERSISTENT_DEFS)) {
      expect(kindIndex(def.kind), name).toBeGreaterThanOrEqual(0);
      expect(def.interval).toBeGreaterThan(0);
      const pool = new ParticlePool(10000);
      const rnd = mulberry32(10);
      for (let i = 0; i < 1000; i++) def.emit(pool, rnd, 0, 1, 0, 0);
      expect(pool.countByKind[kindIndex(def.kind)]).toBeLessThanOrEqual(pool.caps[kindIndex(def.kind)]);
    }
  });

  it('anchor table is large enough for every on-lot agent and object emitters', () => {
    expect(MAX_ANCHORS).toBeGreaterThanOrEqual(64);
  });
});
