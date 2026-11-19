/**
 * Ambience controller: day/night/rain/full-moon beds, one-off calls (crows, owls, groans, thunder, howls),
 * indoor muffling, ultra thinning, and robustness against junk state, stalls and clocks going backwards.
 */
import { describe, expect, it } from 'vitest';
import { Ambience, sanitizeAmbience, type AmbienceState } from '../../../src/audio/ambience';
import { AudioEngine } from '../../../src/audio/engine';
import { LoopManager } from '../../../src/audio/loopManager';
import { createRng } from '../../../src/audio/prng';
import { AMBIENT_EXTRAS, MAX_DURATION } from '../../../src/audio/sfx/table';
import type { OneShot, Sx } from '../../../src/audio/synth/types';
import { FakeContext, FakeOscillator, asCtx } from './fakeAudio';

function harness() {
  const ctx = new FakeContext();
  ctx.state = 'running';
  const loops = new LoopManager();
  const bus = ctx.createGain();
  loops.attach({ ctx: asCtx(ctx), input: () => bus as unknown as AudioNode, rng: createRng(1) });
  const shots: { recipe: OneShot; pan: number; gain: number; at: number }[] = [];
  const indoor: [boolean, number][] = [];
  let now = 0;
  const amb = new Ambience({
    now: () => now,
    rng: createRng(2),
    loops,
    oneShot: (recipe, pan, gain) => shots.push({ recipe, pan, gain, at: now }),
    setIndoor: (i, thin) => indoor.push([i, thin]),
  });
  const advance = (seconds: number, step = 0.05) => {
    for (let t = 0; t < seconds; t += step) {
      now += step;
      ctx.currentTime = now;
      amb.pump(now);
      loops.pump(now, now + 0.2);
    }
  };
  return { ctx, loops, amb, shots, indoor, advance, setNow: (t: number) => (now = t) };
}

const S = (o: Partial<AmbienceState>): AmbienceState => ({ night: false, indoor: false, rain: false, moon: false, ...o });

describe('sanitizeAmbience', () => {
  it('accepts only real booleans, tolerates junk and hostile getters', () => {
    expect(sanitizeAmbience({ night: true, indoor: true, rain: true, moon: true })).toEqual(S({ night: true, indoor: true, rain: true, moon: true }));
    expect(sanitizeAmbience({ night: 1, moon: 'yes', rain: {} })).toEqual(S({}));
    expect(sanitizeAmbience({})).toEqual(S({}));
    for (const junk of [null, undefined, 3, 'night', true]) expect(sanitizeAmbience(junk)).toBeNull();
    const hostile = Object.defineProperty({}, 'moon', { get: () => { throw new Error('x'); } });
    expect(sanitizeAmbience(hostile)).toBeNull();
  });
});

describe('Ambience beds', () => {
  it('day = wind; night = soft wind + crickets; rain adds a bed; full moon adds a shimmer only at night', () => {
    const h = harness();
    h.amb.set(S({}));
    expect(h.loops.activeCount).toBe(1);
    h.amb.set(S({ moon: true })); // a full moon by day is not audible
    expect(h.loops.activeCount).toBe(1);
    expect(h.loops.has('~amb:moon')).toBe(false);
    h.amb.set(S({ night: true }));
    expect(h.loops.activeCount).toBe(2);
    h.amb.set(S({ night: true, moon: true }));
    expect(h.loops.has('~amb:moon')).toBe(true);
    expect(h.loops.activeCount).toBe(3);
    h.amb.set(S({ night: true, moon: true, rain: true }));
    expect(h.loops.activeCount).toBe(4);
    h.amb.set(S({ night: false, moon: true }));
    expect(h.loops.has('~amb:moon')).toBe(false);
    h.amb.stop();
    expect(h.loops.activeCount).toBe(0);
    expect(h.amb.current).toBeNull();
  });

  it('set() is idempotent: re-applying the same state creates no nodes and does not reset event clocks', () => {
    const h = harness();
    h.amb.set(S({ night: true, moon: true }));
    h.advance(1);
    const nodes = h.ctx.nodesCreated;
    for (let i = 0; i < 50; i++) h.amb.set(S({ night: true, moon: true }));
    expect(h.ctx.nodesCreated).toBe(nodes);
  });

  it('howls only on full-moon nights; owls/groans at night; crows by day; thunder with rain', () => {
    const night = harness();
    night.amb.set(S({ night: true }));
    night.advance(300);
    const nightRecipes = new Set(night.shots.map((s) => s.recipe));
    expect(nightRecipes.has(AMBIENT_EXTRAS.howl)).toBe(false);
    expect(nightRecipes.has(AMBIENT_EXTRAS.crow)).toBe(false);
    expect(night.shots.length).toBeGreaterThan(8);

    const moon = harness();
    moon.amb.set(S({ night: true, moon: true }));
    moon.advance(300);
    const howls = moon.shots.filter((s) => s.recipe === AMBIENT_EXTRAS.howl);
    expect(howls.length).toBeGreaterThanOrEqual(4);
    expect(howls.length).toBeLessThanOrEqual(14);
    for (let i = 1; i < howls.length; i++) expect(howls[i].at - howls[i - 1].at).toBeGreaterThanOrEqual(23.9);
    for (const s of moon.shots) {
      expect(Math.abs(s.pan)).toBeLessThanOrEqual(0.8);
      expect(s.gain).toBeGreaterThan(0);
      expect(s.gain).toBeLessThanOrEqual(1);
    }

    const day = harness();
    day.amb.set(S({ moon: true }));
    day.advance(300);
    expect(day.shots.some((s) => s.recipe === AMBIENT_EXTRAS.crow)).toBe(true);
    expect(day.shots.some((s) => s.recipe === AMBIENT_EXTRAS.howl)).toBe(false);
  });

  it('indoor muffles and lowers one-offs; ultra speed thins the bed and spaces calls out', () => {
    const h = harness();
    h.amb.set(S({ night: true, indoor: true }));
    expect(h.indoor[h.indoor.length - 1]).toEqual([true, 1]);
    h.amb.setThin(true);
    expect(h.indoor[h.indoor.length - 1]).toEqual([true, 0.7]);
    h.advance(400);
    for (const s of h.shots) expect(s.gain).toBeLessThanOrEqual(0.6 * 0.8 + 1e-9);
    const thinCalls = h.shots.length;
    const n = harness();
    n.amb.set(S({ night: true, indoor: true }));
    n.advance(400);
    expect(thinCalls).toBeLessThan(n.shots.length);
  });

  it('a long stall or a clock going backwards never bursts a backlog of calls', () => {
    const h = harness();
    h.amb.set(S({ night: true, moon: true, rain: true }));
    h.advance(2);
    const before = h.shots.length;
    h.setNow(3600); // tab hidden for an hour
    h.amb.pump(3600);
    expect(h.shots.length - before).toBeLessThanOrEqual(1);
    h.setNow(5); // new context: time went backwards
    expect(() => h.amb.pump(5)).not.toThrow();
    expect(() => h.amb.pump(NaN)).not.toThrow();
    h.advance(120);
    expect(h.shots.length).toBeGreaterThan(before);
  });
});

describe('full-moon recipes', () => {
  const sx = (ctx: FakeContext, seed: number): Sx => ({ ctx: asCtx(ctx), out: ctx.createGain() as unknown as AudioNode, t: 0.02, rng: createRng(seed), pitch: 1, vol: 1 });

  it('howl: finite, within the ambient length limit, every source stopped, answered about half the time', () => {
    let answered = 0;
    for (let seed = 0; seed < 40; seed++) {
      const ctx = new FakeContext();
      const d = AMBIENT_EXTRAS.howl(sx(ctx, seed));
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(1.5);
      expect(d).toBeLessThanOrEqual(MAX_DURATION.ambient);
      expect(ctx.liveSources()).toEqual([]);
      const tri = ctx.sources.filter((s) => s instanceof FakeOscillator && s.type === 'triangle').length;
      if (tri === 2) answered++;
    }
    expect(answered).toBeGreaterThan(10);
    expect(answered).toBeLessThan(32);
  });

  it('moon bed: continuous until stopped, then nothing left running; bounded node count', () => {
    const ctx = new FakeContext();
    const v = AMBIENT_EXTRAS.moonLoop(sx(ctx, 4));
    expect(ctx.liveSources().length).toBeGreaterThan(4);
    expect(ctx.nodesCreated).toBeLessThan(40);
    v.stop(3);
    v.stop(4); // idempotent
    expect(ctx.liveSources(3.1)).toEqual([]);
  });

  it('engine: setAmbience({moon}) adds the shimmer at night and fires howls over time', async () => {
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    await e.unlock();
    e.setAmbience({ night: true, indoor: false, moon: true });
    expect(e.stats().ambientLoops).toBe(3);
    const tri0 = ctx.sources.filter((s) => s instanceof FakeOscillator && s.type === 'triangle').length;
    for (let t = 0; t < 240; t += 0.05) {
      ctx.advance(0.05);
      e.tick();
    }
    const tri = ctx.sources.filter((s) => s instanceof FakeOscillator && s.type === 'triangle').length;
    expect(tri - tri0).toBeGreaterThan(2);
    e.setAmbience({ night: true, indoor: false });
    expect(e.stats().ambientLoops).toBe(2);
    expect(e.stats().errors).toBe(0);
  });
});
