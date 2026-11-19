/**
 * Groanish renderer on the strict fake: every automation lane is written in time order for any plan (tight
 * durations, junk input), node count is bounded regardless of length, stop() is total, and laughs pulse at a
 * human rate.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/audio/prng';
import type { Sx } from '../../../src/audio/synth/types';
import { planVoice } from '../../../src/audio/voice/groanish';
import { renderVoice } from '../../../src/audio/voice/render';
import { VOICE_EMOTIONS } from '../../../src/shared/audioIds';
import { FakeContext, FakeParam, asCtx } from './fakeAudio';

function sxFor(ctx: FakeContext, pitch = 1): Sx {
  return { ctx: asCtx(ctx), out: ctx.createGain() as unknown as AudioNode, t: 0.05, rng: createRng(3), pitch, vol: 1 };
}

/** Every FakeParam reachable from the nodes a render created. */
function params(ctx: FakeContext): FakeParam[] {
  const out: FakeParam[] = [];
  for (const n of ctx.nodes) {
    for (const v of Object.values(n)) if (v instanceof FakeParam) out.push(v);
  }
  return out;
}

describe('Groanish renderer', () => {
  it('writes every automation lane in non-decreasing time order (all emotions x tight..long durations)', () => {
    let checked = 0;
    for (const emo of VOICE_EMOTIONS) {
      for (const ms of [150, 170, 220, 320, 700, 1300, 6000]) {
        for (const seed of [1, 77, 4242]) {
          for (const pitch of [0, 0.5, 1]) {
            const ctx = new FakeContext();
            renderVoice(sxFor(ctx, pitch === 1 ? 1.3 : 1), planVoice(seed, pitch, emo, ms, seed % 5), 1);
            for (const p of params(ctx)) {
              for (let i = 1; i < p.events.length; i++) {
                if (p.events[i].time < p.events[i - 1].time - 1e-12) {
                  expect.fail(`${emo} ${ms}ms seed ${seed}: ${p.name} event ${i} at ${p.events[i].time} before ${p.events[i - 1].time}`);
                }
              }
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('node count is bounded regardless of utterance length; every source is stopped by the end', () => {
    const count = (ms: number, emo: (typeof VOICE_EMOTIONS)[number]) => {
      const ctx = new FakeContext();
      const h = renderVoice(sxFor(ctx), planVoice(9, 0.4, emo, ms, 1), 1);
      expect(ctx.liveSources(h.end + 0.1), `${emo} ${ms}`).toEqual([]);
      return ctx.nodesCreated;
    };
    for (const emo of VOICE_EMOTIONS) {
      const short = count(150, emo);
      const long = count(6000, emo);
      expect(long, emo).toBe(short);
      expect(long, emo).toBeLessThanOrEqual(45);
    }
  });

  it('stop() is total: junk times, repeated calls, after the natural end', () => {
    const ctx = new FakeContext();
    ctx.currentTime = 2;
    const h = renderVoice(sxFor(ctx), planVoice(5, 0.5, 'scream', 1200, 0), 1);
    for (const w of [NaN, -1, Infinity, 0, 1.2, 99]) expect(() => h.stop(w)).not.toThrow();
    for (const s of ctx.sources) if (s.started) expect(s.stopTime).toBeLessThan(Infinity);
  });

  it('laughs pulse at a human 4-6.5 "hah"s per second with real breathy gaps, tailing off', () => {
    for (const ms of [800, 1100, 1600, 2500]) {
      for (let seed = 0; seed < 8; seed++) {
        const p = planVoice(seed * 31 + 7, 0.5, 'laugh', ms, seed);
        const s = p.syllables;
        const rate = s.length / p.duration;
        expect(rate, `${ms} ms seed ${seed}`).toBeGreaterThanOrEqual(4);
        expect(rate).toBeLessThanOrEqual(6.5);
        for (let i = 1; i < s.length; i++) expect(s[i].start - (s[i - 1].start + s[i - 1].dur)).toBeGreaterThan(0.04);
        for (const x of s) {
          expect(x.dur).toBeGreaterThanOrEqual(0.08);
          expect(x.dur).toBeLessThan(0.13);
          expect(x.onset).toBe('h');
        }
        if (s.length >= 4) expect(s[s.length - 1].amp).toBeLessThan(s[0].amp);
      }
    }
  });

  it('non-laugh emotions keep their word rhythm (the laugh change does not leak)', () => {
    let structured = 0;
    for (let seed = 0; seed < 12; seed++) {
      const p = planVoice(seed * 7 + 1, 0.5, 'neutral', 2000, seed);
      const gaps = p.syllables.slice(1).map((s, i) => s.start - (p.syllables[i].start + p.syllables[i].dur));
      // syllables inside a word run together, words are separated: the gaps form two clearly different sizes
      if (Math.max(...gaps) / Math.max(1e-6, Math.min(...gaps)) > 1.5) structured++;
    }
    expect(structured).toBeGreaterThanOrEqual(10);
  });
});
