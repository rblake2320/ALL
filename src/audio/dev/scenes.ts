/**
 * Engine-in-the-loop offline renders: the real AudioEngine (mix graph, buses, ducking, compressor/limiter,
 * reverb, polyphony pools, loops, ambience, lookahead scheduler) running inside an OfflineAudioContext.
 * The render is paused every 50 ms of audio time (OfflineAudioContext.suspend) so the engine's tick() and the
 * scene's scripted events run exactly as the 25 ms realtime timer would drive them — deterministic, and
 * much faster than realtime. Used by the dev board's verification to measure what a player actually hears:
 * final peak/limiter behaviour, loudness, per-bus balance at the default volumes, and CPU headroom.
 */
import type { AudioVolumes } from '../contracts';
import { analyzeChannels, mixdown, toDb } from '../analysis';
import { AudioEngine, type AudioStats } from '../engine';
import type { SfxId, VoiceEmotion } from '../../shared/audioIds';
import { DEFAULT_VOLUMES, VOLUME_KEYS, type VolumeKey } from '../volumes';

export const SCENE_RATE = 44100;
const STEP = 0.05;

type Script = (e: AudioEngine, t: number) => void;

export interface SceneSpec {
  id: string;
  title: string;
  seconds: number;
  /** Runs once at t = 0 after unlock. */
  setup(e: AudioEngine): void;
  /** Timed events: [time, action]. */
  events: readonly (readonly [number, Script])[];
}

/** An OfflineAudioContext that reports itself running (the engine only plays into running contexts). */
function runningProxy(ctx: OfflineAudioContext): BaseAudioContext {
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'state') return 'running';
      if (prop === 'resume' || prop === 'suspend' || prop === 'close') return () => Promise.resolve();
      if (prop === 'addEventListener' || prop === 'removeEventListener') return () => undefined;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  }) as unknown as BaseAudioContext;
}

export interface SceneRender {
  buf: AudioBuffer;
  stats: AudioStats;
  renderMs: number;
}

/** Render a scene through the real engine. `volumes` replaces the defaults (solo renders zero the others). */
export async function renderScene(spec: SceneSpec, volumes: AudioVolumes = { ...DEFAULT_VOLUMES }, sampleRate = SCENE_RATE): Promise<SceneRender> {
  const len = Math.max(1, Math.ceil(spec.seconds * sampleRate));
  const off = new OfflineAudioContext(2, len, sampleRate);
  const engine = new AudioEngine({ contextFactory: () => runningProxy(off), timer: false, seed: 11 });
  engine.setVolumes(volumes);
  await engine.unlock();
  spec.setup(engine);
  const events = [...spec.events].sort((a, b) => a[0] - b[0]);
  let next = 0;
  const runUntil = (t: number) => {
    while (next < events.length && events[next][0] <= t + 1e-9) {
      try {
        events[next][1](engine, t);
      } catch {
        /* a broken scene step must not stop the render */
      }
      next++;
    }
  };
  runUntil(0);
  engine.tick();
  const quantum = 128 / sampleRate;
  let lastQ = -1;
  for (let t = STEP; t < spec.seconds - quantum; t += STEP) {
    const q = Math.round(t / quantum) * quantum;
    if (q <= lastQ || q >= len / sampleRate) continue;
    lastQ = q;
    void off.suspend(q).then(() => {
      runUntil(t);
      engine.tick();
      void off.resume();
    });
  }
  const t0 = performance.now();
  const buf = await off.startRendering();
  const renderMs = performance.now() - t0;
  const stats = engine.stats();
  engine.dispose();
  return { buf, stats, renderMs };
}

// ───────────────────────────── scenes ─────────────────────────────

const at = (t: number, f: Script): readonly [number, Script] => [t, f];
const sfx = (id: SfxId, pan = 0, gain = 1): Script => (e) => e.sfx(id, { spatial: { pan, gain } });
const say = (seed: number, pitch: number, emo: VoiceEmotion, ms: number, pan = 0, gain = 0.9): Script => (e) => e.voice(seed, pitch, emo, ms, { pan, gain });
const every = (from: number, to: number, step: number, f: (i: number) => Script): (readonly [number, Script])[] => {
  const out: (readonly [number, Script])[] = [];
  for (let t = from, i = 0; t < to; t += step, i++) out.push(at(t, f(i)));
  return out;
};

export const SCENES: readonly SceneSpec[] = [
  {
    id: 'day-live',
    title: 'Day, live mode: lounge score, wind + crows, a zombie cooking and chatting',
    seconds: 12,
    setup(e) {
      e.music('live');
      e.setAmbience({ night: false, indoor: false });
      e.loop('steps:a1', 'footstep', true, { pan: -0.3, gain: 0.7 });
      e.loop('shower:o4', 'shower', true, { pan: 0.7, gain: 0.25 });
    },
    events: [
      at(1.5, (e) => e.loop('steps:a1', 'footstep', false)),
      at(2, sfx('fridgeOpen', -0.2, 0.8)),
      at(3, (e) => e.loop('cook:o2', 'cook', true, { pan: -0.2, gain: 0.6 })),
      ...every(5, 6.2, 0.3, () => sfx('chop', -0.2, 0.6)),
      ...every(1, 12, 2.6, (i) => say(10 + (i % 2), i % 2 ? 0.7 : 0.3, (['neutral', 'happy', 'question', 'neutral', 'laugh'] as const)[i % 5], 1200, i % 2 ? 0.4 : -0.3)),
      at(8, sfx('cash')),
      at(9.5, sfx('notify')),
      at(10.5, (e) => e.loop('cook:o2', 'cook', false)),
    ],
  },
  {
    id: 'night-moon',
    title: 'Full-moon night: music box score, crickets, shimmer, owls, a snoring zombie',
    seconds: 12,
    setup(e) {
      e.music('night');
      e.setAmbience({ night: true, indoor: false, moon: true });
      e.loop('run:7', 'snore', true, { pan: 0.2, gain: 0.5 });
    },
    events: [at(2, sfx('owl', -0.6, 0.6)), at(4, say(21, 0.4, 'yawn', 1500, 0.2, 0.7)), at(7, sfx('groanAmbient', 0.5, 0.5))],
  },
  {
    id: 'party',
    title: 'Party: danse-macabre score ducked under a nearby stereo, chatter, cheers, a promotion',
    seconds: 12,
    setup(e) {
      e.music('party');
      e.setAmbience({ night: true, indoor: true });
      e.loop('stereo:o1', 'stereoMusic', true, { pan: 0.3, gain: 0.9 });
    },
    events: [
      ...every(0.5, 11, 0.9, (i) => say(30 + (i % 6), (i % 6) / 6, (['laugh', 'happy', 'flirty', 'surprised', 'neutral', 'question'] as const)[i % 6], 900 + (i % 3) * 300, ((i % 5) - 2) / 3, 0.8)),
      at(4, sfx('cheer')),
      at(6, sfx('partyHorn', 0.4)),
      at(7, sfx('dishClatter', -0.5, 0.7)),
      at(9, sfx('kiss')),
      at(10, sfx('promotion')),
    ],
  },
  {
    id: 'build',
    title: 'Build mode: plucky score, placing, rotating, walls, paint, UI',
    seconds: 10,
    setup(e) {
      e.music('build');
      e.setAmbience({ night: false, indoor: false });
    },
    events: [
      ...every(0.5, 9.5, 1.1, () => sfx('placeObject')),
      ...every(1, 2, 0.25, () => sfx('rotateObject')),
      ...every(3, 4, 0.15, () => sfx('wallBuild')),
      ...every(5, 6.5, 0.18, () => sfx('floorPaint')),
      at(7, sfx('sellObject')),
      at(7.6, sfx('undo')),
      ...every(8, 9.5, 0.3, () => sfx('uiClick')),
      at(9.6, sfx('uiError')),
    ],
  },
  {
    id: 'stress',
    title: 'Stress: 24+ loops, a 40-sound burst, 8 voices, every stinger, thunder — the limiter must hold',
    seconds: 10,
    setup(e) {
      e.music('tense');
      e.setAmbience({ night: true, indoor: false, rain: true, moon: true });
      const ids: SfxId[] = ['shower', 'fireLoop', 'tvChatter', 'stereoMusic', 'cook', 'flies', 'arcadeBlips', 'computerTyping', 'sinkWater', 'microwave', 'espresso', 'snore', 'phoneRing', 'tvStatic'];
      for (let i = 0; i < 28; i++) e.loop(`stress:${i}`, ids[i % ids.length], true, { pan: ((i % 7) - 3) / 3, gain: 0.5 + (i % 5) / 10 });
    },
    events: [
      at(2, (e) => {
        const ids: SfxId[] = ['limbDrop', 'gymClank', 'trashLid', 'slap', 'doorbell', 'cash', 'crumble', 'bathSplash', 'zap', 'placeObject'];
        for (let i = 0; i < 40; i++) e.sfx(ids[i % ids.length], { spatial: { pan: ((i % 9) - 4) / 4, gain: 1 } });
      }),
      at(3, (e) => e.music('party')),
      ...every(3.5, 4.5, 0.12, (i) => say(50 + i, i / 8, (['scream', 'angry', 'laugh', 'surprised'] as const)[i % 4], 2500, ((i % 5) - 2) / 2, 1)),
      at(5, sfx('promotion')),
      at(5.4, sfx('milestone')),
      at(5.8, sfx('reanimate')),
      at(6.2, sfx('fail')),
      at(6.6, sfx('repoGhoul')),
      at(7, sfx('thunder')),
      at(7.2, sfx('skillUp')),
    ],
  },
];

// ───────────────────────────── measurement ─────────────────────────────

export interface BusLevel {
  /** RMS over the whole scene (dB FS). */
  rmsDb: number;
  /** RMS over the non-silent span (dB FS). */
  activeRmsDb: number;
  /** Loudest 400 ms window (dB FS) — "short-term" level. */
  maxWindowDb: number;
}

export interface SceneEntry {
  id: string;
  title: string;
  seconds: number;
  peak: number;
  clipCount: number;
  nanCount: number;
  dcOffset: number;
  mix: BusLevel;
  buses: Partial<Record<VolumeKey, BusLevel>>;
  stats: AudioStats;
  /** Offline render time / audio time for the full mix (CPU proxy on this machine; lower is better). */
  realtimeFactor: number;
  checks: Record<string, boolean>;
  pass: boolean;
  notes: string[];
}

export function levelOf(buf: AudioBuffer): BusLevel {
  const ch: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
  const st = analyzeChannels(ch, buf.sampleRate);
  const mono = mixdown(ch);
  const win = Math.round(buf.sampleRate * 0.4);
  let maxW = 0;
  for (let i = 0; i + win <= mono.length; i += Math.round(win / 2)) {
    let s = 0;
    for (let k = i; k < i + win; k++) s += mono[k] * mono[k];
    maxW = Math.max(maxW, Math.sqrt(s / win));
  }
  const r = (x: number) => Math.round(x * 10) / 10;
  return { rmsDb: r(st.rmsDb), activeRmsDb: r(st.activeRmsDb), maxWindowDb: r(toDb(maxW)) };
}

/** Full mix + per-bus solo renders of one scene, with mix-balance sanity checks. */
export async function measureScene(spec: SceneSpec, solo: boolean): Promise<{ entry: SceneEntry; mixBuf: AudioBuffer }> {
  const full = await renderScene(spec);
  const ch: Float32Array[] = [];
  for (let c = 0; c < full.buf.numberOfChannels; c++) ch.push(full.buf.getChannelData(c));
  const st = analyzeChannels(ch, full.buf.sampleRate);
  const mix = levelOf(full.buf);
  const buses: Partial<Record<VolumeKey, BusLevel>> = {};
  if (solo) {
    for (const k of VOLUME_KEYS) {
      if (k === 'master') continue;
      const v: AudioVolumes = { ...DEFAULT_VOLUMES, music: 0, sfx: 0, voice: 0, ambient: 0, ui: 0 };
      v[k] = DEFAULT_VOLUMES[k];
      const r = await renderScene(spec, v);
      buses[k] = levelOf(r.buf);
    }
  }
  const notes: string[] = [];
  const checks: Record<string, boolean> = {
    peakOk: st.peak <= 0.98,
    noClip: st.clipCount === 0,
    noNaN: st.nanCount === 0,
    dcOk: st.dcOffset < 0.01,
    audible: mix.rmsDb > -45,
    notHot: mix.maxWindowDb < -6,
    noErrors: full.stats.errors === 0,
  };
  const m = buses.music;
  const a = buses.ambient;
  const vo = buses.voice;
  if (m && a && a.rmsDb > -200) {
    // the bed sits under the score but is still there
    checks.ambienceUnderMusic = spec.id === 'night-moon' || a.rmsDb < m.rmsDb;
    checks.ambiencePresent = a.rmsDb > -66;
    if (!checks.ambiencePresent) notes.push(`ambience nearly inaudible (${a.rmsDb} dB)`);
  }
  if (m && vo && vo.activeRmsDb > -200) {
    // speech must ride over the score while someone talks
    checks.voiceOverMusic = vo.maxWindowDb > m.maxWindowDb - 3;
    if (!checks.voiceOverMusic) notes.push(`voices ${vo.maxWindowDb} dB vs music ${m.maxWindowDb} dB (short-term)`);
  }
  const pass = Object.values(checks).every(Boolean);
  return {
    entry: {
      id: spec.id,
      title: spec.title,
      seconds: spec.seconds,
      peak: Math.round(st.peak * 1000) / 1000,
      clipCount: st.clipCount,
      nanCount: st.nanCount,
      dcOffset: Math.round(st.dcOffset * 1e5) / 1e5,
      mix,
      buses,
      stats: full.stats,
      realtimeFactor: Math.round((full.renderMs / (spec.seconds * 1000)) * 1000) / 1000,
      checks,
      pass,
      notes,
    },
    mixBuf: full.buf,
  };
}
