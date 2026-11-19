/**
 * Mix behaviour and CPU bounds: diegetic radio ducking, the radio "station" never clashing with an in-game
 * score cue, loop-cap hysteresis and context re-attachment, and bounded per-tick work (steady state, after a
 * long main-thread stall, under rapid mood flipping).
 */
import { describe, expect, it } from 'vitest';
import { AudioEngine, RADIO_DUCK_DEPTH, radioDuckFor } from '../../../src/audio/engine';
import { EVICT_MARGIN, LoopManager, MAX_LOOPS, specForSfx, type LoopSpec } from '../../../src/audio/loopManager';
import { createRng } from '../../../src/audio/prng';
import { RADIO_MOOD } from '../../../src/audio/sfx/life-a';
import type { LoopVoice } from '../../../src/audio/synth/types';
import { chooseMusic } from '../../../src/game/music';
import { SFX_IDS, VOICE_EMOTIONS, type MusicMood } from '../../../src/shared/audioIds';
import { FakeContext, FakeGain, asCtx } from './fakeAudio';

async function engine(seed = 1) {
  const ctx = new FakeContext();
  const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false, seed });
  await e.unlock();
  return { ctx, e };
}

function run(ctx: FakeContext, e: AudioEngine, seconds: number, step = 0.025): void {
  for (let t = 0; t < seconds; t += step) {
    ctx.advance(step);
    e.tick();
  }
}

/** The radio-duck stage: music bus -> duck -> sting-duck -> radio-duck. */
function radioStage(e: AudioEngine): FakeGain {
  let n = e.mixGraph!.input.music as unknown as FakeGain;
  for (let i = 0; i < 3; i++) n = [...n.outputs][0] as FakeGain;
  return n;
}

describe('diegetic radio ducking', () => {
  it('radioDuckFor is monotonic, bounded and junk-proof', () => {
    let prev = 1;
    for (let g = 0; g <= 1.0001; g += 0.01) {
      const d = radioDuckFor(g);
      expect(d).toBeLessThanOrEqual(prev + 1e-12);
      expect(d).toBeGreaterThanOrEqual(1 - RADIO_DUCK_DEPTH - 1e-12);
      prev = d;
    }
    expect(radioDuckFor(1)).toBeCloseTo(1 - RADIO_DUCK_DEPTH);
    expect(radioDuckFor(5)).toBeCloseTo(1 - RADIO_DUCK_DEPTH);
    for (const junk of [NaN, -1, 0, -Infinity]) expect(radioDuckFor(junk)).toBe(1);
  });

  it('a stereo at the camera ducks the score; far or off restores it; per-frame updates do not spam automation', async () => {
    const { ctx, e } = await engine();
    e.music('party');
    run(ctx, e, 0.5);
    expect(e.stats().radioDuck).toBe(1);
    e.loop('stereo:o9', 'stereoMusic', true, { pan: 0.1, gain: 1 });
    run(ctx, e, 0.2);
    expect(e.stats().radioDuck).toBeCloseTo(1 - RADIO_DUCK_DEPTH, 2);
    const stage = radioStage(e);
    expect(stage.gain.lastTarget()).toBeCloseTo(1 - RADIO_DUCK_DEPTH, 2);
    let glides = 0;
    const orig = stage.gain.setTargetAtTime.bind(stage.gain);
    stage.gain.setTargetAtTime = (v: number, t: number, tc: number) => {
      glides++;
      return orig(v, t, tc);
    };
    for (let i = 0; i < 400; i++) {
      e.loop('stereo:o9', 'stereoMusic', true, { pan: 0.1, gain: 1 - (i % 3) * 0.001 });
      ctx.advance(0.016);
      e.tick();
    }
    expect(glides).toBe(0); // jitter below the threshold never re-glides the duck stage
    expect(stage.gain.lastTarget()).toBeCloseTo(1 - RADIO_DUCK_DEPTH, 2);
    e.loop('stereo:o9', 'stereoMusic', true, { pan: 0.1, gain: 0.1 }); // camera moved away
    run(ctx, e, 0.1);
    expect(e.stats().radioDuck).toBe(1);
    e.loop('stereo:o9', 'stereoMusic', true, { pan: 0, gain: 0.7 });
    run(ctx, e, 0.1);
    expect(e.stats().radioDuck).toBeLessThan(0.8);
    e.loop('stereo:o9', 'stereoMusic', false);
    run(ctx, e, 0.1);
    expect(e.stats().radioDuck).toBe(1);
    expect(stage.gain.lastTarget()).toBe(1);
    // other loops never duck the score
    e.loop('tv:1', 'tvChatter', true, { pan: 0, gain: 1 });
    run(ctx, e, 0.1);
    expect(e.stats().radioDuck).toBe(1);
  });

  it('the radio station is never a cue the score plays while the household is live', () => {
    const modes = ['live', 'buy', 'build'] as const;
    const seen = new Set<string>();
    for (const mode of modes) {
      for (const partyActive of [false, true]) {
        for (const tense of [false, true]) {
          for (const isNight of [false, true]) {
            for (const override of [null, 'tense', 'party', 'sad', 'romance'] as const) {
              seen.add(chooseMusic({ screen: 'game', mode, fatal: false, isNight, partyActive, tense, override }) as string);
            }
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(seen.has(RADIO_MOOD)).toBe(false);
    expect(RADIO_MOOD satisfies MusicMood).toBe('caz');
  });
});

describe('LoopManager additions', () => {
  function host(ctx: FakeContext) {
    const bus = ctx.createGain();
    return { ctx: asCtx(ctx), input: () => bus as unknown as AudioNode, rng: createRng(1) };
  }
  const probe = (log: string[], name: string, id?: LoopSpec['id']): LoopSpec => ({
    bus: 'sfx',
    trim: 1,
    id,
    factory: (): LoopVoice => {
      log.push(`start:${name}`);
      return { stop: () => log.push(`stop:${name}`) };
    },
  });

  it('maxGainOf reports the loudest playing loop of an id, ignoring waiting ones', () => {
    const lm = new LoopManager();
    expect(lm.maxGainOf('stereoMusic')).toBe(0);
    lm.set('w', probe([], 'W', 'stereoMusic'), true, 0, 0.9); // not attached yet: desired only
    expect(lm.maxGainOf('stereoMusic')).toBe(0);
    lm.attach(host(new FakeContext()));
    expect(lm.maxGainOf('stereoMusic')).toBeCloseTo(0.9);
    lm.set('w2', probe([], 'W2', 'stereoMusic'), true, 0, 0.4);
    lm.set('x', probe([], 'X', 'shower'), true, 0, 1);
    expect(lm.maxGainOf('stereoMusic')).toBeCloseTo(0.9);
    lm.set('w', null, false, 0, 0);
    expect(lm.maxGainOf('stereoMusic')).toBeCloseTo(0.4);
  });

  it('eviction needs a clear margin: no flapping between near-equal loops at the cap', () => {
    const lm = new LoopManager();
    lm.attach(host(new FakeContext()));
    const log: string[] = [];
    for (let i = 0; i < MAX_LOOPS; i++) lm.set(`k${i}`, probe(log, `L${i}`), true, 0, 0.5);
    lm.set('near', probe(log, 'NEAR'), true, 0, 0.5 * (EVICT_MARGIN - 0.05));
    expect(log).not.toContain('start:NEAR');
    // a frame-rate stream of slightly changing gains around the threshold never thrashes
    for (let f = 0; f < 200; f++) lm.set('near', probe(log, 'NEAR'), true, 0, 0.5 * (EVICT_MARGIN - 0.05 + (f % 2) * 0.01));
    expect(log.filter((l) => l.startsWith('stop:')).length).toBe(0);
    lm.set('loud', probe(log, 'LOUD'), true, 0, 0.5 * (EVICT_MARGIN + 0.05));
    expect(log).toContain('start:LOUD');
    expect(log.filter((l) => l.startsWith('stop:')).length).toBe(1);
    expect(lm.activeCount).toBe(MAX_LOOPS);
  });

  it('detach() keeps desired loops for the next context and never touches the old one again', () => {
    const a = new FakeContext();
    const b = new FakeContext();
    const lm = new LoopManager();
    lm.attach(host(a));
    const log: string[] = [];
    lm.set('s', probe(log, 'S'), true, 0.2, 0.8);
    lm.set('t', probe(log, 'T'), true, -0.2, 0.6);
    lm.detach();
    expect(lm.activeCount).toBe(0);
    expect(lm.desiredCount).toBe(2);
    const n = a.nodesCreated;
    lm.set('s', probe(log, 'S'), true, 0.3, 0.8); // updates while detached stay desired
    lm.pump(1, 1.2);
    expect(a.nodesCreated).toBe(n);
    lm.attach(host(b));
    expect(lm.activeCount).toBe(2);
    expect(log.filter((l) => l === 'start:S').length).toBe(2);
  });
});

describe('bounded per-tick work', () => {
  async function busy() {
    const { ctx, e } = await engine(3);
    e.music('party');
    e.setAmbience({ night: true, indoor: false, rain: true, moon: true });
    const ids = SFX_IDS.filter((id) => specForSfx(id) !== null).slice(0, 40);
    for (let i = 0; i < 30; i++) e.loop(`busy:${i}`, ids[(i * 7) % ids.length], true, { pan: ((i % 5) - 2) / 3, gain: 0.3 + (i % 7) / 10 });
    for (let i = 0; i < 6; i++) e.voice(i + 1, i / 6, VOICE_EMOTIONS[i], 3000, { pan: 0, gain: 0.8 });
    return { ctx, e };
  }

  it('steady state: a 25 ms tick creates a bounded number of nodes even in a busy party scene', async () => {
    const { ctx, e } = await busy();
    let max = 0;
    for (let i = 0; i < 400; i++) {
      const n = ctx.nodesCreated;
      ctx.advance(0.025);
      e.tick();
      max = Math.max(max, ctx.nodesCreated - n);
    }
    expect(e.stats().loops).toBe(MAX_LOOPS);
    expect(max).toBeLessThan(1500);
    expect(e.stats().errors).toBe(0);
  });

  it('after a 30 s main-thread stall the next tick does no more work than a normal busy tick', async () => {
    const { ctx, e } = await busy();
    let max = 0;
    for (let i = 0; i < 200; i++) {
      const n = ctx.nodesCreated;
      ctx.advance(0.025);
      e.tick();
      max = Math.max(max, ctx.nodesCreated - n);
    }
    ctx.advance(30);
    const n = ctx.nodesCreated;
    e.tick();
    const burst = ctx.nodesCreated - n;
    expect(burst).toBeLessThanOrEqual(Math.max(400, max * 1.5));
    // and the scene keeps going afterwards
    const m = ctx.sources.length;
    run(ctx, e, 2);
    expect(ctx.sources.length).toBeGreaterThan(m + 50);
    expect(e.stats().errors).toBe(0);
  });

  it('rapid mood flipping stays bounded and every replaced cue is faded, never hard-cut while loud', async () => {
    const { ctx, e } = await engine();
    const moods: MusicMood[] = ['live', 'build', 'party', 'night', 'tense'];
    for (let i = 0; i < 60; i++) {
      e.music(moods[i % moods.length]);
      run(ctx, e, 0.03);
      expect(e.stats().musicSections).toBeLessThanOrEqual(8);
    }
    // every music section's dry/wet output that got disconnected had a glide to 0 before
    const music = e.mixGraph!.input.music as unknown as FakeGain;
    const sectionOuts = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.disconnected > 0 && n.gain.events.length > 0 && [...n.outputs].length === 0);
    for (const g of sectionOuts) {
      const last = g.gain.events[g.gain.events.length - 1];
      expect(last.value).toBe(0);
    }
    expect(music).toBeDefined();
    e.music('none');
    run(ctx, e, 6);
    expect(e.stats().musicSections).toBe(0);
    expect(e.stats().errors).toBe(0);
  });
});
