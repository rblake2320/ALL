import { describe, expect, it } from 'vitest';
import { planVoice, timbreFromSeed, PROSODY, VOWELS, RELEASE_SEC, MAX_VOICE_MS } from '../../../src/audio/voice/groanish';
import { VOICE_EMOTIONS, type VoiceEmotion } from '../../../src/shared/audioIds';

function slope(e: VoiceEmotion, seed = 5) {
  const p = planVoice(seed, 0.5, e, 1400, 3);
  const f = p.syllables.map((s) => Math.log2((s.f0Start + s.f0End) / 2));
  const n = f.length;
  return { p, first: f[0], last: f[n - 1], mean: f.reduce((a, b) => a + b, 0) / n };
}

describe('Groanish voice planner', () => {
  it('covers every emotion in the vocabulary', () => {
    expect(Object.keys(PROSODY).sort()).toEqual([...VOICE_EMOTIONS].sort());
  });

  it('is deterministic per seed/emotion/duration/variant', () => {
    for (const e of VOICE_EMOTIONS) {
      expect(planVoice(17, 0.3, e, 1200, 2)).toEqual(planVoice(17, 0.3, e, 1200, 2));
    }
  });

  it('timbre is stable per seed and differs across zombies', () => {
    expect(timbreFromSeed(1, 0.5)).toEqual(timbreFromSeed(1, 0.5));
    expect(timbreFromSeed(1, 0.5)).not.toEqual(timbreFromSeed(2, 0.5));
    // same zombie, different utterances: same timbre, different words
    const a = planVoice(9, 0.5, 'neutral', 1500, 0);
    const b = planVoice(9, 0.5, 'neutral', 1500, 1);
    expect(a.timbre).toEqual(b.timbre);
    expect(JSON.stringify(a.syllables)).not.toBe(JSON.stringify(b.syllables));
  });

  it('voicePitch maps 0 -> deep groan, 1 -> squeaky', () => {
    const lo = timbreFromSeed(3, 0).f0;
    const mid = timbreFromSeed(3, 0.5).f0;
    const hi = timbreFromSeed(3, 1).f0;
    expect(lo).toBeLessThan(80);
    expect(hi).toBeGreaterThan(280);
    expect(mid).toBeGreaterThan(lo);
    expect(hi).toBeGreaterThan(mid);
  });

  it('respects durationMs (last syllable + release ends at the duration)', () => {
    for (const e of VOICE_EMOTIONS) {
      for (const ms of [200, 600, 1000, 2500]) {
        const p = planVoice(11, 0.6, e, ms, 1);
        const last = p.syllables[p.syllables.length - 1];
        expect(p.duration).toBeCloseTo(ms / 1000, 6);
        expect(last.start + last.dur + RELEASE_SEC).toBeCloseTo(ms / 1000, 3);
        for (let i = 1; i < p.syllables.length; i++) expect(p.syllables[i].start).toBeGreaterThanOrEqual(p.syllables[i - 1].start + p.syllables[i - 1].dur - 1e-9);
      }
    }
  });

  it('normal speech syllables are 90-180 ms (with fitting tolerance)', () => {
    for (const e of ['neutral', 'happy', 'sad', 'angry', 'flirty', 'disgusted', 'surprised', 'question'] as VoiceEmotion[]) {
      for (let v = 0; v < 6; v++) {
        const p = planVoice(v * 13 + 1, 0.5, e, 2000, v);
        expect(p.syllables.length).toBeGreaterThan(5);
        for (const s of p.syllables) {
          expect(s.dur).toBeGreaterThan(0.08);
          expect(s.dur).toBeLessThan(0.2);
        }
      }
    }
  });

  it('prosody: happy rises, sad falls, question ends up, surprised starts high, groan is low & long', () => {
    expect(slope('happy').last).toBeGreaterThan(slope('happy').first);
    expect(slope('sad').last).toBeLessThan(slope('sad').first);
    const q = planVoice(5, 0.5, 'question', 1400, 3);
    const lastQ = q.syllables[q.syllables.length - 1];
    expect(lastQ.f0End / lastQ.f0Start).toBeGreaterThan(1.3);
    const s = planVoice(5, 0.5, 'surprised', 1400, 3);
    expect(s.syllables[0].f0End).toBeGreaterThan(s.syllables[s.syllables.length - 1].f0Start);
    const g = planVoice(5, 0.5, 'groan', 1400, 3);
    const n = planVoice(5, 0.5, 'neutral', 1400, 3);
    expect(g.syllables.length).toBeLessThan(4);
    expect(g.syllables[0].dur).toBeGreaterThan(0.35);
    expect(g.syllables[0].f0Start).toBeLessThan(n.syllables[0].f0Start);
    expect(g.roughness).toBeGreaterThan(n.roughness);
    const sad = slope('sad').p;
    const happy = slope('happy').p;
    const avg = (pl: typeof sad) => pl.syllables.reduce((a, x) => a + x.dur, 0) / pl.syllables.length;
    expect(avg(sad)).toBeGreaterThan(avg(happy));
  });

  it('emotion colours: angry is driven, flirty breathy, disgusted nasal, laugh staccato h-syllables, scream high', () => {
    const angry = planVoice(1, 0.5, 'angry', 1000);
    const neutral = planVoice(1, 0.5, 'neutral', 1000);
    expect(angry.drive).toBeGreaterThan(0.5);
    expect(planVoice(1, 0.5, 'flirty', 1000).breath).toBeGreaterThan(neutral.breath + 0.2);
    expect(planVoice(1, 0.5, 'disgusted', 1000).nasal).toBeGreaterThan(0.5);
    const laugh = planVoice(1, 0.5, 'laugh', 1200);
    expect(laugh.syllables.length).toBeGreaterThanOrEqual(6);
    for (const syl of laugh.syllables) {
      expect(syl.onset).toBe('h');
      expect(syl.dur).toBeLessThan(0.13);
    }
    expect(planVoice(1, 0.5, 'scream', 1000).syllables[0].f0Start).toBeGreaterThan(neutral.syllables[0].f0Start * 1.7);
    const yawn = planVoice(1, 0.5, 'yawn', 1500);
    expect(yawn.syllables.length).toBe(1);
    expect(yawn.syllables[0].f0Mid).toBeGreaterThan(yawn.syllables[0].f0End);
  });

  it('adversarial inputs produce finite, bounded plans', () => {
    const junk: unknown[] = [NaN, Infinity, -Infinity, -5, 1e9, 'x', null, undefined, {}];
    for (const seed of junk) {
      for (const pitch of junk) {
        for (const ms of junk) {
          const p = planVoice(seed, pitch, 'not-an-emotion', ms, NaN);
          expect(p.emotion).toBe('neutral');
          expect(p.syllables.length).toBeGreaterThan(0);
          expect(p.syllables.length).toBeLessThanOrEqual(48);
          expect(p.duration).toBeGreaterThan(0);
          expect(p.duration).toBeLessThanOrEqual(MAX_VOICE_MS / 1000);
          for (const s of p.syllables) {
            for (const v of [s.start, s.dur, s.f0Start, s.f0End, s.amp]) expect(Number.isFinite(v)).toBe(true);
            expect(s.f0Start).toBeGreaterThanOrEqual(45);
            expect(s.f0End).toBeLessThanOrEqual(1000);
            expect(VOWELS[s.vowel]).toBeDefined();
          }
        }
      }
    }
  });
});
