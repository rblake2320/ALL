/**
 * Loop factories. Continuous "beds" run persistent sources (stopped explicitly); event-driven loops
 * schedule discrete sounds inside the lookahead window handed to schedule(from, to). Any one-shot can
 * also loop generically via repeatLoop (recipe + random gap).
 */
import { filterNode, gainNode, noiseHit, noiseSrc, oscNode, randomLfo, squelch, startStop, stopSrc } from '../synth/core';
import type { LoopFactory, LoopVoice, OneShot } from '../synth/types';
import { cloneSx } from '../synth/types';
import { planVoice } from '../voice/groanish';
import { renderVoice } from '../voice/render';
import type { VoiceEmotion } from '../../shared/audioIds';
import {
  arcadePhrase, bubble, droplet, radioChain, radioNotes, sizzle, snore, staticBed, tvSpeaker, typingBurst, waterBed,
} from './life-a';
import { fireBed, fly, ringBurst } from './life-b';
import { chirp, groanCluster, moonBed, rainBed, windBed } from './world';

/** Cap on discrete events a single schedule() call may create (stall protection). */
const MAX_EVENTS_PER_CALL = 24;

interface Ticker {
  next: number;
}

/** Run `fire(t)` for each event time in [from, to); `interval()` gives the gap to the next one. */
function ticker(state: Ticker, from: number, to: number, fire: (t: number) => number | void, interval: () => number): void {
  if (state.next < from - 0.5) state.next = from; // stalled (hidden tab): resync instead of bursting
  let n = 0;
  while (state.next < to && n++ < MAX_EVENTS_PER_CALL) {
    const t = Math.max(state.next, from);
    const len = fire(t);
    state.next = t + (typeof len === 'number' && len > 0 ? len : 0) + Math.max(0.01, interval());
  }
}

export function bedVoice(srcs: AudioScheduledSourceNode[], sched?: (from: number, to: number) => void): LoopVoice {
  let stopped = false;
  return {
    stop(when: number): void {
      if (stopped) return;
      stopped = true;
      for (const s of srcs) stopSrc(s, when);
    },
    schedule: sched
      ? (from: number, to: number): void => {
          if (!stopped) sched(from, to);
        }
      : undefined,
  };
}

/** Generic loop: re-trigger a one-shot with a random gap (s) between repeats. */
export function repeatLoop(recipe: OneShot, gap: readonly [number, number]): LoopFactory {
  return (sx0) => {
    const s = cloneSx(sx0);
    const st: Ticker = { next: sx0.t };
    return bedVoice([], (from, to) =>
      ticker(st, from, to, (t) => {
        s.t = t;
        return recipe(s);
      }, () => s.rng.range(gap[0], gap[1])));
  };
}

/** Bed level so a looping bed matches its one-shot loudness. */
function bedOut(sx: { ctx: BaseAudioContext; out: AudioNode }, level: number): GainNode {
  const g = gainNode(sx.ctx, level);
  g.connect(sx.out);
  return g;
}

export const fireLoopLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const srcs = fireBed(s, bedOut(sx, 0.55), sx.t, null);
  const st: Ticker = { next: sx.t + 0.2 };
  return bedVoice(srcs, (from, to) =>
    ticker(st, from, to, (t) => {
      s.t = t;
      noiseHit(s, { filter: 'bandpass', f: s.rng.range(600, 1500), q: 1.5, d: 0.015, peak: s.rng.range(0.08, 0.18) });
    }, () => s.rng.range(0.25, 0.9)));
};

export const showerLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const srcs = waterBed(s, bedOut(sx, 0.55), sx.t, null, true);
  const st: Ticker = { next: sx.t };
  return bedVoice(srcs, (from, to) => ticker(st, from, to, (t) => { s.t = t; droplet(s, 0, s.rng.range(0.02, 0.05)); }, () => s.rng.range(0.06, 0.22)));
};

export const sinkLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const srcs = waterBed(s, bedOut(sx, 0.5), sx.t, null, false);
  const st: Ticker = { next: sx.t };
  return bedVoice(srcs, (from, to) => ticker(st, from, to, (t) => { s.t = t; bubble(s, 0, s.rng.range(0.03, 0.06)); }, () => s.rng.range(0.12, 0.38)));
};

export const cookLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  // bed level matched to the cook one-shot (≈ -26 dB active RMS): a bright sizzle that runs for a whole
  // recipe must sit under voices, not on top of them
  const g = gainNode(sx.ctx, 0.28);
  g.connect(sx.out);
  const srcs = sizzle(s, g, sx.t, null);
  const st: Ticker = { next: sx.t + 0.3 };
  return bedVoice(srcs, (from, to) =>
    ticker(st, from, to, (t) => {
      s.t = t;
      if (s.rng.chance(0.5)) squelch(s, { f: s.rng.range(400, 700), f2: s.rng.range(800, 1200), d: 0.07, peak: 0.04 });
      else noiseHit(s, { filter: 'highpass', f: 3000, d: 0.01, peak: 0.08 });
    }, () => s.rng.range(0.25, 0.8)));
};

export const tvStaticLoop: LoopFactory = (sx) => {
  const g = gainNode(sx.ctx, 0.36);
  g.connect(sx.out);
  return bedVoice(staticBed(cloneSx(sx), g, sx.t, null, 1));
};

const TV_EMOTIONS: readonly VoiceEmotion[] = ['neutral', 'neutral', 'question', 'happy', 'surprised', 'neutral', 'laugh'];

export const tvChatterLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const spk = tvSpeaker(s);
  const vs = cloneSx(s, spk);
  const g = gainNode(sx.ctx, 0.05);
  g.connect(sx.out);
  const srcs = staticBed(s, g, sx.t, null, 1);
  const cast = [s.rng.int(1, 1e5), s.rng.int(1, 1e5), s.rng.int(1, 1e5)];
  const pitches = [0.65, 0.4, 0.8];
  let speaker = 0;
  let utter = 0;
  const handles: { stop(w: number): void }[] = [];
  const st: Ticker = { next: sx.t + 0.05 };
  const voice = bedVoice(srcs, (from, to) =>
    ticker(st, from, to, (t) => {
      vs.t = t;
      speaker = s.rng.chance(0.7) ? (speaker + 1) % cast.length : speaker;
      const emo = s.rng.pick(TV_EMOTIONS);
      const ms = emo === 'laugh' ? 900 : s.rng.range(450, 1600);
      const plan = planVoice(cast[speaker], pitches[speaker], emo, ms, utter++);
      // broadcast audio is compressed: every emotion at the same level (zombie emotion levels go up to 2.7x)
      const h = renderVoice(vs, plan, 0.75 / Math.max(1, plan.level));
      handles.push(h);
      if (handles.length > 4) handles.shift();
      return h.end - t;
    }, () => s.rng.range(0.08, 0.4)));
  return {
    stop(when: number): void {
      voice.stop(when);
      for (const h of handles) h.stop(when);
    },
    schedule: voice.schedule,
  };
};

export const stereoLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const g = gainNode(sx.ctx, 0.55);
  g.connect(sx.out);
  const chain = radioChain(cloneSx(s, g));
  const start = sx.t;
  let stopped = false;
  return {
    stop(): void {
      stopped = true;
    },
    schedule(from: number, to: number): void {
      if (!stopped) radioNotes(s, chain, start, from, to);
    },
  };
};

export const typingLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const st: Ticker = { next: sx.t };
  return bedVoice([], (from, to) => ticker(st, from, to, (t) => { s.t = t; return typingBurst(s, 0, s.rng.int(4, 15)) - t; }, () => s.rng.range(0.3, 1.2)));
};

export const arcadeLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const st: Ticker = { next: sx.t };
  return bedVoice([], (from, to) => ticker(st, from, to, (t) => { s.t = t; return arcadePhrase(s, 0) - t; }, () => s.rng.range(0.1, 0.6)));
};

export const fliesLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const srcs: AudioScheduledSourceNode[] = [];
  for (let i = 0; i < 3; i++) srcs.push(...fly(s, sx.out, sx.t, Infinity, 0.06));
  return bedVoice(srcs);
};

export const snoreLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const st: Ticker = { next: sx.t };
  return bedVoice([], (from, to) => ticker(st, from, to, (t) => { s.t = t; return snore(s); }, () => s.rng.range(1.5, 2.3)));
};

export const cricketsLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const bugs = [0, 1, 2].map((i) => ({ f: s.rng.range(4100, 5300), period: s.rng.range(0.38, 0.62), level: [1, 0.7, 0.45][i], st: { next: sx.t + s.rng.range(0, 0.4) } as Ticker }));
  return bedVoice([], (from, to) => {
    for (const b of bugs) ticker(b.st, from, to, (t) => { s.t = t; chirp(s, 0, b.f, b.level); }, () => b.period * s.rng.range(0.9, 1.15));
  });
};

export const windLoop: LoopFactory = (sx) => bedVoice(windBed(cloneSx(sx), bedOut(sx, 0.6), sx.t, null));

export const rainLoop: LoopFactory = (sx) => bedVoice(rainBed(cloneSx(sx), bedOut(sx, 0.6), sx.t, null));

/** Full-moon shimmer bed (ambience layer for `setAmbience({ moon: true })` nights). */
export const moonLoop: LoopFactory = (sx) => bedVoice(moonBed(cloneSx(sx), bedOut(sx, 0.12), sx.t, null));

export const groanLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const st: Ticker = { next: sx.t };
  return bedVoice([], (from, to) => ticker(st, from, to, (t) => { s.t = t; return groanCluster(s, 0, s.rng.int(2, 3), s.rng.range(0.6, 1)) - t - 0.4; }, () => s.rng.range(0.4, 2.4)));
};

export const microwaveLoop: LoopFactory = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const s = cloneSx(sx);
  const saw = oscNode(ctx, 'sawtooth', 120);
  const lp = filterNode(ctx, 'lowpass', 600, 0.7);
  const g1 = gainNode(ctx, 0.02);
  saw.connect(lp).connect(g1).connect(sx.out);
  const sine = oscNode(ctx, 'sine', 60);
  const g2 = gainNode(ctx, 0.05);
  sine.connect(g2).connect(sx.out);
  const fan = noiseSrc(s, 'brown', t, Infinity);
  const flp = filterNode(ctx, 'lowpass', 400, 0.7);
  const g3 = gainNode(ctx, 0.04);
  fan.connect(flp).connect(g3).connect(sx.out);
  startStop(saw, t, Infinity);
  startStop(sine, t, Infinity);
  return bedVoice([saw, sine, fan, randomLfo(s, 1.5, 0.02, g3.gain, t, Infinity)]);
};

export const espressoLoop: LoopFactory = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const s = cloneSx(sx);
  const pump = oscNode(ctx, 'sawtooth', 50);
  const lp = filterNode(ctx, 'lowpass', 300, 0.7);
  const pg = gainNode(ctx, 0.1);
  pump.connect(lp).connect(pg).connect(sx.out);
  startStop(pump, t, Infinity);
  const n = noiseSrc(s, 'pink', t, Infinity);
  const bp = filterNode(ctx, 'bandpass', 1600, 3);
  const am = gainNode(ctx, 0.1);
  n.connect(bp).connect(am).connect(sx.out);
  const st: Ticker = { next: t + 0.2 };
  return bedVoice([pump, n, randomLfo(s, 18, 0.1, am.gain, t, Infinity)], (from, to) =>
    ticker(st, from, to, (tt) => { s.t = tt; squelch(s, { f: 800, f2: 400, d: 0.05, peak: 0.05 }); }, () => s.rng.range(0.1, 0.5)));
};

export const phoneRingLoop: LoopFactory = (sx) => {
  const s = cloneSx(sx);
  const st: Ticker = { next: sx.t };
  return bedVoice([], (from, to) => ticker(st, from, to, (t) => { s.t = t; return ringBurst(s, 0) - t; }, () => 1.6));
};
