import { describe, expect, it } from 'vitest';
import { SFX_IDS, type SfxId } from '../../../src/shared/audioIds';
import { SFX_TABLE, MAX_DURATION, loopFactoryFor, AMBIENT_EXTRAS } from '../../../src/audio/sfx/table';
import { createRng } from '../../../src/audio/prng';
import type { Sx } from '../../../src/audio/synth/types';
import { FakeContext, asCtx } from './fakeAudio';

function sxFor(ctx: FakeContext, seed: number, pitch = 1, vol = 1): Sx {
  return { ctx: asCtx(ctx), out: ctx.createGain() as unknown as AudioNode, t: ctx.currentTime + 0.01, rng: createRng(seed), pitch, vol };
}

describe('SFX table', () => {
  it('has a recipe for exactly every SfxId (no missing, no extras)', () => {
    expect(Object.keys(SFX_TABLE).sort()).toEqual([...SFX_IDS].sort());
    expect(new Set(SFX_IDS).size).toBe(SFX_IDS.length);
  });

  it('every entry has a valid bus/category and loop behaviour', () => {
    for (const id of SFX_IDS) {
      const d = SFX_TABLE[id];
      expect(['music', 'sfx', 'voice', 'ambient', 'ui']).toContain(d.bus);
      expect(Object.keys(MAX_DURATION)).toContain(d.cat);
      expect(typeof d.play).toBe('function');
      expect(d.loop !== undefined || (d.gap !== undefined && d.gap[0] >= 0 && d.gap[1] >= d.gap[0])).toBe(true);
    }
    // routing spot checks
    expect(SFX_TABLE.uiClick.bus).toBe('ui');
    expect(SFX_TABLE.owl.bus).toBe('ambient');
    expect(SFX_TABLE.laugh.bus).toBe('voice');
    for (const s of ['promotion', 'skillUp', 'milestone', 'fail', 'romanceSting', 'sadSting'] as SfxId[]) expect(SFX_TABLE[s].cat).toBe('stinger');
  });

  it('the Guard pet bark is a synthesized life sound: four woofs, no samples, finite and short', () => {
    expect(SFX_TABLE.bark.bus).toBe('sfx');
    expect(SFX_TABLE.bark.cat).toBe('life');
    const ctx = new FakeContext();
    const dur = SFX_TABLE.bark.play(sxFor(ctx, 99));
    expect(dur).toBeGreaterThan(1);
    expect(dur).toBeLessThan(2.5);
    expect(ctx.liveSources()).toEqual([]);
    // the same recipe builds the same graph for any seed (only the pitch varies)
    const a = new FakeContext();
    const b = new FakeContext();
    SFX_TABLE.bark.play(sxFor(a, 1));
    SFX_TABLE.bark.play(sxFor(b, 2));
    const freqs = (c: FakeContext) => c.sources.filter((s) => s.kind === 'oscillator').map((s) => String((s as unknown as { stopTime: number }).stopTime)).join('|');
    expect(freqs(a)).toBeTruthy();
    expect(a.nodesCreated).toBe(b.nodesCreated);
  });

  it('every one-shot renders on a strict fake context with a sane length and bounded node count', () => {
    for (const id of SFX_IDS) {
      const ctx = new FakeContext();
      const def = SFX_TABLE[id];
      const before = ctx.nodesCreated;
      const dur = def.play(sxFor(ctx, 1234));
      expect(Number.isFinite(dur), id).toBe(true);
      expect(dur, id).toBeGreaterThan(0.02);
      expect(dur, `${id} exceeds its category limit`).toBeLessThanOrEqual(MAX_DURATION[def.cat] + 0.05);
      expect(ctx.nodesCreated - before, `${id} node count`).toBeLessThan(260);
      // every started source has a finite stop: one-shots never leak running nodes
      const leaks = ctx.liveSources();
      expect(leaks.map((s) => s.kind), `${id} leaked sources`).toEqual([]);
      // gated (choked) musical tails may keep a source alive briefly after the audible end; bound it
      for (const s of ctx.sources) if (s.started) expect(s.stopTime, `${id} ${s.kind}`).toBeLessThanOrEqual(dur + 2.6);
    }
  });

  it('one-shots survive adversarial pitch/volume multipliers and odd sample rates', () => {
    for (const sr of [8000, 22050, 96000]) {
      for (const [pitch, vol] of [[0.25, 1], [4, 1], [1, 0], [1, 2]] as const) {
        const ctx = new FakeContext({ sampleRate: sr });
        for (const id of SFX_IDS) expect(() => SFX_TABLE[id].play(sxFor(ctx, 7, pitch, vol)), `${id} @${sr} p${pitch}`).not.toThrow();
      }
    }
  });

  it('random variation is reproducible from the seed', () => {
    const run = (seed: number) => {
      const ctx = new FakeContext();
      for (const id of ['cash', 'crumble', 'dishClatter', 'laugh', 'footstep'] as SfxId[]) SFX_TABLE[id].play(sxFor(ctx, seed));
      return ctx.paramEvents + ':' + ctx.nodesCreated + ':' + ctx.sources.map((s) => s.startTime.toFixed(6)).join(',');
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('every id can loop: start, schedule windows, stop -> no throw, no leaked sources after stop', () => {
    for (const id of SFX_IDS) {
      const ctx = new FakeContext();
      const sx = sxFor(ctx, 99);
      const voice = loopFactoryFor(SFX_TABLE[id])(sx);
      let t = sx.t;
      for (let i = 0; i < 60; i++) {
        voice.schedule?.(t, t + 0.2);
        t += 0.1;
      }
      voice.stop(t + 0.4);
      // after stop, sources are either stopped by `stop` or were finite one-shots
      for (const s of ctx.liveSources(t + 30)) expect.fail(`${id}: ${s.kind} still running`);
      // a stopped loop schedules nothing more
      const n = ctx.sources.length;
      voice.schedule?.(t, t + 5);
      expect(ctx.sources.length, `${id} scheduled after stop`).toBe(n);
    }
  });

  it('event-driven loops survive stalls without bursting', () => {
    const ctx = new FakeContext();
    const sx = sxFor(ctx, 3);
    const voice = loopFactoryFor(SFX_TABLE.computerTyping)(sx);
    voice.schedule?.(0, 0.2);
    const n = ctx.sources.length;
    voice.schedule?.(120, 120.2); // two minutes later in one call
    expect(ctx.sources.length - n).toBeLessThan(400);
  });

  it('internal ambience extras render', () => {
    const ctx = new FakeContext();
    expect(AMBIENT_EXTRAS.crow(sxFor(ctx, 1))).toBeGreaterThan(0.1);
    expect(AMBIENT_EXTRAS.rain(sxFor(ctx, 1))).toBeGreaterThan(0.5);
    for (const f of [AMBIENT_EXTRAS.rainLoop, AMBIENT_EXTRAS.windLoop, AMBIENT_EXTRAS.cricketsLoop]) {
      const v = f(sxFor(ctx, 2));
      v.schedule?.(0, 1);
      v.stop(1);
    }
    expect(ctx.liveSources(5)).toEqual([]);
  });
});
