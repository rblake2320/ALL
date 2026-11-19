/**
 * Save orchestration helpers: slot naming, SaveMeta construction, thumbnails, Windows-safe export filenames and a
 * global write queue so the SaveManager never sees two concurrent writes from this controller (no 'busy').
 * Nothing here may wait forever: queue jobs have a watchdog and thumbnail encoding has a deadline, so one hung
 * storage call (or image decode) can never block every later save for the rest of the session.
 */
import type { SaveMeta, SaveResult } from '../persistence/contracts';
import type { SimulationAPI } from '../sim/contracts';
import type { WorldState } from '../sim/types';
import type { RendererAPI } from '../render/contracts';
import type { GameEnv, TimerHandle } from './env';

export const AUTOSAVE_PREFIX = 'auto-';
export const MANUAL_PREFIX = 'save-';
export const EMERGENCY_SLOT = 'emergency';
export const THUMB_W = 256;
export const THUMB_H = 144;
/** SaveMeta.thumbnail limit (persistence contract). Data URLs are ASCII, so chars = bytes. */
export const THUMB_MAX_BYTES = 64 * 1024;
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;
/**
 * A save job (serialize + thumbnail + SaveManager.save) that has not settled after this long is abandoned: its caller
 * gets a failure and the queue moves on. Longer than PLATFORM's ≤ 30 s cross-window lock wait for manual saves plus
 * a slow write, so a merely slow disk is never cut off. (PLATFORM still serialises the actual writes itself.)
 */
export const SAVE_JOB_TIMEOUT_MS = 45_000;
/** Budget for snapshot re-encoding; past it the save goes ahead without a thumbnail. */
export const THUMB_TIMEOUT_MS = 2_500;
/** Extensions an export keeps; anything else gets the PLATFORM format's extension. */
export const SAVE_FILE_EXTENSIONS = ['.alsave', '.json'] as const;
export const DEFAULT_SAVE_EXTENSION = '.alsave';

export function seedTag(seed: unknown): string {
  const n = typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : 0;
  return n.toString(16).padStart(8, '0');
}

export function autosaveSlotFor(world: Pick<WorldState, 'seed'>): string {
  return `${AUTOSAVE_PREFIX}${seedTag(world.seed)}`;
}

export function isAutoOrEmergency(slotId: string | null | undefined): boolean {
  if (typeof slotId !== 'string') return false;
  const id = slotId.toLowerCase();
  return id.startsWith(AUTOSAVE_PREFIX) || id === EMERGENCY_SLOT;
}

/** Slots only the controller writes (autosaves, the crash slot, legacy "autosave-N"): never a manual-save target. */
export function isReservedSlot(slotId: string | null | undefined): boolean {
  return isAutoOrEmergency(slotId) || (typeof slotId === 'string' && /^autosave(-\d{1,2})?$/i.test(slotId));
}

/** Manual "Save" target: the slot the game was loaded from, unless that was an autosave / emergency slot. */
export function manualSlotFor(world: Pick<WorldState, 'seed'>, loadedFrom: string | null): string {
  if (loadedFrom && !isReservedSlot(loadedFrom) && isValidSlotId(loadedFrom)) return loadedFrom.toLowerCase();
  return `${MANUAL_PREFIX}${seedTag(world.seed)}`;
}

/**
 * Slot ids we generate or accept from the UI. Mirrors PLATFORM's canonical rule (1–40 of [a-z0-9_-], case-
 * insensitive, never a Windows device name) so a bad id is rejected here with a clear message.
 */
export function isValidSlotId(slotId: unknown): slotId is string {
  return typeof slotId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(slotId) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(slotId);
}

/** Same slot? PLATFORM canonicalises ids to lowercase (desktop file systems are case-insensitive). */
export function sameSlot(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function householdName(sim: SimulationAPI): string {
  const n = sim.state?.household?.name;
  return typeof n === 'string' && n.trim() ? n.trim() : 'Household';
}

export function defaultSaveName(sim: SimulationAPI, kind: 'manual' | 'auto' | 'emergency'): string {
  const name = householdName(sim);
  if (kind === 'auto') return `${name} (Autosave)`;
  if (kind === 'emergency') return `${name} (Emergency save)`;
  let day = 1;
  try {
    day = sim.time().day;
  } catch {
    /* keep 1 */
  }
  return `${name} — Day ${day}`;
}

export function buildSaveMeta(sim: SimulationAPI, thumbnail: string | null): SaveMeta {
  let day = 1;
  let timeLabel = '';
  try {
    const t = sim.time();
    day = t.day;
    timeLabel = t.label;
  } catch {
    /* keep defaults */
  }
  let lotValue = 0;
  try {
    const v = sim.lotValue();
    lotValue = Number.isFinite(v) ? Math.round(v) : 0;
  } catch {
    /* keep 0 */
  }
  const st = sim.state;
  const memberNames: string[] = [];
  for (const id of Array.isArray(st?.household?.memberIds) ? st.household.memberIds : []) {
    const a = st.agents?.[id];
    if (a) memberNames.push(`${a.firstName} ${a.lastName}`.trim());
  }
  const funds = st?.household?.funds;
  return {
    householdName: householdName(sim),
    memberNames,
    day: Number.isFinite(day) ? day : 1,
    timeLabel,
    funds: Number.isFinite(funds) ? Math.round(funds) : 0,
    lotValue,
    thumbnail: thumbnail && thumbnail.length <= THUMB_MAX_BYTES ? thumbnail : null,
  };
}

type ThumbEnv = Pick<GameEnv, 'reencodeJpeg'> & Partial<Pick<GameEnv, 'setTimeout' | 'clearTimeout' | 'now'>>;

/**
 * renderer.snapshot → ≤ 64 KB data URL (JPEG re-encode when the PNG is too big) or null. Never throws. The snapshot
 * itself is taken synchronously; re-encoding is bounded by THUMB_TIMEOUT_MS in total when the env has timers.
 */
export async function captureThumbnail(renderer: Pick<RendererAPI, 'snapshot'>, env: ThumbEnv): Promise<string | null> {
  let png: string;
  try {
    png = renderer.snapshot(THUMB_W, THUMB_H);
  } catch {
    return null;
  }
  if (typeof png !== 'string' || !png.startsWith('data:image/')) return null;
  if (png.length <= THUMB_MAX_BYTES) return png;
  const timers = env.setTimeout && env.clearTimeout ? { setTimeout: env.setTimeout.bind(env), clearTimeout: env.clearTimeout.bind(env) } : null;
  const clock = env.now ? () => env.now!() : null;
  const deadline = clock ? clock() + THUMB_TIMEOUT_MS : Number.POSITIVE_INFINITY;
  const TIMED_OUT = 'timeout';
  for (const q of [0.8, 0.6, 0.4]) {
    try {
      const encoding = Promise.resolve(env.reencodeJpeg(png, q));
      const left = clock ? deadline - clock() : THUMB_TIMEOUT_MS;
      if (left <= 0) return null;
      const jpg = timers ? await withTimeout<string | null>(encoding, left, timers, () => TIMED_OUT) : await encoding;
      if (jpg === TIMED_OUT) return null; // hung decode/encode: save without a thumbnail
      if (typeof jpg === 'string' && jpg.startsWith('data:image/') && jpg.length <= THUMB_MAX_BYTES) return jpg;
      if (jpg === null) return null; // unsupported: don't retry
    } catch {
      return null;
    }
  }
  return null;
}

/** Windows device names (also with superscript digits and the console aliases), matched on the stem. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9\u00B9\u00B2\u00B3]|lpt[0-9\u00B9\u00B2\u00B3]|conin\$|conout\$)$/i;

/**
 * Windows-safe download filename: strips <>:"/\|?* and control chars, trailing dots/spaces, avoids reserved device
 * names (CON, NUL, COM1, ...), bounds length. A known save extension (.alsave — PLATFORM's export format — or
 * .json) is kept; anything else gets `defaultExt`, so "x.alsave" never becomes "x.alsave.json".
 */
export function sanitizeFilename(name: unknown, defaultExt: string = DEFAULT_SAVE_EXTENSION, fallback = 'afterlife-lease-save'): string {
  let s = typeof name === 'string' ? name : '';
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim();
  let ext = defaultExt;
  const lower = s.toLowerCase();
  for (const e of SAVE_FILE_EXTENSIONS) {
    if (lower.endsWith(e)) {
      ext = e;
      s = s.slice(0, -e.length);
      break;
    }
  }
  s = s.replace(/[. ]+$/g, '').replace(/^[. ]+/g, '');
  if (s.length === 0) s = fallback;
  const stem = s.split('.')[0].trim();
  if (WINDOWS_RESERVED.test(stem)) s = `_${s}`;
  if (s.length > 120) s = s.slice(0, 120).replace(/[. ]+$/g, '');
  return `${s}${ext}`;
}

/** MIME type for a download: JSON for .json, otherwise opaque bytes (browsers then never append ".json"). */
export function exportMimeType(filename: string): string {
  return filename.toLowerCase().endsWith('.json') ? 'application/json' : 'application/octet-stream';
}

/**
 * Serializes async jobs (one at a time, FIFO). `busy` reflects queued + running jobs.
 * With timers, a job given an `onTimeout` that has not settled after `timeoutMs` is abandoned: its caller receives
 * `onTimeout()` and the next job starts (the abandoned promise keeps running; its late result is ignored).
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly timers: Pick<GameEnv, 'setTimeout' | 'clearTimeout'> | null = null,
    private readonly timeoutMs: number = SAVE_JOB_TIMEOUT_MS,
  ) {}

  get busy(): boolean {
    return this.pending > 0;
  }

  get size(): number {
    return this.pending;
  }

  /**
   * When the queue is idle the job starts SYNCHRONOUSLY (its code up to the first await runs inside the caller),
   * so a save snapshots the world at the moment it was requested; otherwise it starts after the previous job.
   */
  run<T>(job: () => Promise<T>, onTimeout?: () => T): Promise<T> {
    this.pending++;
    const start = (): Promise<T> => {
      let p: Promise<T>;
      try {
        p = Promise.resolve(job());
      } catch (e) {
        p = Promise.reject(e);
      }
      return this.timers && onTimeout ? withTimeout(p, this.timeoutMs, this.timers, onTimeout, true) : p;
    };
    const p = this.pending === 1 ? start() : this.tail.then(start, start);
    this.tail = p.then(
      () => undefined,
      () => undefined,
    );
    return p.finally(() => {
      this.pending--;
    });
  }
}

export function saveFailure(error: string, code: Extract<SaveResult, { ok: false }>['code'] = 'io'): SaveResult {
  return { ok: false, error, code };
}

/**
 * Bound a wait: resolves with `p`'s value, or with `onTimeout()` after `ms` (also when `p` rejects, unless
 * `propagateRejection` — then the rejection passes through). Never leaves its timer behind.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  env: Pick<GameEnv, 'setTimeout' | 'clearTimeout'>,
  onTimeout: () => T,
  propagateRejection = false,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const h = env.setTimeout(() => {
      if (done) return;
      done = true;
      try {
        resolve(onTimeout());
      } catch (e) {
        reject(e);
      }
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        env.clearTimeout(h);
        resolve(v);
      },
      (e: unknown) => {
        if (done) return;
        done = true;
        env.clearTimeout(h);
        if (propagateRejection) reject(e);
        else resolve(onTimeout());
      },
    );
  });
}

/** Length of one slice of `withResponsiveTimeout` (ms). */
export const RESPONSIVE_SLICE_MS = 100;

/**
 * Like withTimeout, but the budget is RESPONSIVE time: `ms` is spent in slices of RESPONSIVE_SLICE_MS, each a fresh
 * timer armed only when the previous one has fired. A main thread that is blocked for many seconds (asset decoding,
 * shader compiles, a software-rendered frame: 4–40 s measured in headless Chromium) therefore uses up ONE slice, not
 * the whole budget — and when it comes back, an answer that arrived during the stall (a Web Locks grant, a storage
 * read) is delivered before the remaining slices run out.
 *
 * Use it wherever a timeout stands for "the OTHER side did not answer" (W-134: a wall-clock 2 s timeout on the
 * journal lock read our own stalled main thread as "another window is playing this world" and dropped the crash
 * recovery). A plain wall-clock withTimeout stays right for "the player must not wait longer than this".
 */
export function withResponsiveTimeout<T>(
  p: Promise<T>,
  ms: number,
  env: Pick<GameEnv, 'setTimeout' | 'clearTimeout'>,
  onTimeout: () => T,
  sliceMs: number = RESPONSIVE_SLICE_MS,
): Promise<T> {
  const slice = Number.isFinite(sliceMs) && sliceMs >= 1 ? sliceMs : RESPONSIVE_SLICE_MS;
  let left = Math.max(1, Math.ceil((Number.isFinite(ms) && ms > 0 ? ms : 0) / slice));
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let h: TimerHandle | null = null;
    const expire = (): void => {
      if (done) return;
      done = true;
      try {
        resolve(onTimeout());
      } catch (e) {
        reject(e);
      }
    };
    const arm = (): void => {
      h = env.setTimeout(() => {
        if (done) return;
        if (--left <= 0) expire();
        else arm();
      }, slice);
    };
    arm();
    const settle = (fn: () => void): void => {
      if (done) return;
      done = true;
      if (h !== null) env.clearTimeout(h);
      fn();
    };
    p.then(
      (v) => settle(() => resolve(v)),
      () =>
        settle(() => {
          try {
            resolve(onTimeout());
          } catch (e) {
            reject(e);
          }
        }),
    );
  });
}
