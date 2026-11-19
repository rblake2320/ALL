/**
 * Event trail for feedback diagnostics (W-110 §1 "the last 50 UI/sim events"): a ring buffer of CLOSED-VOCABULARY
 * keys — dialog ids, view modes, KEYMAP action names, sim event types, fault-barrier locations — never text. Keys
 * are reduced to [A-Za-z0-9:._-] and ≤ 64 chars, so nothing the player typed can be recorded even by mistake; the
 * report builder still runs the PII scrubber over them.
 *
 * Also keeps a small FPS summary (one sample per second at most). Reads only: the simulation is never touched.
 *
 * Listeners (W-117): `listen(fn)` taps every push with its sanitised kind + value — the playtest session log
 * (src/feedback/sessionLog.ts) records screens, modes, speeds, dialogs, keys and errors from the SAME hook points and
 * closed vocabulary instead of adding a second set of call sites. A throwing listener never breaks the trail.
 */
import type { TrailEvent } from './schema';
import { EVENTS_MAX } from './schema';

/** Sim event types worth recording (the rest — sfx, fx, voice, funds ticks — would drown the trail). */
export const TRAIL_SIM_EVENTS: ReadonlySet<string> = new Set([
  'notify', 'choice', 'skillUp', 'promotion', 'milestone', 'gameOver', 'interactionFailed', 'lot',
  'objectAdded', 'objectRemoved', 'questStarted', 'questCompleted', 'agentSpawned', 'agentDespawned',
]);

const KEY_RE = /[^A-Za-z0-9:._-]/g;

export function trailKey(kind: string, what: unknown): string {
  const w = typeof what === 'string' || typeof what === 'number' ? String(what) : 'none';
  return `${kind}:${w}`.replace(KEY_RE, '_').slice(0, 64);
}

export class EventTrail {
  private readonly items: TrailEvent[] = [];
  private readonly start: number;
  private fpsMin = Number.POSITIVE_INFINITY;
  private fpsMax = 0;
  private fpsSum = 0;
  private fpsN = 0;
  private fpsLast = 0;
  private lastSampleAt = Number.NEGATIVE_INFINITY;
  private readonly listeners: ((kind: string, value: string) => void)[] = [];

  constructor(
    private readonly now: () => number,
    private readonly capacity = EVENTS_MAX,
  ) {
    this.start = now();
  }

  /** Tap every push (sanitised kind + value). Returns the unsubscribe function. */
  listen(fn: (kind: string, value: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  push(kind: string, what?: unknown): void {
    const k = trailKey(kind, what);
    if (this.listeners.length > 0) {
      const at = k.indexOf(':');
      const kk = at >= 0 ? k.slice(0, at) : k;
      const vv = at >= 0 ? k.slice(at + 1) : '';
      for (const fn of this.listeners) {
        try {
          fn(kk, vv);
        } catch {
          /* a listener never breaks the trail */
        }
      }
    }
    const t = Math.max(0, Math.round(this.now() - this.start));
    const last = this.items[this.items.length - 1];
    if (last && last.k === k) {
      last.n = Math.min(1e6, last.n + 1);
      last.t = t;
      return;
    }
    this.items.push({ t, k, n: 1 });
    while (this.items.length > this.capacity) this.items.shift();
  }

  /** Record the interesting sim events of one frame (type only). */
  simEvents(events: readonly { type?: unknown }[]): void {
    for (const e of events) {
      const type = e && typeof e === 'object' ? e.type : undefined;
      if (typeof type === 'string' && TRAIL_SIM_EVENTS.has(type)) this.push('sim', type);
    }
  }

  /** At most one FPS sample per second (call every frame). */
  sampleFps(fps: number): void {
    const now = this.now();
    if (now - this.lastSampleAt < 1000 || !Number.isFinite(fps) || fps <= 0) return;
    this.lastSampleAt = now;
    this.fpsLast = fps;
    this.fpsMin = Math.min(this.fpsMin, fps);
    this.fpsMax = Math.max(this.fpsMax, fps);
    this.fpsSum += fps;
    this.fpsN++;
  }

  fps(current: number): { now: number; min: number; avg: number; max: number; samples: number } {
    const r = (x: number) => Math.round(x * 10) / 10;
    const cur = Number.isFinite(current) && current > 0 ? current : this.fpsLast;
    if (this.fpsN === 0) return { now: r(Math.max(0, cur)), min: 0, avg: 0, max: 0, samples: 0 };
    return { now: r(cur), min: r(this.fpsMin), avg: r(this.fpsSum / this.fpsN), max: r(this.fpsMax), samples: this.fpsN };
  }

  list(): TrailEvent[] {
    return this.items.map((e) => ({ ...e }));
  }
}
