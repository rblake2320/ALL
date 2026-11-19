/**
 * AudioEngine: the AudioAPI implementation. Owns the (lazily created) AudioContext, the mix graph, the
 * one-shot/voice polyphony pools, loops, music and ambience, and the 25 ms lookahead timer.
 * Every public method is total: callable at any time (before unlock, after dispose, without WebAudio)
 * with any input, never throws.
 */
import type { AudioAPI, AudioVolumes } from './contracts';
import { SFX_IDS, type MusicMood, type SfxId, type VoiceEmotion } from '../shared/audioIds';
import { Ambience, sanitizeAmbience, type AmbienceState } from './ambience';
import { armGestureRetry, resumeWithin, stateOf, tryResume, trySuspend, watchContextState } from './contextWatch';
import { buildGraph, radioDuckFor, type MixGraph } from './graph';
import { LoopManager, specForSfx } from './loopManager';
import { MOODS } from './music/moods';
import { MusicPlayer } from './music/player';
import { LOOKAHEAD_SEC, SCHEDULER_INTERVAL_MS } from './music/scheduler';
import { RateLimiter, VoicePool } from './polyphony';
import { createRng, toSeed, type Rng } from './prng';
import { SFX_TABLE, type BusId } from './sfx/table';
import { gainNode, stereo } from './synth/core';
import type { OneShot, Sx } from './synth/types';
import { planVoice } from './voice/groanish';
import { renderVoice, type VoiceHandle } from './voice/render';
import { DEFAULT_VOLUMES, copyVolumes, finite, mergeVolumes, readSpatial, sanitizeMultiplier } from './volumes';

export const MAX_SFX_VOICES = 24;
export const MAX_SPEECH_VOICES = 6;
const START_OFFSET = 0.01;
/** Mute fades for ~30 ms, then the context is suspended (CPU/battery while hidden). */
const MUTE_SUSPEND_MS = 160;
/** How long unlock() waits for resume() before giving up (autoplay-locked browsers never settle). */
const RESUME_TIMEOUT_MS = 1500;
/** Fresh contexts we may create after the current one was closed under us. */
const MAX_RECREATIONS = 3;

export { RADIO_DUCK_DEPTH, RADIO_DUCK_FROM, radioDuckFor } from './graph';

export interface AudioEngineOptions {
  /** PRNG seed for per-play variation (default fixed: reproducible). */
  seed?: number;
  /** Override context creation (tests, offline). Return null to simulate "no WebAudio". */
  contextFactory?: () => BaseAudioContext | null;
  /** Start the internal setInterval scheduler (default true). Tests drive tick() manually. */
  timer?: boolean;
}

interface OneShotVoice {
  out: GainNode;
  pan: AudioNode | null;
}

interface SpeechVoice {
  handle: VoiceHandle;
  out: GainNode;
  pan: AudioNode | null;
}

const SFX_INDEX = new Map<SfxId, number>(SFX_IDS.map((id, i) => [id, i]));

/** Diagnostics snapshot (a type alias so it satisfies AudioAPI.stats's Record<string, primitive>). */
export type AudioStats = {
  state: string;
  unlocked: boolean;
  muted: boolean;
  ducked: boolean;
  sfxVoices: number;
  speechVoices: number;
  loops: number;
  ambientLoops: number;
  musicMood: MusicMood | 'none';
  musicSections: number;
  gameSpeed: number;
  /** Score gain under a nearby stereo (1 = no duck). */
  radioDuck: number;
  /** Times the browser/OS suspended the context without us asking (recovered on resume/gesture). */
  interruptions: number;
  /** One-shots refused by the per-id rate limiter (spam protection). */
  dropped: number;
  /** Music notes skipped by the per-cue polyphony budget. */
  musicDropped: number;
  errors: number;
};

function defaultContext(): BaseAudioContext | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

export class AudioEngine implements AudioAPI {
  private ctx: BaseAudioContext | null = null;
  private graph: MixGraph | null = null;
  private volumes: AudioVolumes = copyVolumes(DEFAULT_VOLUMES);
  private muted = false;
  private ducked = false;
  private disposed = false;
  private everRunning = false;
  private suspendedByUs = false;
  private unlocking: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly rng: Rng;
  private readonly loops = new LoopManager();
  private readonly ambLoops = new LoopManager();
  private player: MusicPlayer | null = null;
  private ambience: Ambience | null = null;
  private desiredMood: MusicMood | 'none' = 'none';
  private desiredAmbience: AmbienceState | null = null;
  private gameSpeed = 1;
  private utterance = 0;
  private dropped = 0;
  private errors = 0;
  private interruptions = 0;
  private recreations = 0;
  private radioDuck = 1;
  /** Removes the gesture listeners armed after an involuntary suspension. */
  private recovery: (() => void) | null = null;
  /** Removes the context's statechange listener. */
  private unwatch: (() => void) | null = null;
  private readonly spatial = { pan: 0, gain: 1 };
  private readonly scratch: Sx;
  private readonly graveyard: { node: AudioNode; at: number }[] = [];
  private readonly sfxPool: VoicePool<OneShotVoice>;
  private readonly speechPool: VoicePool<SpeechVoice>;
  private readonly limiter = new RateLimiter(SFX_IDS.length, 3, 0.05);

  constructor(private readonly options: AudioEngineOptions = {}) {
    this.rng = createRng(options.seed ?? 0x5eed);
    this.scratch = { ctx: null as unknown as BaseAudioContext, out: null as unknown as AudioNode, t: 0, rng: this.rng, pitch: 1, vol: 1 };
    this.sfxPool = new VoicePool<OneShotVoice>(MAX_SFX_VOICES, {
      steal: (v) => this.retire(v.out, v.pan, true),
      expire: (v) => this.retire(v.out, v.pan, false),
    });
    this.speechPool = new VoicePool<SpeechVoice>(MAX_SPEECH_VOICES, {
      steal: (v) => {
        const now = this.ctx?.currentTime ?? 0;
        v.handle.stop(now);
        this.retire(v.out, v.pan, true);
      },
      expire: (v) => this.retire(v.out, v.pan, false),
    });
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  get unlocked(): boolean {
    const c = this.ctx;
    if (!c || this.disposed || !this.everRunning) return false;
    const st = stateOf(c);
    return st === 'running' || (this.suspendedByUs && st === 'suspended');
  }

  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.unlocking) return this.unlocking;
    const p = this.doUnlock().catch(() => {
      this.errors++;
    });
    this.unlocking = p.finally(() => {
      this.unlocking = null;
    });
    return this.unlocking;
  }

  private async doUnlock(): Promise<void> {
    let ctx = this.ctx;
    if (ctx && stateOf(ctx) === 'closed') {
      // closed under us (host bug / hostile factory): start over, keeping the desired loops/music/ambience
      if (this.recreations >= MAX_RECREATIONS) return;
      this.recreations++;
      this.dropContext(true);
      ctx = null;
    }
    if (!ctx) {
      ctx = this.createContext();
      if (!ctx) return;
    }
    // already unlocked and deliberately suspended while muted: nothing to do until unmute
    if (this.muted && this.suspendedByUs && this.everRunning) return;
    // resume inside the gesture even when muted: the gesture is what satisfies autoplay policies (and iOS);
    // onRunning() re-suspends straight away if we are muted
    if (stateOf(ctx) !== 'running') await resumeWithin(ctx, RESUME_TIMEOUT_MS);
    if (this.disposed || this.ctx !== ctx) return;
    if (stateOf(ctx) === 'running') this.onRunning(ctx);
  }

  private createContext(): BaseAudioContext | null {
    let ctx: BaseAudioContext | null = null;
    try {
      ctx = this.options.contextFactory ? this.options.contextFactory() : defaultContext();
    } catch {
      ctx = null;
    }
    if (!ctx) return null;
    this.ctx = ctx;
    try {
      this.setupGraph(ctx);
    } catch {
      this.errors++;
      // keep the desired loops: a later unlock may get a working context
      this.teardownGraph(true);
      this.ctx = null;
      return null;
    }
    this.watchState(ctx);
    return ctx;
  }

  /** Forget the current context (closed under us); `keepDesired` keeps loop requests for the next one. */
  private dropContext(keepDesired: boolean): void {
    this.stopTimer();
    this.clearMuteTimer();
    this.disarmRecovery();
    this.unwatch?.();
    this.unwatch = null;
    this.teardownGraph(keepDesired);
    this.ctx = null;
    this.everRunning = false;
    this.suspendedByUs = false;
  }

  /** The context is producing sound: (re)apply the desired state and run the scheduler — or park it if muted. */
  private onRunning(ctx: BaseAudioContext): void {
    if (this.disposed || this.ctx !== ctx) return;
    if (!this.everRunning) {
      this.everRunning = true;
      this.primeIOS(ctx);
    }
    this.disarmRecovery();
    if (this.muted) {
      // unlocked while muted (window hidden/unfocused): keep the unlock, but save CPU until unmute
      this.suspendForMute(ctx);
      return;
    }
    this.suspendedByUs = false;
    this.applyDesiredState();
    this.startTimer();
  }

  private suspendForMute(ctx: BaseAudioContext): void {
    if (stateOf(ctx) !== 'running') return;
    if (typeof (ctx as AudioContext).suspend !== 'function') return;
    this.suspendedByUs = true;
    this.stopTimer();
    trySuspend(ctx);
  }

  private resumeFromMute(ctx: BaseAudioContext): void {
    // never unlocked by a gesture yet: unlock() will start everything
    if (!this.everRunning) return;
    if (stateOf(ctx) === 'running' && !this.suspendedByUs) {
      this.onRunning(ctx);
      return;
    }
    tryResume(ctx, (ok) => {
      if (ok && stateOf(ctx) === 'running') this.onRunning(ctx);
      else this.armRecovery(ctx);
    });
  }

  /** Follow state changes we did not ask for (iOS interruptions, audio device loss, the OS resuming us). */
  private watchState(ctx: BaseAudioContext): void {
    this.unwatch = watchContextState(ctx, () => {
      try {
        this.onStateChange(ctx);
      } catch {
        this.errors++;
      }
    });
  }

  private onStateChange(ctx: BaseAudioContext): void {
    if (this.disposed || this.ctx !== ctx) return;
    const st = stateOf(ctx);
    if (st === 'running') {
      if (this.everRunning) this.onRunning(ctx);
      return;
    }
    if (st === 'closed') {
      this.stopTimer();
      this.disarmRecovery();
      return;
    }
    // 'suspended' / 'interrupted' that we did not request
    if (!this.suspendedByUs && this.everRunning && !this.muted) {
      this.interruptions++;
      this.armRecovery(ctx);
    }
  }

  /** Try to resume now (allowed without a gesture once the page was activated) and on the next gesture. */
  private armRecovery(ctx: BaseAudioContext): void {
    if (this.disposed || this.muted || this.ctx !== ctx) return;
    const retry = (): void => {
      const st = stateOf(ctx);
      if (this.disposed || this.muted || this.ctx !== ctx || st === 'running' || st === 'closed') return;
      tryResume(ctx);
    };
    retry();
    if (!this.recovery) this.recovery = armGestureRetry(retry);
  }

  private disarmRecovery(): void {
    const r = this.recovery;
    this.recovery = null;
    if (r) r();
  }

  private setupGraph(ctx: BaseAudioContext): void {
    const graph = buildGraph(ctx, ctx.destination, this.volumes);
    this.graph = graph;
    if (this.muted) graph.mute.gain.value = 0;
    if (this.ducked) graph.setDucked(true);
    this.player = new MusicPlayer(ctx, graph.input.music, graph.musicWet);
    const host = { ctx, input: (b: BusId) => graph.input[b], rng: this.rng };
    this.loops.attach(host);
    this.ambLoops.attach(host);
    this.ambience = new Ambience({
      now: () => ctx.currentTime,
      rng: this.rng,
      loops: this.ambLoops,
      oneShot: (recipe, pan, gain) => this.playRecipe(recipe, 'ambient', pan, gain, 1, false),
      setIndoor: (indoor, thin) => graph.setIndoor(indoor, thin),
    });
    this.applySpeed();
  }

  private teardownGraph(keepDesired: boolean): void {
    try {
      this.player?.dispose();
    } catch {
      /* ignore */
    }
    this.player = null;
    try {
      this.ambience?.stop();
    } catch {
      /* ignore */
    }
    this.ambience = null;
    if (keepDesired) {
      this.loops.detach();
    } else {
      this.loops.dispose();
    }
    this.ambLoops.dispose();
    this.radioDuck = 1;
    this.sfxPool.clear(false);
    this.speechPool.clear(false);
    try {
      this.graph?.dispose();
    } catch {
      /* ignore */
    }
    this.graph = null;
  }

  /** iOS/Safari: play one silent sample inside the gesture so output really starts. */
  private primeIOS(ctx: BaseAudioContext): void {
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      s.stop(ctx.currentTime + 0.05);
    } catch {
      /* ignore */
    }
  }

  private applyDesiredState(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.player && this.player.currentMood !== this.desiredMood) this.player.setMood(this.desiredMood, ctx.currentTime);
    if (this.ambience && this.desiredAmbience) this.ambience.set(this.desiredAmbience);
  }

  private startTimer(): void {
    if (this.timer || this.options.timer === false || this.disposed) return;
    try {
      this.timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
    } catch {
      this.timer = null;
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private clearMuteTimer(): void {
    if (this.muteTimer) clearTimeout(this.muteTimer);
    this.muteTimer = null;
  }

  /** True while the lookahead timer runs (tests/diagnostics). */
  get timerRunning(): boolean {
    return this.timer !== null;
  }

  /** Lookahead scheduler step (25 ms timer). Public for tests/dev; never throws. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    let now = 0;
    try {
      now = finite(ctx.currentTime, 0);
    } catch {
      return;
    }
    const horizon = now + LOOKAHEAD_SEC;
    try {
      this.sfxPool.prune(now);
      this.speechPool.prune(now);
    } catch {
      this.errors++;
    }
    try {
      this.player?.pump(now);
    } catch {
      this.errors++;
    }
    try {
      this.loops.pump(now, horizon);
      this.ambLoops.pump(now, horizon);
    } catch {
      this.errors++;
    }
    try {
      this.ambience?.pump(now);
    } catch {
      this.errors++;
    }
    try {
      // diegetic priority: the score steps back while a stereo plays near the camera
      const duck = radioDuckFor(this.loops.maxGainOf('stereoMusic'));
      if (Math.abs(duck - this.radioDuck) > 0.02 || (duck === 1 && this.radioDuck !== 1)) {
        this.radioDuck = duck;
        this.graph?.setRadioDuck(duck);
      }
    } catch {
      this.errors++;
    }
    const gy = this.graveyard;
    for (let i = gy.length - 1; i >= 0; i--) {
      if (gy[i].at <= now) {
        try {
          gy[i].node.disconnect();
        } catch {
          /* ignore */
        }
        gy.splice(i, 1);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimer();
    this.clearMuteTimer();
    this.disarmRecovery();
    this.unwatch?.();
    this.unwatch = null;
    this.teardownGraph(false);
    for (const g of this.graveyard) {
      try {
        g.node.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.graveyard.length = 0;
    const ctx = this.ctx;
    this.ctx = null;
    try {
      const close = (ctx as AudioContext | null)?.close;
      if (ctx && typeof close === 'function') void close.call(ctx).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  // ───────────────────────────── mix ─────────────────────────────

  setVolumes(v: Partial<AudioVolumes>): void {
    try {
      this.volumes = mergeVolumes(this.volumes, v);
      this.graph?.setVolumes(this.volumes);
    } catch {
      this.errors++;
    }
  }

  getVolumes(): AudioVolumes {
    return copyVolumes(this.volumes);
  }

  setMuted(muted: boolean): void {
    try {
      const m = muted === true;
      if (m === this.muted) return;
      this.muted = m;
      const ctx = this.ctx;
      if (!ctx || !this.graph) return;
      this.graph.setMuted(m);
      this.clearMuteTimer();
      if (m) {
        this.disarmRecovery();
        // after the fade, suspend the context to save CPU/battery (window hidden, pause menu)
        this.muteTimer = setTimeout(() => {
          this.muteTimer = null;
          if (this.muted && !this.disposed && this.ctx === ctx) this.suspendForMute(ctx);
        }, MUTE_SUSPEND_MS);
      } else {
        this.resumeFromMute(ctx);
      }
    } catch {
      this.errors++;
    }
  }

  setDucked(ducked: boolean): void {
    try {
      const d = ducked === true;
      if (d === this.ducked) return;
      this.ducked = d;
      this.graph?.setDucked(d);
    } catch {
      this.errors++;
    }
  }

  // ───────────────────────────── one-shots ─────────────────────────────

  private playable(): boolean {
    const c = this.ctx;
    return !!c && !!this.graph && !this.disposed && !this.muted && c.state === 'running';
  }

  sfx(id: SfxId, opts?: { spatial?: { pan: number; gain: number }; pitch?: number; volume?: number }): void {
    try {
      if (!this.playable()) return;
      const def = SFX_TABLE[id];
      const idx = SFX_INDEX.get(id);
      if (!def || idx === undefined) return;
      if (id === 'footstep' && this.gameSpeed >= 3) return;
      const now = (this.ctx as BaseAudioContext).currentTime;
      if (!this.limiter.allow(idx, now)) {
        this.dropped++;
        return;
      }
      let spatial: unknown;
      let pitchOpt: unknown;
      let volOpt: unknown;
      if (opts !== null && typeof opts === 'object') {
        spatial = opts.spatial;
        pitchOpt = opts.pitch;
        volOpt = opts.volume;
      }
      readSpatial(spatial, this.spatial);
      const vol = typeof volOpt === 'number' && volOpt === 0 ? 0 : sanitizeMultiplier(volOpt, 1, 0.01, 2);
      const gain = this.spatial.gain * vol * (def.trim ?? 1);
      const pitch = sanitizeMultiplier(pitchOpt, 1, 0.25, 4);
      this.playRecipe(def.play, def.bus, this.spatial.pan, gain, pitch, true);
      if (def.cat === 'stinger') this.graph?.stingDuck(1.6);
    } catch {
      this.errors++;
    }
  }

  /** Shared one-shot path (public SFX + ambience events). */
  private playRecipe(recipe: OneShot, bus: BusId, pan: number, gain: number, pitch: number, vary: boolean): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph || !this.playable() || !(gain > 0.002)) return;
    const t = ctx.currentTime + START_OFFSET;
    const out = gainNode(ctx, 1);
    let pn: AudioNode | null = null;
    if (pan !== 0) {
      pn = stereo(ctx, pan);
      out.connect(pn).connect(graph.input[bus]);
    } else {
      out.connect(graph.input[bus]);
    }
    const s = this.scratch;
    s.ctx = ctx;
    s.out = out;
    s.t = t;
    s.pitch = vary ? pitch * (1 + this.rng.range(-0.05, 0.05)) : pitch;
    s.vol = vary ? gain * (1 + this.rng.range(-0.05, 0.05)) : gain;
    let dur = 0.5;
    try {
      dur = recipe(s);
    } catch {
      this.errors++;
    }
    const d = Number.isFinite(dur) ? Math.min(8, Math.max(0.02, dur)) : 0.5;
    this.sfxPool.add({ out, pan: pn }, t, t + d + 0.1);
  }

  private retire(out: GainNode, pan: AudioNode | null, cut: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (cut) {
      try {
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0, now + 0.025);
      } catch {
        /* ignore */
      }
      this.graveyard.push({ node: out, at: now + 0.06 });
      if (pan) this.graveyard.push({ node: pan, at: now + 0.06 });
    } else {
      try {
        out.disconnect();
        pan?.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  // ───────────────────────────── loops ─────────────────────────────

  loop(key: string, id: SfxId, on: boolean, spatial?: { pan: number; gain: number }): void {
    try {
      if (this.disposed || typeof key !== 'string' || key.length === 0 || key.length > 200) return;
      const spec = on ? specForSfx(id) : null;
      if (on && !spec) return;
      readSpatial(spatial, this.spatial);
      this.loops.set(key, spec, on === true, this.spatial.pan, this.spatial.gain);
    } catch {
      this.errors++;
    }
  }

  stopAllLoops(): void {
    try {
      this.loops.stopAll();
    } catch {
      this.errors++;
    }
  }

  // ───────────────────────────── voice ─────────────────────────────

  voice(seed: number, pitch: number, emotion: VoiceEmotion, durationMs: number, spatial?: { pan: number; gain: number }): void {
    try {
      if (!this.playable()) return;
      const ctx = this.ctx as BaseAudioContext;
      const graph = this.graph as MixGraph;
      readSpatial(spatial, this.spatial);
      if (!(this.spatial.gain > 0.002)) return;
      const plan = planVoice(seed, pitch, emotion, durationMs, this.utterance++);
      const group = toSeed(seed);
      this.speechPool.stopGroup(group);
      const t = ctx.currentTime + START_OFFSET;
      const out = gainNode(ctx, this.spatial.gain);
      let pn: AudioNode | null = null;
      if (this.spatial.pan !== 0) {
        pn = stereo(ctx, this.spatial.pan);
        out.connect(pn).connect(graph.input.voice);
      } else {
        out.connect(graph.input.voice);
      }
      const s = this.scratch;
      s.ctx = ctx;
      s.out = out;
      s.t = t;
      s.pitch = 1;
      s.vol = 1;
      const handle = renderVoice(s, plan, 1);
      this.speechPool.add({ handle, out, pan: pn }, t, handle.end + 0.05, group);
    } catch {
      this.errors++;
    }
  }

  // ───────────────────────────── music / world ─────────────────────────────

  music(mood: MusicMood | 'none'): void {
    try {
      const m: MusicMood | 'none' = mood === 'none' || (typeof mood === 'string' && Object.prototype.hasOwnProperty.call(MOODS, mood)) ? mood : 'none';
      this.desiredMood = m;
      if (this.player && this.ctx && this.unlocked) this.player.setMood(m, this.ctx.currentTime);
    } catch {
      this.errors++;
    }
  }

  setGameSpeed(speed: number): void {
    try {
      const s = typeof speed === 'number' && !Number.isNaN(speed) ? Math.min(4, Math.max(0, speed)) : 1;
      if (s === this.gameSpeed) return;
      this.gameSpeed = s;
      this.applySpeed();
    } catch {
      this.errors++;
    }
  }

  private applySpeed(): void {
    const s = this.gameSpeed;
    this.loops.setFootstepMute(s >= 3);
    this.ambience?.setThin(s >= 4);
    this.player?.setTempoScale(1 + 0.015 * (Math.min(4, Math.max(1, s)) - 1));
  }

  setAmbience(opts: { night: boolean; indoor: boolean; rain?: boolean; moon?: boolean }): void {
    try {
      const st = sanitizeAmbience(opts);
      if (!st) return;
      this.desiredAmbience = st;
      if (this.ambience && this.unlocked) this.ambience.set(st);
    } catch {
      this.errors++;
    }
  }

  // ───────────────────────────── debug ─────────────────────────────

  stats(): AudioStats {
    let state = this.disposed ? 'disposed' : 'none';
    let musicMood: MusicMood | 'none' = this.desiredMood;
    let musicSections = 0;
    let musicDropped = 0;
    try {
      if (this.ctx) state = stateOf(this.ctx);
      if (this.player) {
        musicMood = this.player.currentMood;
        musicSections = this.player.activeSections;
        musicDropped = this.player.droppedNotes;
      }
    } catch {
      /* diagnostics never throw */
    }
    return {
      state,
      unlocked: this.unlocked,
      muted: this.muted,
      ducked: this.ducked,
      sfxVoices: this.sfxPool.size,
      speechVoices: this.speechPool.size,
      loops: this.loops.activeCount,
      ambientLoops: this.ambLoops.activeCount,
      musicMood,
      musicSections,
      gameSpeed: this.gameSpeed,
      radioDuck: Math.round(this.radioDuck * 1000) / 1000,
      interruptions: this.interruptions,
      dropped: this.dropped,
      musicDropped,
      errors: this.errors,
    };
  }

  /** The underlying context (dev tools only). */
  get context(): BaseAudioContext | null {
    return this.ctx;
  }

  get mixGraph(): MixGraph | null {
    return this.graph;
  }
}
