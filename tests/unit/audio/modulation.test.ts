/**
 * Slow random modulation (wind gusts, fire flicker, water swells, voice jitter) must run at the rate the recipe
 * asks for. Regression: the old implementation crawled a full-rate noise buffer at rateHz/sampleRate and a
 * 1e-4 playbackRate floor silently turned every modulation below ~4.8 Hz into ~4.8 Hz flutter.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/audio/prng';
import { LFO_TABLE_RATE, LFO_TABLE_SR, lfoBuffer } from '../../../src/audio/synth/buffers';
import { lfoPlaybackRate, randomLfo } from '../../../src/audio/synth/core';
import type { Sx } from '../../../src/audio/synth/types';
import { AMBIENT_EXTRAS, SFX_TABLE, loopFactoryFor } from '../../../src/audio/sfx/table';
import { FakeBufferSource, FakeContext, asCtx } from './fakeAudio';

function sxFor(ctx: FakeContext, seed = 1): Sx {
  return { ctx: asCtx(ctx), out: ctx.createGain() as unknown as AudioNode, t: 0.01, rng: createRng(seed), pitch: 1, vol: 1 };
}

/** Modulation rate (new random values per second) of every LFO-table source in a context. */
function lfoRates(ctx: FakeContext): number[] {
  return ctx.sources
    .filter((s): s is FakeBufferSource => s instanceof FakeBufferSource && s.buffer !== null && s.buffer.sampleRate === LFO_TABLE_SR)
    .map((s) => s.playbackRate.value * LFO_TABLE_RATE);
}

describe('random LFO rate mapping', () => {
  it('maps the requested rate exactly (no hidden floor) across 0.05..80 Hz at every sample rate', () => {
    for (const sr of [8000, 22050, 44100, 48000, 96000]) {
      const ctx = new FakeContext({ sampleRate: sr });
      const sx = sxFor(ctx);
      const p = ctx.createGain().gain as unknown as AudioParam;
      for (const hz of [0.05, 0.2, 0.35, 0.9, 2.2, 3.5, 14, 40, 80]) {
        const src = randomLfo(sx, hz, 1, p, 0, 1) as unknown as FakeBufferSource;
        expect(src.playbackRate.value * LFO_TABLE_RATE, `${hz} Hz @${sr}`).toBeCloseTo(hz, 9);
      }
    }
  });

  it('clamps junk rates to a sane range instead of throwing or producing NaN', () => {
    for (const junk of [NaN, Infinity, -Infinity, -5, 0, 1e12]) {
      const r = lfoPlaybackRate(junk);
      expect(Number.isFinite(r), String(junk)).toBe(true);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(64);
    }
    expect(lfoPlaybackRate(NaN) * LFO_TABLE_RATE).toBeCloseTo(2); // documented fallback
  });

  it('starts at a seeded random offset, stops at the end time, and connects through a depth gain', () => {
    const ctx = new FakeContext();
    const p = ctx.createGain().gain as unknown as AudioParam;
    const a = randomLfo(sxFor(ctx, 1), 1, 0.3, p, 0.5, 2) as unknown as FakeBufferSource;
    const b = randomLfo(sxFor(ctx, 2), 1, 0.3, p, 0.5, 2) as unknown as FakeBufferSource;
    expect(a.started && b.started).toBe(true);
    expect(a.startTime).toBe(0.5);
    expect(a.stopTime).toBeCloseTo(2.02);
    const inf = randomLfo(sxFor(ctx, 3), 1, 0.3, p, 0, Infinity) as unknown as FakeBufferSource;
    expect(inf.stopTime).toBe(Infinity); // loops stop explicitly later
    expect(a.loop).toBe(true);
  });
});

describe('LFO table', () => {
  it('is cached per context, deterministic, zero-mean, peak 0.9 and seamlessly cyclic', () => {
    const c1 = new FakeContext();
    const b1 = lfoBuffer(asCtx(c1));
    expect(lfoBuffer(asCtx(c1))).toBe(b1);
    const b2 = lfoBuffer(asCtx(new FakeContext({ sampleRate: 22050 })));
    const x = b1.getChannelData(0);
    const y = b2.getChannelData(0);
    expect(b1.sampleRate).toBe(LFO_TABLE_SR);
    expect(x.length).toBe(y.length);
    let maxDiff = 0;
    for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(x[i] - y[i]));
    expect(maxDiff).toBe(0); // same table whatever the context rate
    let sum = 0;
    let peak = 0;
    let maxStep = 0;
    for (let i = 0; i < x.length; i++) {
      expect(Number.isFinite(x[i])).toBe(true);
      sum += x[i];
      peak = Math.max(peak, Math.abs(x[i]));
      if (i > 0) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
    }
    expect(Math.abs(sum / x.length)).toBeLessThan(1e-3);
    expect(peak).toBeCloseTo(0.9, 3);
    // smooth (≥ 800 samples between control points) and the wrap-around is no bigger than any other step
    expect(maxStep).toBeLessThan(0.02);
    expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThanOrEqual(maxStep * 1.5);
  });

  it('really is slow: at 0.2 Hz the signal crosses its mean less than ~1x per second', () => {
    const x = lfoBuffer(asCtx(new FakeContext())).getChannelData(0);
    // at playbackRate 0.02 one second of output reads 0.02 * 8000 = 160 table samples
    const perSecond = lfoPlaybackRate(0.2) * LFO_TABLE_SR;
    let crossings = 0;
    for (let i = 1; i < x.length; i++) if (Math.sign(x[i]) !== Math.sign(x[i - 1])) crossings++;
    const seconds = x.length / perSecond;
    expect(crossings / seconds).toBeLessThan(1);
    expect(crossings).toBeGreaterThan(10); // but it does wander
  });
});

describe('beds use the rates their recipes ask for', () => {
  it('wind gusts and swells stay below 1 Hz; fire/rain/sizzle flicker below 3 Hz', () => {
    const wind = new FakeContext();
    AMBIENT_EXTRAS.windLoop(sxFor(wind)).stop(5);
    const w = lfoRates(wind);
    expect(w.length).toBe(3);
    for (const r of w) expect(r).toBeLessThan(1);

    const fire = new FakeContext();
    loopFactoryFor(SFX_TABLE.fireLoop)(sxFor(fire)).stop(5);
    const f = lfoRates(fire);
    expect(f.length).toBeGreaterThanOrEqual(2);
    for (const r of f) expect(r).toBeLessThan(3);

    const rain = new FakeContext();
    AMBIENT_EXTRAS.rainLoop(sxFor(rain)).stop(5);
    expect(Math.max(...lfoRates(rain))).toBeLessThan(1);

    const moon = new FakeContext();
    AMBIENT_EXTRAS.moonLoop(sxFor(moon)).stop(5);
    const m = lfoRates(moon);
    expect(m.length).toBe(4);
    for (const r of m) expect(r).toBeLessThan(0.2); // the full-moon shimmer breathes on 6-14 s cycles
  });

  it('every one-shot and loop only uses LFO rates in the musical 0.05..100 Hz range', () => {
    const ctx = new FakeContext();
    for (const id of Object.keys(SFX_TABLE) as (keyof typeof SFX_TABLE)[]) {
      SFX_TABLE[id].play(sxFor(ctx, 5));
      loopFactoryFor(SFX_TABLE[id])(sxFor(ctx, 6)).stop(3);
    }
    const rates = lfoRates(ctx);
    expect(rates.length).toBeGreaterThan(30);
    for (const r of rates) {
      expect(r).toBeGreaterThanOrEqual(0.05);
      expect(r).toBeLessThanOrEqual(100);
    }
  });
});
