import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, MAX_SFX_VOICES, MAX_SPEECH_VOICES } from '../../../src/audio/engine';
import { MAX_LOOPS } from '../../../src/audio/loopManager';
import { DUCK_LEVEL, INDOOR_CUTOFF, MASTER_MAKEUP } from '../../../src/audio/graph';
import { SFX_IDS, VOICE_EMOTIONS, type MusicMood } from '../../../src/shared/audioIds';
import { FakeContext, FakeGain, asCtx } from './fakeAudio';

async function makeEngine(seed = 1) {
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

describe('AudioEngine on a strict fake WebAudio context', () => {
  it('unlocks lazily, idempotently and builds the master chain', async () => {
    const ctx = new FakeContext();
    const factory = vi.fn(() => asCtx(ctx));
    const e = new AudioEngine({ contextFactory: factory, timer: false });
    expect(e.unlocked).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    await Promise.all([e.unlock(), e.unlock(), e.unlock()]);
    await e.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(e.unlocked).toBe(true);
    expect(ctx.byKind.get('compressor')).toBe(1);
    expect(ctx.byKind.get('convolver')).toBe(1);
    expect(e.stats().errors).toBe(0);
  });

  it('plays every SFX with adversarial options without any WebAudio exception', async () => {
    const { ctx, e } = await makeEngine();
    for (const id of SFX_IDS) {
      e.sfx(id);
      e.sfx(id, { spatial: { pan: -0.7, gain: 0.5 }, pitch: 1.3, volume: 0.8 });
      e.sfx(id, { spatial: { pan: NaN, gain: NaN }, pitch: NaN, volume: Infinity });
      e.sfx(id, { pitch: -1, volume: -1 });
      run(ctx, e, 0.06);
    }
    expect(e.stats().errors).toBe(0);
    expect(e.stats().sfxVoices).toBeLessThanOrEqual(MAX_SFX_VOICES);
  });

  it('caps one-shot polyphony at 24, stealing the oldest', async () => {
    const { ctx, e } = await makeEngine();
    for (const id of SFX_IDS.slice(0, 60)) e.sfx(id);
    expect(e.stats().sfxVoices).toBe(MAX_SFX_VOICES);
    expect(e.stats().dropped).toBe(0);
    // rate limiter: identical ids in one instant are capped (3 per 50 ms) so spam cannot flam
    for (let i = 0; i < 20; i++) e.sfx('footstep');
    expect(e.stats().dropped).toBe(18); // footstep was already played once in the batch above
    run(ctx, e, 4);
    expect(e.stats().sfxVoices).toBe(0);
    expect(e.stats().errors).toBe(0);
  });

  it('voices: max 6 concurrent; the same zombie interrupts itself; every emotion renders', async () => {
    const { ctx, e } = await makeEngine();
    for (let seed = 0; seed < 10; seed++) e.voice(seed, 0.5, 'neutral', 2000);
    expect(e.stats().speechVoices).toBe(MAX_SPEECH_VOICES);
    run(ctx, e, 3);
    expect(e.stats().speechVoices).toBe(0);
    e.voice(42, 0.3, 'happy', 1500);
    e.voice(42, 0.3, 'angry', 1500);
    expect(e.stats().speechVoices).toBe(1);
    for (const emo of VOICE_EMOTIONS) e.voice(7, 0.8, emo, 600, { pan: 0.4, gain: 0.7 });
    e.voice(NaN, NaN, 'nope' as never, NaN, { pan: Infinity, gain: NaN });
    e.voice(1, 0.5, 'scream', 99999);
    e.voice(2, 0.5, 'groan', -5);
    e.voice(3, 0.5, 'laugh', 500, { pan: 0, gain: 0 }); // inaudible -> skipped
    run(ctx, e, 7);
    expect(e.stats().errors).toBe(0);
  });

  it('loops: start, live spatial update without allocation, crossfade stop, cap', async () => {
    const { ctx, e } = await makeEngine();
    e.loop('shower:o1', 'shower', true, { pan: -0.5, gain: 0.8 });
    expect(e.stats().loops).toBe(1);
    run(ctx, e, 0.5);
    const nodes = ctx.nodesCreated;
    for (let i = 0; i < 200; i++) e.loop('shower:o1', 'shower', true, { pan: Math.sin(i) * 0.5, gain: 0.8 });
    // shower is a continuous bed (+ droplets from the scheduler); spatial updates themselves add nothing
    expect(ctx.nodesCreated - nodes).toBe(0);
    e.loop('shower:o1', 'shower', false);
    expect(e.stats().loops).toBe(0);
    run(ctx, e, 2);
    for (let i = 0; i < 40; i++) e.loop(`fire:${i}`, 'fireLoop', true, { pan: 0, gain: (i + 1) / 40 });
    expect(e.stats().loops).toBe(MAX_LOOPS);
    e.stopAllLoops();
    expect(e.stats().loops).toBe(0);
    run(ctx, e, 2);
    // everything the loops started has been stopped
    expect(ctx.liveSources(ctx.currentTime + 1).filter((s) => s.kind === 'bufferSource' || s.kind === 'oscillator').length).toBeLessThan(40);
    expect(e.stats().errors).toBe(0);
  });

  it('every SfxId works as a loop and stops cleanly', async () => {
    const { ctx, e } = await makeEngine();
    for (const id of SFX_IDS) e.loop(`l:${id}`, id, true, { pan: 0.1, gain: 0.5 });
    run(ctx, e, 3);
    e.stopAllLoops();
    run(ctx, e, 12);
    for (const s of ctx.liveSources(ctx.currentTime)) expect.fail(`${s.kind} still running after stopAllLoops`);
    expect(e.stats().errors).toBe(0);
  });

  it('loop requests before unlock are remembered and materialise on unlock', async () => {
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asCtx(ctx), timer: false });
    e.loop('tv:o3', 'tvChatter', true, { pan: 0, gain: 1 });
    e.loop('tv:o4', 'tvChatter', true);
    e.loop('tv:o4', 'tvChatter', false);
    e.music('live');
    e.setAmbience({ night: true, indoor: false });
    await e.unlock();
    expect(e.stats().loops).toBe(1);
    expect(e.stats().musicMood).toBe('live');
    expect(e.stats().ambientLoops).toBe(2); // night wind + crickets
    run(ctx, e, 2);
    expect(e.stats().errors).toBe(0);
  });

  it('music: every mood schedules notes; crossfades bounded; none fades out', async () => {
    const moods: MusicMood[] = ['menu', 'caz', 'live', 'night', 'build', 'tense', 'party', 'sad', 'romance'];
    for (const m of moods) {
      const { ctx, e } = await makeEngine();
      const before = ctx.sources.length;
      e.music(m);
      run(ctx, e, 4);
      expect(ctx.sources.length - before, m).toBeGreaterThan(8);
      expect(e.stats().errors, m).toBe(0);
    }
    const { ctx, e } = await makeEngine();
    for (let i = 0; i < 20; i++) {
      e.music(moods[i % moods.length]);
      run(ctx, e, 0.1);
    }
    // current + ≤3 crossfading + ≤4 fast-fading (the oldest are faded out in ~0.1 s, never hard-cut)
    expect(e.stats().musicSections).toBeLessThanOrEqual(8);
    e.music('none');
    run(ctx, e, 8);
    expect(e.stats().musicSections).toBe(0);
    expect(e.stats().musicMood).toBe('none');
    const n = ctx.sources.length;
    run(ctx, e, 2);
    expect(ctx.sources.length).toBe(n);
    e.music('bogus' as never);
    expect(e.stats().musicMood).toBe('none');
  });

  it('volumes: clamped and pushed to the graph with smooth ramps (no zipper)', async () => {
    const { e } = await makeEngine();
    e.setVolumes({ master: 2, music: NaN, sfx: -1, voice: 0.5 });
    const v = e.getVolumes();
    expect(v.master).toBe(1);
    expect(v.sfx).toBe(0);
    expect(v.voice).toBe(0.5);
    const g = e.mixGraph!;
    const master = (g.master as unknown as FakeGain).gain;
    const ev = master.events[master.events.length - 1];
    expect(ev.type).toBe('target');
    expect(ev.value).toBeCloseTo(MASTER_MAKEUP);
    const sfxBus = (g.input.sfx as unknown as FakeGain).gain;
    expect(sfxBus.lastTarget()).toBe(0);
    expect((g.input.voice as unknown as FakeGain).gain.lastTarget()).toBeCloseTo(0.25);
  });

  it('mute fades then suspends; unmute resumes; sounds are dropped while muted', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, e } = await makeEngine();
      e.setMuted(true);
      const mute = (e.mixGraph!.mute as unknown as FakeGain).gain;
      expect(mute.lastTarget()).toBe(0);
      const n = ctx.sources.length;
      e.sfx('uiClick');
      e.voice(1, 0.5, 'neutral', 500);
      expect(ctx.sources.length).toBe(n);
      vi.advanceTimersByTime(200);
      expect(ctx.suspendCalls).toBe(1);
      expect(e.unlocked).toBe(true); // still unlocked: we suspended on purpose
      e.setMuted(false);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(ctx.state).toBe('running');
      expect(mute.lastTarget()).toBe(1);
      e.sfx('uiClick');
      expect(ctx.sources.length).toBeGreaterThan(n);
    } finally {
      vi.useRealTimers();
    }
  });

  it('duck lowers music + ambient, not sfx', async () => {
    const { e } = await makeEngine();
    e.setDucked(true);
    e.setDucked(true);
    const g = e.mixGraph!;
    const targets = (g.input.music as unknown as FakeGain).outputs;
    const duck = [...targets][0] as unknown as FakeGain;
    expect(duck.gain.lastTarget()).toBe(DUCK_LEVEL);
    e.setDucked(false);
    expect(duck.gain.lastTarget()).toBe(1);
  });

  it('game speed: footsteps muted at >=3; ambience thins at ultra; indoor muffles', async () => {
    const { ctx, e } = await makeEngine();
    e.setAmbience({ night: false, indoor: true });
    const f = e.mixGraph!.ambientFilter as unknown as { frequency: { lastTarget(): number } };
    expect(f.frequency.lastTarget()).toBe(INDOOR_CUTOFF);
    e.setGameSpeed(3);
    const n = ctx.sources.length;
    e.sfx('footstep');
    expect(ctx.sources.length).toBe(n);
    e.loop('steps:a1', 'footstep', true);
    e.setGameSpeed(4);
    const thin = (e.mixGraph!.ambientThin as unknown as FakeGain).gain.lastTarget();
    expect(thin).toBeCloseTo(0.75 * 0.7);
    e.setGameSpeed(1);
    e.sfx('footstep');
    expect(ctx.sources.length).toBeGreaterThan(n);
    run(ctx, e, 1);
    expect(e.stats().errors).toBe(0);
  });

  it('ambience: day/night/rain beds crossfade and fire one-off events over time', async () => {
    const { ctx, e } = await makeEngine();
    e.setAmbience({ night: false, indoor: false });
    expect(e.stats().ambientLoops).toBe(1);
    e.setAmbience({ night: true, indoor: false, rain: true });
    expect(e.stats().ambientLoops).toBe(3);
    const n = ctx.sources.length;
    run(ctx, e, 90, 0.05);
    expect(ctx.sources.length).toBeGreaterThan(n + 20); // owls/groans/thunder/crickets happened
    e.setAmbience({ night: false, indoor: true, rain: false });
    expect(e.stats().ambientLoops).toBe(1);
    // stopAllLoops does not kill the ambience bed
    e.stopAllLoops();
    expect(e.stats().ambientLoops).toBe(1);
    expect(e.stats().errors).toBe(0);
  });

  it('is deterministic for a given seed', async () => {
    const trace = async (seed: number) => {
      const { ctx, e } = await makeEngine(seed);
      e.sfx('cash');
      e.sfx('crumble', { spatial: { pan: 0.3, gain: 0.9 } });
      e.voice(5, 0.4, 'laugh', 900);
      e.music('party');
      run(ctx, e, 2);
      return `${ctx.nodesCreated}|${ctx.paramEvents}|${ctx.sources.map((s) => s.startTime.toFixed(5)).join(',')}`;
    };
    expect(await trace(9)).toBe(await trace(9));
    expect(await trace(9)).not.toBe(await trace(10));
  });

  it('dispose closes the context and turns everything into no-ops', async () => {
    const { ctx, e } = await makeEngine();
    e.music('menu');
    e.loop('a', 'fireLoop', true);
    run(ctx, e, 1);
    e.dispose();
    expect(ctx.closeCalls).toBe(1);
    expect(e.unlocked).toBe(false);
    const n = ctx.nodesCreated;
    e.sfx('uiClick');
    e.loop('b', 'shower', true);
    e.voice(1, 1, 'happy', 500);
    e.music('party');
    e.tick();
    await e.unlock();
    expect(ctx.nodesCreated).toBe(n);
    e.dispose();
  });

  it('per-frame paths stay cheap: 1000 loop updates and ticks allocate no nodes', async () => {
    const { ctx, e } = await makeEngine();
    e.loop('fly:1', 'flies', true, { pan: 0, gain: 0.5 });
    run(ctx, e, 0.2);
    const n = ctx.nodesCreated;
    for (let i = 0; i < 1000; i++) e.loop('fly:1', 'flies', true, { pan: (i % 10) / 10, gain: 0.5 });
    expect(ctx.nodesCreated).toBe(n);
  });
});

describe('master safety ceiling', () => {
  it('is the identity below the knee, odd, monotonic, C1 at the knee and never above the ceiling', async () => {
    const { SAFETY_CEILING, SAFETY_KNEE, SAFETY_RANGE, safetyCurveTable, safetyCurveValue } = await import('../../../src/audio/graph');
    for (let x = -SAFETY_KNEE; x <= SAFETY_KNEE; x += 0.01) expect(safetyCurveValue(x)).toBeCloseTo(x, 12);
    let prev = -Infinity;
    for (let x = -10; x <= 10; x += 0.001) {
      const y = safetyCurveValue(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(y)).toBeLessThanOrEqual(SAFETY_CEILING);
      expect(safetyCurveValue(-x)).toBeCloseTo(-y, 12);
      prev = y;
    }
    const h = 1e-6;
    expect((safetyCurveValue(SAFETY_KNEE + h) - safetyCurveValue(SAFETY_KNEE)) / h).toBeCloseTo(1, 4);
    for (const junk of [NaN, Infinity, -Infinity]) expect(Math.abs(safetyCurveValue(junk))).toBeLessThanOrEqual(SAFETY_CEILING);
    const t = safetyCurveTable();
    expect(t.length % 2).toBe(1);
    expect(t[(t.length - 1) / 2]).toBe(0);
    expect(t[0]).toBeCloseTo(-SAFETY_CEILING, 3);
    expect(t[t.length - 1]).toBeCloseTo(SAFETY_CEILING, 3);
    // linear region of the table maps input*1/RANGE back to the input exactly (interpolation is transparent)
    for (let i = 0; i < t.length; i++) {
      const x = ((i / (t.length - 1)) * 2 - 1) * SAFETY_RANGE;
      if (Math.abs(x) <= SAFETY_KNEE) expect(t[i]).toBeCloseTo(x, 6);
    }
    expect(safetyCurveTable()).toBe(t);
  });

  it('sits after the compressor on the way to the destination; hostile shaper creation falls back to the compressor', async () => {
    const { buildGraph } = await import('../../../src/audio/graph');
    const { DEFAULT_VOLUMES } = await import('../../../src/audio/volumes');
    const ctx = new FakeContext();
    const g = buildGraph(asCtx(ctx), asCtx(ctx).destination, { ...DEFAULT_VOLUMES });
    const comp = g.comp as unknown as FakeGain;
    const pre = [...comp.outputs][0] as unknown as FakeGain;
    expect(pre.gain.value).toBeCloseTo(0.25);
    const shaper = [...pre.outputs][0] as unknown as FakeGain;
    expect(shaper).toBe(g.safety as unknown as FakeGain);
    expect([...shaper.outputs][0]).toBe(ctx.destination);
    const broken = new FakeContext();
    (broken as unknown as { createWaveShaper: () => never }).createWaveShaper = () => {
      throw new Error('no shaper');
    };
    const g2 = buildGraph(asCtx(broken), asCtx(broken).destination, { ...DEFAULT_VOLUMES });
    expect(g2.safety).toBeNull();
    expect([...(g2.comp as unknown as FakeGain).outputs][0]).toBe(broken.destination);
  });
});
