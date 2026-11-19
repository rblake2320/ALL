/**
 * Which SimContext does an `api` call belong to?
 *
 * SimSystem.api methods are invoked as ctx.sys(id).method(...) WITHOUT a ctx, and the same system objects are shared
 * by every simulation the engine creates (tests run several side by side; the game may keep a menu sim alive).
 * Every home hook records its ctx here (`instrument`), keyed by the WorldState it serves (the engine's
 * world-creation context and the live simulation share one state), and the tick hook records the tick it saw.
 * An api call then resolves to:
 *   1. the simulation that is mid-step (its state.tick advanced past the tick our tick hook last saw — i.e. it is
 *      currently running agents/behaviours of a new step), else
 *   2. the most recently used simulation (UI / renderer queries between steps).
 * Since the resolved contract decision #1 the engine appends the invoking ctx as the LAST api argument; `apiMethod`
 * uses it when present and only falls back to this registry for callers that bypass the engine wrapper.
 */
import type { InteractionBehavior, SimContext, SimSystem } from '../../contracts';

interface Entry {
  /** The world this entry tracks. Several contexts can share one state (e.g. the engine's world-creation context
   *  and the live simulation built on the same WorldState), so entries are keyed by state, not by ctx. */
  state: object;
  /** Most recently seen context for that state. */
  ctx: SimContext;
  seenTick: number;
  used: number;
}

const MAX_ENTRIES = 8;
const entries: Entry[] = [];
let counter = 0;

function tickOf(state: unknown): number {
  const t = (state as { tick?: unknown } | null)?.tick;
  return typeof t === 'number' && Number.isFinite(t) ? t : 0;
}

export function noteCtx(ctx: SimContext | null | undefined, fromTick = false): void {
  if (!ctx || typeof ctx !== 'object') return;
  const state = ctx.state as unknown;
  if (!state || typeof state !== 'object') return;
  let e = entries.find((x) => x.state === state);
  if (!e) {
    e = { state: state as object, ctx, seenTick: tickOf(state), used: 0 };
    entries.push(e);
    if (entries.length > MAX_ENTRIES) {
      let lru = 0;
      for (let i = 1; i < entries.length; i++) if (entries[i].used < entries[lru].used) lru = i;
      entries.splice(lru, 1);
    }
  }
  e.ctx = ctx;
  e.used = ++counter;
  if (fromTick) e.seenTick = tickOf(state);
}

export function currentCtx(): SimContext | null {
  let mid: Entry | null = null;
  let recent: Entry | null = null;
  for (const e of entries) {
    if (tickOf(e.state) > e.seenTick && (!mid || e.used > mid.used)) mid = e;
    if (!recent || e.used > recent.used) recent = e;
  }
  return (mid ?? recent)?.ctx ?? null;
}

/** Test helper: forget every recorded context. */
export function resetCtxRegistry(): void {
  entries.length = 0;
  counter = 0;
}

type AnyFn = (...args: any[]) => any;

function wrapCtxFirst<F extends AnyFn | undefined>(fn: F, fromTick = false): F {
  if (typeof fn !== 'function') return fn;
  const wrapped = function (this: unknown, ctx: SimContext, ...rest: unknown[]) {
    noteCtx(ctx, fromTick);
    return (fn as AnyFn).call(this, ctx, ...rest);
  };
  return wrapped as unknown as F;
}

function wrapRecord<T extends Record<string, AnyFn> | undefined>(rec: T): T {
  if (!rec) return rec;
  const out: Record<string, AnyFn> = {};
  for (const [k, fn] of Object.entries(rec)) out[k] = wrapCtxFirst(fn);
  return out as T;
}

const BEHAVIOR_HOOKS: (keyof InteractionBehavior)[] = [
  'begin',
  'startStage',
  'tick',
  'completeStage',
  'end',
  'available',
  'label',
  'choices',
  'adjustScore',
];

function wrapBehavior(b: InteractionBehavior): InteractionBehavior {
  const out: InteractionBehavior = {};
  for (const h of BEHAVIOR_HOOKS) {
    const fn = b[h];
    if (typeof fn === 'function') (out as Record<string, AnyFn>)[h] = wrapCtxFirst(fn as AnyFn);
  }
  return out;
}

/** Wrap every ctx-receiving hook of a system so it records its context first. api methods are left as-is. */
export function instrument(sys: SimSystem): SimSystem {
  const out: SimSystem = { ...sys };
  out.init = wrapCtxFirst(sys.init, true);
  out.tick = wrapCtxFirst(sys.tick, true);
  out.hour = wrapCtxFirst(sys.hour, true);
  out.dayStart = wrapCtxFirst(sys.dayStart, true);
  out.agentArrived = wrapCtxFirst(sys.agentArrived);
  out.agentLeft = wrapCtxFirst(sys.agentLeft);
  out.moodModifiers = wrapCtxFirst(sys.moodModifiers);
  out.autonomyCandidates = wrapCtxFirst(sys.autonomyCandidates);
  out.effects = wrapRecord(sys.effects);
  out.requirements = wrapRecord(sys.requirements);
  out.conditions = wrapRecord(sys.conditions);
  if (sys.behaviors) {
    const b: Record<string, InteractionBehavior> = {};
    for (const [k, v] of Object.entries(sys.behaviors)) b[k] = wrapBehavior(v);
    out.behaviors = b;
  }
  // Drop hooks the source system doesn't define (keep the object minimal for the engine's merge).
  for (const k of Object.keys(out) as (keyof SimSystem)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** Duck-type check for the trailing SimContext the engine appends to api calls. */
export function isSimContext(v: unknown): v is SimContext {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<SimContext>;
  return !!c.state && typeof c.state === 'object' && typeof c.sys === 'function' && typeof c.spend === 'function' && typeof c.changeNeed === 'function';
}

/** Run `fn` with the api call's simulation context, or return `fallback` when none is known. */
export function withCtx<T>(fallback: T, fn: (ctx: SimContext) => T, explicit?: SimContext | null): T {
  const ctx = explicit ?? currentCtx();
  if (!ctx) return fallback;
  try {
    return fn(ctx);
  } catch {
    return fallback;
  }
}

/**
 * Wrap an api implementation `(ctx, ...args)`. Contract (docs/CONTRACTS.md resolved decision #1): the engine's
 * ctx.sys(id) wrapper appends the invoking SimContext as the LAST argument, whatever the caller passed. When it is
 * present it is used and stripped; otherwise the registry fallback above resolves the context. Never throws.
 */
export function apiMethod<R>(fallback: R, fn: (ctx: SimContext, ...args: any[]) => R): (...args: any[]) => R {
  return (...args: any[]) => {
    let explicit: SimContext | null = null;
    if (args.length > 0 && isSimContext(args[args.length - 1])) explicit = args.pop() as SimContext;
    if (explicit) noteCtx(explicit);
    return withCtx(fallback, (ctx) => fn(ctx, ...args), explicit);
  };
}
