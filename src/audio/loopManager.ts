/**
 * Keyed looping sounds (showers, TVs, fires, ambience beds). The desired state is kept even without a
 * context (before unlock) and materialised later. Re-calling with on=true only updates spatial (no
 * allocation, change-thresholded). Starts/stops crossfade; a capped number of loops play at once.
 */
import type { SfxId } from '../shared/audioIds';
import type { Rng } from './prng';
import { SFX_TABLE, loopFactoryFor, type BusId } from './sfx/table';
import { fin, gainNode, glideParam, stereo } from './synth/core';
import type { LoopFactory, LoopVoice, Sx } from './synth/types';

/**
 * Concurrently playing loops per manager. Measured in Chromium (engine-in-the-loop offline renders) a loop costs
 * ~2-4 % of a core, so 16 keeps a crowded party well inside budget; quieter (farther) loops wait as "virtual
 * voices" and come back by eviction when they get louder or a slot frees up.
 */
export const MAX_LOOPS = 16;
const FADE_IN = 0.25;
const FADE_OUT = 0.35;
/** A waiting loop must be this much louder than the quietest playing one to evict it (no flapping at the cap). */
export const EVICT_MARGIN = 1.25;

export interface LoopSpec {
  factory: LoopFactory;
  bus: BusId;
  trim: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Tag used by footstep muting. */
  id?: SfxId;
}

interface Desired {
  spec: LoopSpec;
  pan: number;
  gain: number;
}

interface Entry {
  key: string;
  spec: LoopSpec;
  out: GainNode;
  panNode: AudioNode;
  voice: LoopVoice | null;
  pan: number;
  gain: number;
  applied: number;
  appliedPan: number;
  scheduledTo: number;
}

interface Dying {
  node: AudioNode;
  at: number;
}

export interface LoopHost {
  ctx: BaseAudioContext;
  input(bus: BusId): AudioNode;
  rng: Rng;
}

const specCache = new Map<SfxId, LoopSpec>();

export function specForSfx(id: SfxId): LoopSpec | null {
  const hit = specCache.get(id);
  if (hit) return hit;
  const def = SFX_TABLE[id];
  if (!def) return null;
  const spec: LoopSpec = { factory: loopFactoryFor(def), bus: def.bus, trim: def.trim ?? 1, id };
  specCache.set(id, spec);
  return spec;
}

export class LoopManager {
  private readonly desired = new Map<string, Desired>();
  private readonly active = new Map<string, Entry>();
  private readonly list: Entry[] = [];
  private readonly dying: Dying[] = [];
  private host: LoopHost | null = null;
  private footstepMute = false;

  attach(host: LoopHost): void {
    this.host = host;
    this.materialize();
  }

  get activeCount(): number {
    return this.list.length;
  }

  get desiredCount(): number {
    return this.desired.size;
  }

  has(key: string): boolean {
    return this.active.has(key);
  }

  /** Public loop(key, id, on, spatial) semantics for any spec. */
  set(key: string, spec: LoopSpec | null, on: boolean, pan: number, gain: number): void {
    if (!on) {
      this.desired.delete(key);
      this.stopKey(key, undefined);
      return;
    }
    if (!spec) return;
    const d = this.desired.get(key);
    if (d) {
      if (d.spec !== spec) {
        // same key, different sound: crossfade
        d.spec = spec;
        d.pan = pan;
        d.gain = gain;
        this.stopKey(key, undefined, true);
        this.start(key, d);
        return;
      }
      d.pan = pan;
      d.gain = gain;
      const e = this.active.get(key);
      if (e) this.updateSpatial(e, pan, gain);
      else this.start(key, d);
      return;
    }
    const nd: Desired = { spec, pan, gain };
    this.desired.set(key, nd);
    this.start(key, nd);
  }

  stopAll(fade?: number): void {
    this.desired.clear();
    for (let i = this.list.length - 1; i >= 0; i--) this.stopKey(this.list[i].key, fade);
  }

  setFootstepMute(m: boolean): void {
    if (this.footstepMute === m) return;
    this.footstepMute = m;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.spec.id === 'footstep') this.applyGain(e, true);
    }
  }

  /** Loudest caller gain (0..1) among playing loops of `id`; 0 if none (allocation-free). */
  maxGainOf(id: SfxId): number {
    let m = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.spec.id === id && e.gain > m) m = e.gain;
    }
    return m;
  }

  /** Schedule event-driven loops up to `horizon`; retire faded loops; fill free slots. */
  pump(now: number, horizon: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.voice?.schedule && horizon > e.scheduledTo) {
        try {
          e.voice.schedule(Math.max(e.scheduledTo, now - 0.02), horizon);
        } catch {
          /* a broken loop recipe must not stop the others */
        }
        e.scheduledTo = horizon;
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i].at <= now) {
        try {
          this.dying[i].node.disconnect();
        } catch {
          /* ignore */
        }
        this.dying.splice(i, 1);
      }
    }
    if (this.list.length < MAX_LOOPS && this.desired.size > this.list.length) this.materialize();
  }

  dispose(): void {
    this.detach();
    this.desired.clear();
  }

  /** Drop every node of the current context but keep the desired loops (re-attached to a new context later). */
  detach(): void {
    for (const e of this.list) {
      try {
        this.kill(e, 0);
      } catch {
        /* the old context may be gone */
      }
    }
    this.list.length = 0;
    this.active.clear();
    for (const d of this.dying) {
      try {
        d.node.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.dying.length = 0;
    this.host = null;
  }

  private materialize(): void {
    if (!this.host) return;
    for (const [key, d] of this.desired) {
      if (this.list.length >= MAX_LOOPS) break;
      if (!this.active.has(key)) this.start(key, d);
    }
  }

  private start(key: string, d: Desired): void {
    const h = this.host;
    if (!h) return;
    if (this.list.length >= MAX_LOOPS) {
      // evict the quietest loop if the newcomer is clearly louder; otherwise wait for a free slot
      let q: Entry | null = null;
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i];
        if (!q || e.gain < q.gain) q = e;
      }
      if (!q || q.gain * EVICT_MARGIN >= d.gain) return;
      this.stopKey(q.key, 0.15, true);
    }
    const ctx = h.ctx;
    try {
      const out = gainNode(ctx, 0);
      const panNode = stereo(ctx, d.pan);
      out.connect(panNode).connect(h.input(d.spec.bus));
      const now = ctx.currentTime;
      const sx: Sx = { ctx, out, t: now + 0.02, rng: h.rng, pitch: 1, vol: 1 };
      let voice: LoopVoice | null = null;
      try {
        voice = d.spec.factory(sx);
      } catch {
        voice = null;
      }
      const e: Entry = { key, spec: d.spec, out, panNode, voice, pan: d.pan, gain: d.gain, applied: -1, appliedPan: d.pan, scheduledTo: now + 0.02 };
      this.active.set(key, e);
      this.list.push(e);
      this.applyGain(e, true, d.spec.fadeIn ?? FADE_IN);
    } catch {
      /* creation failed: stay desired, retry on next pump */
    }
  }

  private targetGain(e: Entry): number {
    if (this.footstepMute && e.spec.id === 'footstep') return 0;
    return e.gain * e.spec.trim;
  }

  private applyGain(e: Entry, force: boolean, fade = 0.06): void {
    const h = this.host;
    if (!h) return;
    const g = this.targetGain(e);
    if (!force && Math.abs(g - e.applied) < 0.01) return;
    e.applied = g;
    glideParam(h.ctx, e.out.gain, g, fade / 3);
  }

  private updateSpatial(e: Entry, pan: number, gain: number): void {
    e.gain = gain;
    e.pan = pan;
    this.applyGain(e, false);
    if (Math.abs(pan - e.appliedPan) >= 0.01 && this.host) {
      e.appliedPan = pan;
      const p = (e.panNode as StereoPannerNode).pan;
      if (p) glideParam(this.host.ctx, p, pan, 0.03);
    }
  }

  /** Fade out and forget an active key. `keepDesired` keeps it eligible to come back (eviction). */
  private stopKey(key: string, fade: number | undefined, keepDesired = false): void {
    const e = this.active.get(key);
    if (!e) return;
    this.active.delete(key);
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    if (!keepDesired) this.desired.delete(key);
    this.kill(e, fin(fade ?? e.spec.fadeOut ?? FADE_OUT, FADE_OUT));
  }

  private kill(e: Entry, fade: number): void {
    const h = this.host;
    if (!h) return;
    const now = h.ctx.currentTime;
    const f = Math.max(0.01, fade);
    // time constant f/6: -52 dB by the time sources stop, so the cut is inaudible
    glideParam(h.ctx, e.out.gain, 0, f / 6);
    try {
      e.voice?.stop(now + f + 0.1);
    } catch {
      /* ignore */
    }
    this.dying.push({ node: e.panNode, at: now + f + 0.6 });
    this.dying.push({ node: e.out, at: now + f + 0.6 });
  }
}
