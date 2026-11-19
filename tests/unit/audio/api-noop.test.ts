import { afterEach, describe, expect, it } from 'vitest';
import { createAudio } from '../../../src/audio/index';
import { SFX_IDS, VOICE_EMOTIONS } from '../../../src/shared/audioIds';
import type { AudioAPI } from '../../../src/audio/contracts';
import { DEFAULT_VOLUMES } from '../../../src/audio/volumes';

const JUNK: unknown[] = [NaN, Infinity, -Infinity, -1, 0, 1e9, 'x', null, undefined, {}, [], () => 1];

function hammer(a: AudioAPI): void {
  const any = a as unknown as Record<string, (...args: unknown[]) => unknown>;
  a.setVolumes({ master: NaN, music: -1, sfx: 7 });
  a.setVolumes(null as never);
  a.getVolumes();
  a.setMuted(true);
  a.setMuted('yes' as never);
  a.setDucked(true);
  a.setDucked(undefined as never);
  for (const id of SFX_IDS) {
    a.sfx(id);
    a.sfx(id, { spatial: { pan: NaN, gain: Infinity }, pitch: -3, volume: NaN });
    a.loop(`k:${id}`, id, true, { pan: 5, gain: -1 });
    a.loop(`k:${id}`, id, true);
    a.loop(`k:${id}`, id, false);
  }
  for (const j of JUNK) {
    any.sfx(j, j);
    any.loop(j, j, j, j);
    any.voice(j, j, j, j, j);
    any.music(j);
    any.setGameSpeed(j);
    any.setAmbience(j);
    any.setVolumes(j);
    any.setMuted(j);
    any.setDucked(j);
  }
  for (const e of VOICE_EMOTIONS) a.voice(1, 0.5, e, 800, { pan: 0.2, gain: 1 });
  a.music('menu');
  a.music('none');
  a.music('bogus' as never);
  a.setGameSpeed(4);
  a.setGameSpeed(NaN);
  a.setAmbience({ night: true, indoor: true, rain: true });
  a.stopAllLoops();
}

describe('AudioAPI without WebAudio (node / locked browsers)', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  afterEach(() => {
    delete g.AudioContext;
    delete g.webkitAudioContext;
  });

  it('every method is a no-op that never throws, before and after unlock/dispose', async () => {
    const a = createAudio();
    expect(a.unlocked).toBe(false);
    expect(() => hammer(a)).not.toThrow();
    await expect(a.unlock()).resolves.toBeUndefined();
    expect(a.unlocked).toBe(false);
    expect(() => hammer(a)).not.toThrow();
    a.dispose();
    a.dispose();
    expect(() => hammer(a)).not.toThrow();
    await expect(a.unlock()).resolves.toBeUndefined();
    expect(a.unlocked).toBe(false);
  });

  it('keeps sanitized volume state even without a context', () => {
    const a = createAudio();
    expect(a.getVolumes()).toEqual(DEFAULT_VOLUMES);
    a.setVolumes({ music: 0.2, sfx: NaN, voice: 3, ambient: -2 });
    const v = a.getVolumes();
    expect(v.music).toBe(0.2);
    expect(v.sfx).toBe(DEFAULT_VOLUMES.sfx);
    expect(v.voice).toBe(1);
    expect(v.ambient).toBe(0);
    // getVolumes returns a copy
    v.master = 0;
    expect(a.getVolumes().master).toBe(DEFAULT_VOLUMES.master);
  });

  it('survives an AudioContext constructor that throws', async () => {
    g.AudioContext = class {
      constructor() {
        throw new Error('blocked by policy');
      }
    };
    const a = createAudio();
    await expect(a.unlock()).resolves.toBeUndefined();
    expect(a.unlocked).toBe(false);
    expect(() => hammer(a)).not.toThrow();
  });

  it('survives a context whose factory methods throw', async () => {
    const broken = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'state') return 'running';
        if (prop === 'currentTime') return 0;
        if (prop === 'sampleRate') return 48000;
        return () => {
          throw new Error(`nope: ${String(prop)}`);
        };
      },
    });
    const a = createAudio({ contextFactory: () => broken as BaseAudioContext, timer: false });
    await expect(a.unlock()).resolves.toBeUndefined();
    expect(a.unlocked).toBe(false);
    expect(() => hammer(a)).not.toThrow();
  });

  it('a hanging resume() (autoplay-locked) does not hang unlock forever', async () => {
    const a = createAudio({
      contextFactory: () => ({ state: 'suspended', currentTime: 0, sampleRate: 48000, resume: () => new Promise(() => undefined) }) as unknown as BaseAudioContext,
      timer: false,
    });
    const t0 = Date.now();
    await a.unlock();
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(a.unlocked).toBe(false);
  });
});
