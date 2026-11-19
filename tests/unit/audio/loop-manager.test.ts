import { describe, expect, it } from 'vitest';
import { LoopManager, MAX_LOOPS, specForSfx, type LoopSpec } from '../../../src/audio/loopManager';
import { createRng } from '../../../src/audio/prng';
import type { LoopVoice } from '../../../src/audio/synth/types';
import { FakeContext, FakeGain, FakePanner, asCtx } from './fakeAudio';

function host(ctx: FakeContext) {
  const bus = ctx.createGain();
  return { ctx: asCtx(ctx), input: () => bus as unknown as AudioNode, rng: createRng(1) };
}

/** A loop factory that records its lifecycle. */
function probeSpec(log: string[], name: string, opts: Partial<LoopSpec> = {}): LoopSpec {
  return {
    bus: 'sfx',
    trim: 1,
    ...opts,
    factory: (): LoopVoice => {
      log.push(`start:${name}`);
      return {
        stop: () => log.push(`stop:${name}`),
        schedule: (from, to) => {
          if (!(to > from)) log.push(`badwindow:${name}`);
        },
      };
    },
  };
}

describe('LoopManager', () => {
  it('remembers desired loops before a context exists, then materialises them', () => {
    const lm = new LoopManager();
    const log: string[] = [];
    lm.set('a', probeSpec(log, 'A'), true, 0, 1);
    lm.set('b', probeSpec(log, 'B'), true, 0, 1);
    lm.set('b', null, false, 0, 0);
    expect(log).toEqual([]);
    expect(lm.desiredCount).toBe(1);
    lm.attach(host(new FakeContext()));
    expect(log).toEqual(['start:A']);
    expect(lm.activeCount).toBe(1);
  });

  it('re-calling with on=true only updates spatial; same key with a new sound crossfades', () => {
    const ctx = new FakeContext();
    const lm = new LoopManager();
    lm.attach(host(ctx));
    const log: string[] = [];
    const A = probeSpec(log, 'A');
    lm.set('k', A, true, 0, 1);
    const nodes = ctx.nodesCreated;
    for (let i = 0; i < 50; i++) lm.set('k', A, true, 0.5, 0.5);
    expect(ctx.nodesCreated).toBe(nodes);
    expect(log).toEqual(['start:A']);
    lm.set('k', probeSpec(log, 'B'), true, 0, 1);
    expect(log).toEqual(['start:A', 'stop:A', 'start:B']);
    expect(lm.activeCount).toBe(1);
    expect(lm.desiredCount).toBe(1);
  });

  it('spatial updates are change-thresholded (no automation spam when nothing moved)', () => {
    const ctx = new FakeContext();
    const lm = new LoopManager();
    lm.attach(host(ctx));
    const spec = probeSpec([], 'S');
    lm.set('s', spec, true, 0.2, 0.8);
    const base = ctx.paramEvents;
    for (let i = 0; i < 100; i++) lm.set('s', spec, true, 0.2 + 1e-4, 0.8 + 1e-4);
    expect(ctx.paramEvents).toBe(base);
    lm.set('s', spec, true, 0.6, 0.3); // a real move schedules smooth glides
    expect(ctx.paramEvents).toBeGreaterThan(base);
    const out = ctx.nodes.find((n): n is FakeGain => n instanceof FakeGain && [...n.outputs].some((o) => o instanceof FakePanner));
    const ev = out!.gain.events[out!.gain.events.length - 1];
    expect(ev.type).toBe('target');
    expect(ev.value).toBeCloseTo(0.3);
  });

  it('caps active loops; evicts the quietest only for a louder newcomer; refills freed slots', () => {
    const ctx = new FakeContext();
    const lm = new LoopManager();
    lm.attach(host(ctx));
    const log: string[] = [];
    for (let i = 0; i < MAX_LOOPS; i++) lm.set(`k${i}`, probeSpec(log, `L${i}`), true, 0, 0.5 + i * 0.01);
    expect(lm.activeCount).toBe(MAX_LOOPS);
    lm.set('quiet', probeSpec(log, 'Q'), true, 0, 0.1);
    expect(lm.activeCount).toBe(MAX_LOOPS);
    expect(log).not.toContain('start:Q');
    lm.set('loud', probeSpec(log, 'LOUD'), true, 0, 1);
    expect(log).toContain('stop:L0');
    expect(log).toContain('start:LOUD');
    expect(lm.activeCount).toBe(MAX_LOOPS);
    // free two slots: the evicted L0 and the waiting Q come back on the next pump
    lm.set('k5', null, false, 0, 0);
    lm.set('k6', null, false, 0, 0);
    lm.pump(ctx.currentTime, ctx.currentTime + 0.2);
    expect(log.filter((l) => l === 'start:Q').length + log.filter((l) => l === 'start:L0').length).toBe(3);
  });

  it('stopAll fades every loop and later disconnects outputs', () => {
    const ctx = new FakeContext();
    ctx.state = 'running';
    const lm = new LoopManager();
    lm.attach(host(ctx));
    const log: string[] = [];
    for (let i = 0; i < 5; i++) lm.set(`k${i}`, probeSpec(log, `L${i}`), true, 0, 1);
    const outs = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && [...n.outputs].some((o) => o instanceof FakePanner));
    expect(outs.length).toBe(5);
    lm.stopAll();
    expect(lm.activeCount).toBe(0);
    expect(log.filter((l) => l.startsWith('stop:')).length).toBe(5);
    for (const g of outs) expect(g.gain.lastTarget()).toBe(0);
    lm.pump(ctx.currentTime + 0.1, ctx.currentTime + 0.3);
    expect(outs.every((g) => g.disconnected === 0)).toBe(true); // still fading
    ctx.currentTime += 2;
    lm.pump(ctx.currentTime, ctx.currentTime + 0.2);
    expect(outs.every((g) => g.disconnected > 0)).toBe(true);
  });

  it('footstep loops are silenced at high speed and restored after', () => {
    const ctx = new FakeContext();
    const lm = new LoopManager();
    lm.attach(host(ctx));
    const spec = specForSfx('footstep');
    expect(spec).not.toBeNull();
    lm.set('steps', spec, true, 0, 0.9);
    const out = ctx.nodes.find((n): n is FakeGain => n instanceof FakeGain && [...n.outputs].some((o) => o instanceof FakePanner));
    expect(out).toBeDefined();
    expect(out!.gain.lastTarget()).toBeCloseTo(0.9 * (spec!.trim ?? 1));
    lm.setFootstepMute(true);
    expect(out!.gain.lastTarget()).toBe(0);
    lm.set('steps', spec, true, 0.3, 0.9); // spatial updates keep it muted
    expect(out!.gain.lastTarget()).toBe(0);
    lm.setFootstepMute(false);
    expect(out!.gain.lastTarget()).toBeCloseTo(0.9 * (spec!.trim ?? 1));
    expect(lm.activeCount).toBe(1);
  });

  it('pump hands monotonic, non-empty windows to event-driven loops; broken recipes are contained', () => {
    const ctx = new FakeContext();
    ctx.state = 'running';
    const lm = new LoopManager();
    lm.attach(host(ctx));
    const log: string[] = [];
    lm.set('ok', probeSpec(log, 'OK'), true, 0, 1);
    lm.set('bad', { bus: 'sfx', trim: 1, factory: () => ({ stop() { throw new Error('x'); }, schedule() { throw new Error('y'); } }) }, true, 0, 1);
    lm.set('throws', { bus: 'sfx', trim: 1, factory: () => { throw new Error('factory'); } }, true, 0, 1);
    for (let i = 0; i < 100; i++) {
      ctx.currentTime += 0.025;
      expect(() => lm.pump(ctx.currentTime, ctx.currentTime + 0.2)).not.toThrow();
    }
    expect(log.filter((l) => l.startsWith('badwindow')).length).toBe(0);
    expect(() => lm.stopAll()).not.toThrow();
    expect(() => lm.dispose()).not.toThrow();
  });

  it('specForSfx caches and rejects unknown ids', () => {
    expect(specForSfx('shower')).toBe(specForSfx('shower'));
    expect(specForSfx('nope' as never)).toBeNull();
    const g = specForSfx('cash');
    expect(g?.bus).toBe('ui');
    expect((g?.trim ?? 0) > 0).toBe(true);
  });
});
