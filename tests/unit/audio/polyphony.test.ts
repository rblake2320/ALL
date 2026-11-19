import { describe, expect, it } from 'vitest';
import { RateLimiter, VoicePool } from '../../../src/audio/polyphony';

function makePool(cap: number) {
  const stolen: string[] = [];
  const expired: string[] = [];
  const pool = new VoicePool<string>(cap, { steal: (s) => stolen.push(s), expire: (s) => expired.push(s) });
  return { pool, stolen, expired };
}

describe('VoicePool', () => {
  it('never exceeds capacity and steals the oldest voice', () => {
    const { pool, stolen } = makePool(24);
    for (let i = 0; i < 24; i++) pool.add(`v${i}`, i * 0.01, 10);
    expect(pool.size).toBe(24);
    expect(stolen).toEqual([]);
    const s = pool.add('new', 0.5, 10);
    expect(s).toBe('v0');
    expect(stolen).toEqual(['v0']);
    expect(pool.size).toBe(24);
    pool.add('new2', 0.6, 10);
    expect(stolen).toEqual(['v0', 'v1']);
  });

  it('ties on start time break by insertion order', () => {
    const { pool, stolen } = makePool(3);
    pool.add('a', 1, 5);
    pool.add('b', 1, 5);
    pool.add('c', 1, 5);
    pool.add('d', 1, 5);
    expect(stolen).toEqual(['a']);
    pool.add('e', 1, 5);
    expect(stolen).toEqual(['a', 'b']);
  });

  it('prunes finished voices instead of stealing', () => {
    const { pool, stolen, expired } = makePool(2);
    pool.add('short', 0, 0.1);
    pool.add('long', 0, 5);
    pool.add('third', 0.2, 1);
    expect(expired).toEqual(['short']);
    expect(stolen).toEqual([]);
    expect(pool.prune(10)).toBe(2);
    expect(pool.size).toBe(0);
  });

  it('stops whole groups (same zombie speaking again)', () => {
    const { pool, stolen } = makePool(6);
    pool.add('z1-a', 0, 5, 101);
    pool.add('z2-a', 0, 5, 202);
    pool.add('z1-b', 0.1, 5, 101);
    expect(pool.stopGroup(101)).toBe(2);
    expect(stolen.sort()).toEqual(['z1-a', 'z1-b']);
    expect(pool.size).toBe(1);
    expect(pool.stopGroup(NaN)).toBe(0);
    expect(pool.stopGroup(999)).toBe(0);
  });

  it('handles adversarial numbers and throwing hooks', () => {
    const pool = new VoicePool<number>(NaN, {
      steal: () => { throw new Error('steal'); },
      expire: () => { throw new Error('expire'); },
    });
    expect(pool.capacity).toBe(1);
    pool.add(1, NaN, NaN);
    pool.add(2, Infinity, -Infinity);
    expect(pool.size).toBe(1);
    expect(() => pool.prune(Infinity)).not.toThrow();
    expect(pool.size).toBe(0);
    pool.add(3, 0, 1);
    expect(() => pool.clear(true)).not.toThrow();
    expect(pool.size).toBe(0);
  });

  it('end before start is treated as zero-length', () => {
    const { pool, expired } = makePool(4);
    pool.add('x', 5, 1);
    pool.prune(5);
    expect(expired).toEqual(['x']);
  });

  it('stress: 10k random adds keep invariants', () => {
    const { pool } = makePool(24);
    let t = 0;
    for (let i = 0; i < 10000; i++) {
      t += ((i * 7919) % 13) / 1000;
      pool.add(`v${i}`, t, t + ((i * 31) % 17) / 10);
      expect(pool.size).toBeLessThanOrEqual(24);
    }
    let live = 0;
    pool.forEach(() => live++);
    expect(live).toBe(pool.size);
  });
});

describe('RateLimiter', () => {
  it('caps bursts per key inside the window', () => {
    const rl = new RateLimiter(4, 3, 0.05);
    expect(rl.allow(0, 1.0)).toBe(true);
    expect(rl.allow(0, 1.001)).toBe(true);
    expect(rl.allow(0, 1.002)).toBe(true);
    expect(rl.allow(0, 1.003)).toBe(false);
    expect(rl.allow(1, 1.003)).toBe(true); // other keys independent
    expect(rl.allow(0, 1.06)).toBe(true); // window passed
  });

  it('resets on time going backwards and ignores bad keys/times', () => {
    const rl = new RateLimiter(2, 1, 0.1);
    expect(rl.allow(0, 5)).toBe(true);
    expect(rl.allow(0, 5.01)).toBe(false);
    expect(rl.allow(0, 1)).toBe(true); // new context
    expect(rl.allow(-1, 1)).toBe(true);
    expect(rl.allow(99, 1)).toBe(true);
    expect(rl.allow(NaN, 1)).toBe(true);
    expect(rl.allow(0, NaN)).toBe(true);
  });
});
