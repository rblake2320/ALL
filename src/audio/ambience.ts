/**
 * Ambient bed controller: day (wind + distant crows), night (crickets + soft wind + owls + distant groan
 * chorus), optional rain (+ thunder), and on full-moon nights an extra shimmer bed with distant howls.
 * Beds crossfade over ~3 s through the LoopManager; one-off calls are scheduled on AudioContext time.
 * Indoor = lowpass muffling; ultra speed thins the bed.
 */
import type { LoopManager, LoopSpec } from './loopManager';
import type { Rng } from './prng';
import { AMBIENT_EXTRAS, SFX_TABLE } from './sfx/table';
import type { OneShot } from './synth/types';

export interface AmbienceState {
  night: boolean;
  indoor: boolean;
  rain: boolean;
  /** Full-moon night layer (only audible at night). */
  moon: boolean;
}

export interface AmbienceHost {
  now(): number;
  rng: Rng;
  loops: LoopManager;
  /** Play an ambient one-shot with a pan/gain (counts against polyphony). */
  oneShot(recipe: OneShot, pan: number, gain: number): void;
  setIndoor(indoor: boolean, thin: number): void;
}

const BED_FADE = 3;
const spec = (factory: LoopSpec['factory'], trim: number): LoopSpec => ({ factory, bus: 'ambient', trim, fadeIn: BED_FADE, fadeOut: BED_FADE });
const DAY_WIND = spec(AMBIENT_EXTRAS.windLoop, 0.5);
const NIGHT_WIND = spec(AMBIENT_EXTRAS.windLoop, 0.2);
const CRICKETS = spec(AMBIENT_EXTRAS.cricketsLoop, 0.6);
const RAIN = spec(AMBIENT_EXTRAS.rainLoop, 0.65);
const MOON = spec(AMBIENT_EXTRAS.moonLoop, 0.7);
const BED_KEYS = ['~amb:day', '~amb:nightwind', '~amb:crickets', '~amb:rain', '~amb:moon'] as const;

interface EventSlot {
  recipe: OneShot;
  every: [number, number];
  gain: [number, number];
  when: (s: AmbienceState) => boolean;
  next: number;
}

export function sanitizeAmbience(opts: unknown): AmbienceState | null {
  if (opts === null || typeof opts !== 'object') return null;
  try {
    const o = opts as Record<string, unknown>;
    return { night: o.night === true, indoor: o.indoor === true, rain: o.rain === true, moon: o.moon === true };
  } catch {
    return null;
  }
}

export class Ambience {
  private state: AmbienceState | null = null;
  private thin = false;
  private readonly events: EventSlot[];

  constructor(private readonly host: AmbienceHost) {
    this.events = [
      { recipe: AMBIENT_EXTRAS.crow, every: [7, 16], gain: [0.25, 0.6], when: (s) => !s.night && !s.rain, next: Infinity },
      { recipe: SFX_TABLE.owl.play, every: [12, 28], gain: [0.3, 0.6], when: (s) => s.night, next: Infinity },
      { recipe: SFX_TABLE.groanAmbient.play, every: [25, 55], gain: [0.25, 0.45], when: (s) => s.night, next: Infinity },
      { recipe: SFX_TABLE.thunder.play, every: [25, 70], gain: [0.5, 0.9], when: (s) => s.rain, next: Infinity },
      { recipe: AMBIENT_EXTRAS.howl, every: [24, 60], gain: [0.35, 0.65], when: (s) => s.night && s.moon, next: Infinity },
    ];
  }

  get current(): AmbienceState | null {
    return this.state;
  }

  set(next: AmbienceState): void {
    const prev = this.state;
    this.state = next;
    const L = this.host.loops;
    L.set('~amb:day', DAY_WIND, !next.night, 0, 1);
    L.set('~amb:nightwind', NIGHT_WIND, next.night, 0, 1);
    L.set('~amb:crickets', CRICKETS, next.night, 0, 1);
    L.set('~amb:rain', RAIN, next.rain, 0, 1);
    L.set('~amb:moon', MOON, next.night && next.moon, 0, 1);
    this.host.setIndoor(next.indoor, this.thin ? 0.7 : 1);
    const now = this.host.now();
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      const active = ev.when(next);
      const was = prev ? ev.when(prev) : false;
      if (active && (!was || !Number.isFinite(ev.next))) ev.next = now + this.gap(ev) * 0.4;
      if (!active) ev.next = Infinity;
    }
  }

  setThin(thin: boolean): void {
    if (thin === this.thin) return;
    this.thin = thin;
    if (this.state) this.host.setIndoor(this.state.indoor, thin ? 0.7 : 1);
  }

  pump(now: number): void {
    const s = this.state;
    if (!s || !Number.isFinite(now)) return;
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      // a clock that jumped backwards (fresh context) must not leave calls parked far in the future
      if (Number.isFinite(ev.next) && ev.next - now > ev.every[1] * 1.8 + 1) ev.next = now + this.gap(ev);
      if (now < ev.next) continue;
      if (now - ev.next < 2 && ev.when(s)) {
        const r = this.host.rng;
        this.host.oneShot(ev.recipe, r.range(-0.8, 0.8), r.range(ev.gain[0], ev.gain[1]) * (s.indoor ? 0.8 : 1));
      }
      ev.next = now + this.gap(ev);
    }
  }

  stop(): void {
    const L = this.host.loops;
    for (const k of BED_KEYS) L.set(k, null, false, 0, 0);
    for (const ev of this.events) ev.next = Infinity;
    this.state = null;
  }

  private gap(ev: EventSlot): number {
    return this.host.rng.range(ev.every[0], ev.every[1]) * (this.thin ? 1.8 : 1);
  }
}
