/**
 * CLOSED-FORM CATCH-UP of a dormant region (W-025 S4; docs/DESIGN_WORLD_LEVELS.md §1.8, AC-5).
 *
 * A dormant region is a `RegionSnapshot` (lot + objects + data). When it becomes active again the ticks it missed are
 * applied in CLOSED FORM, never replayed tick by tick:
 *
 *   catchUpRecord(record, now, env)   advances `record.snapshot` from `record.caughtUpTick` to `now` and moves the
 *                                     watermark. Refused (false, nothing changed) for a NaN / negative / non-integer
 *                                     `now`, a damaged watermark, or `now` before the watermark.
 *
 * Properties (tested in tests/unit/world/catchup.test.ts):
 *  - IDEMPOTENT: a second call with the same `now` sees `caughtUpTick === now` and changes nothing;
 *  - SPLIT-INVARIANT: (a → b) then (b → c) is byte-identical to (a → c). Every rule is a monotone SEMIGROUP ACTION of
 *    the elapsed ticks, evaluated in exact arithmetic: values are first quantised to a dyadic grid (QUANT = 1/1024,
 *    exactly representable), and every increment is a whole number of dyadic steps, so float addition is exact and
 *    associative; clamps are `min` / `max` of monotone sums, which compose. Schedules count absolute boundaries
 *    (`floor(now / H) − floor(from / H)`), never "how long this call covers";
 *  - DETERMINISTIC from (snapshot, elapsed, seed): no `WorldState.rng`, no clock, no Map/Set iteration order (object
 *    ids are walked sorted). The region seed (`hash32(worldSeed, regionHash)`) is passed to rules for future random
 *    rules, which must key randomness on absolute schedule slots (never on the call's from / to), to stay split-invariant;
 *  - ZERO ELAPSED is a no-op byte for byte (no quantisation either).
 *
 * Rules (RULES below, applied in this order). The live per-tick systems are the reference; catch-up approximates them
 * with the region assumed powered and unattended:
 *  - `fridge`: leftovers age at the fridge's `spoilMult` (quantised to 1/64) per game minute (live: leftovers.ts);
 *    the totals `leftoverServings` / `spoiledServings` are recomputed;
 *  - `mealsOut`: meals / pizza not in a hand age 1:1 and are flagged `spoiled` at 24 h (live: leftovers.ts);
 *  - `dirt`: a surface under a dish or a spoiled meal gets +SURFACE_DIRT_Q per game hour boundary crossed while the
 *    item is dirty and still there, <= 1 (live: mess.ts, 0.05 per hour; the catch-up step is the dyadic 51/1024);
 *  - `itemDespawn`: on streets and paths a loose meal / pizza / dish left 48 h is gone (§1.8);
 *  - `garden` (hook for W-109 gardens; no shipped object uses it yet): an object with numeric data `growStartTick`,
 *    `growTicksPerStage` (> 0) and `growMaxStage` gets `growStage = min(max, floor((now − start) / perStage))`;
 *  - `residents`: needs of ABSENT RESIDENTS (non-household agents standing in the region when it froze, kept in
 *    `snapshot.data.residents`) drift toward RESIDENT_REST_LEVEL by RESIDENT_DRIFT_PER_HOUR per game-hour boundary crossed (an
 *    unattended townie "living its life"); preservation is not touched. TODO(S6): the townie schedules own this and
 *    place the townie at its scheduled stop (`townieSchedule`, a no-op seam until S6);
 *  - bills: not a region rule. Bills are a home system and the home is always active (§1.8 "the home never needs
 *    catch-up"); owned extra lots (S13) bill through the home.
 */
import type { NeedId, ObjectState } from '../types';
import type { RegionKind, RegionRecord, RegionSnapshot } from '../../shared/world';

/** Dyadic quantum: every catch-up value lives on this grid (exact in binary floating point). */
export const CATCH_UP_QUANT = 1 / 1024;
/** Mirrors of the live constants (tests/unit/world/catchup.test.ts asserts they match their sources). */
export const LEFTOVER_SPOIL_MIN = 48 * 60;
export const MEAL_OUT_SPOIL_MIN = 24 * 60;
export const SURFACE_DIRT_PER_ITEM_HOUR = 0.05;
/** Catch-up dirt step per hour: 0.05 on the dyadic grid (51/1024 ≈ 0.0498). */
export const SURFACE_DIRT_Q = Math.round(SURFACE_DIRT_PER_ITEM_HOUR / CATCH_UP_QUANT) * CATCH_UP_QUANT;
/** Loose items on streets / paths vanish after this long (§1.8 "an item despawns at foundTick + 48 h"). */
export const STREET_ITEM_DESPAWN_MIN = 48 * 60;
/** Absent residents' needs drift toward this level … */
export const RESIDENT_REST_LEVEL = 60;
/** … at this many points per game hour (dyadic). */
export const RESIDENT_DRIFT_PER_HOUR = 2;
export const RESIDENT_NEEDS: readonly NeedId[] = ['hunger', 'energy', 'social', 'fun', 'hygiene'];

const TICKS_PER_MIN = 4;
const TICKS_PER_HOUR = 240;
const ITEM_MEAL = 'item_meal';
const ITEM_PIZZA = 'item_pizza';
const ITEM_DISH = 'item_dish';

export interface CatchUpEnv {
  kind: RegionKind;
  /** Region seed (hash32(world seed, region hash)); unused by the v1 rules (see the header). */
  seed: number;
  /** The object def's `params.spoilMult` (1 when absent). */
  spoilMult(defId: string): number;
}

export interface CatchUpWindow {
  /** Watermark the snapshot is caught up to. */
  from: number;
  now: number;
  /** Elapsed ticks (now − from > 0). */
  ticks: number;
}

export interface CatchUpRule {
  id: string;
  apply(snap: RegionSnapshot, w: CatchUpWindow, env: CatchUpEnv): void;
}

function q(v: number): number {
  return Math.round(v / CATCH_UP_QUANT) * CATCH_UP_QUANT;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function objectsOf(snap: RegionSnapshot): Record<string, ObjectState> {
  const o = snap.objects;
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, ObjectState>) : {};
}

function sortedObjects(snap: RegionSnapshot): ObjectState[] {
  const objs = objectsOf(snap);
  return Object.keys(objs)
    .sort()
    .map((k) => objs[k])
    .filter((o): o is ObjectState => !!o && typeof o === 'object' && typeof o.defId === 'string' && !!o.placement);
}

function dataOf(o: ObjectState): Record<string, string | number | boolean | null> {
  if (!o.data || typeof o.data !== 'object') o.data = {};
  return o.data;
}

const fridgeRule: CatchUpRule = {
  id: 'fridge',
  apply(snap, w, env) {
    for (const o of sortedObjects(snap)) {
      const d = dataOf(o);
      const raw = d.leftovers;
      if (typeof raw !== 'string' || raw.length === 0) continue;
      let list: unknown;
      try {
        list = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!Array.isArray(list)) continue;
      const m = env.spoilMult(o.defId);
      const rate = Math.round((isNum(m) && m >= 0 ? m : 1) * 64) / 64;
      const add = (w.ticks * rate) / TICKS_PER_MIN;
      const out: { s: number; q: number; r: string; a: number }[] = [];
      for (const e of list) {
        if (!e || typeof e !== 'object') continue;
        const x = e as Record<string, unknown>;
        const s = isNum(x.s) ? Math.floor(x.s) : 0;
        if (s < 1) continue;
        out.push({ s, q: isNum(x.q) ? x.q : 2, r: typeof x.r === 'string' ? x.r : 'brainLoaf', a: q(Math.max(0, isNum(x.a) ? x.a : 0)) + add });
      }
      d.leftovers = JSON.stringify(out);
      d.leftoverServings = out.reduce((n, e) => n + e.s, 0);
      d.spoiledServings = out.filter((e) => e.a >= LEFTOVER_SPOIL_MIN).reduce((n, e) => n + e.s, 0);
    }
  },
};

const mealsOutRule: CatchUpRule = {
  id: 'mealsOut',
  apply(snap, w) {
    for (const o of sortedObjects(snap)) {
      if ((o.defId !== ITEM_MEAL && o.defId !== ITEM_PIZZA) || o.placement.kind === 'held') continue;
      const d = dataOf(o);
      const age = q(isNum(d.ageMin) ? Math.max(0, d.ageMin) : 0) + w.ticks / TICKS_PER_MIN;
      d.ageMin = age;
      if (age >= MEAL_OUT_SPOIL_MIN) d.spoiled = true;
    }
  },
};

/** Tick (possibly fractional) from which a loose item dirties its surface, or null when it never does. */
function dirtySince(o: ObjectState, from: number): number | null {
  if (o.defId === ITEM_DISH) return from;
  if (o.defId !== ITEM_MEAL && o.defId !== ITEM_PIZZA) return null;
  const d = o.data || {};
  if (d.spoiled === true) return from;
  const age = q(isNum(d.ageMin) ? Math.max(0, d.ageMin) : 0);
  return from + Math.max(0, MEAL_OUT_SPOIL_MIN - age) * TICKS_PER_MIN;
}

/** Tick at which a loose item despawns (streets / paths only), else Infinity. */
function despawnAt(o: ObjectState, from: number, env: CatchUpEnv): number {
  if (env.kind !== 'street' && env.kind !== 'path') return Infinity;
  if (o.defId !== ITEM_MEAL && o.defId !== ITEM_PIZZA && o.defId !== ITEM_DISH) return Infinity;
  const age = q(isNum(o.data?.ageMin) ? Math.max(0, o.data.ageMin) : 0);
  return from + Math.max(0, STREET_ITEM_DESPAWN_MIN - age) * TICKS_PER_MIN;
}

/** Hour boundaries h*H with lo < h*H <= hi (0 when hi <= lo). Additive over adjacent windows. */
function hourBoundaries(lo: number, hi: number): number {
  return hi > lo ? Math.floor(hi / TICKS_PER_HOUR) - Math.floor(lo / TICKS_PER_HOUR) : 0;
}

/**
 * Runs FIRST (it reads the items' ages at the start of the window): each dirty item on a surface adds SURFACE_DIRT_Q
 * per hour boundary crossed while it is dirty and still there (from its spoil tick to its despawn tick), so the count
 * is additive over any split of the window.
 */
const dirtRule: CatchUpRule = {
  id: 'dirt',
  apply(snap, w, env) {
    const objs = objectsOf(snap);
    const perSurface = new Map<string, number>();
    for (const o of sortedObjects(snap)) {
      const p = o.placement;
      if (p.kind !== 'loose' || typeof p.parentId !== 'string') continue;
      const since = dirtySince(o, w.from);
      if (since === null) continue;
      const n = hourBoundaries(Math.max(w.from, since), Math.min(w.now, despawnAt(o, w.from, env)));
      if (n > 0) perSurface.set(p.parentId, (perSurface.get(p.parentId) ?? 0) + n);
    }
    for (const id of [...perSurface.keys()].sort()) {
      const s = objs[id];
      if (!s || typeof s !== 'object') continue;
      if (!s.condition || typeof s.condition !== 'object') s.condition = { broken: false, dirt: 0, burning: false, burnMinutes: 0 };
      const before = q(Math.max(0, Math.min(1, isNum(s.condition.dirt) ? s.condition.dirt : 0)));
      s.condition.dirt = Math.min(1, before + perSurface.get(id)! * SURFACE_DIRT_Q);
    }
  },
};

const itemDespawnRule: CatchUpRule = {
  id: 'itemDespawn',
  apply(snap, _w, env) {
    if (env.kind !== 'street' && env.kind !== 'path') return;
    const objs = objectsOf(snap);
    for (const o of sortedObjects(snap)) {
      if (o.placement.kind !== 'loose') continue;
      if (o.defId !== ITEM_MEAL && o.defId !== ITEM_PIZZA && o.defId !== ITEM_DISH) continue;
      const age = isNum(o.data?.ageMin) ? o.data.ageMin : 0;
      // dishes do not age by themselves: they carry `ageMin` from the itemAge bookkeeping below
      if (age >= STREET_ITEM_DESPAWN_MIN) delete objs[o.id];
    }
  },
};

/** Dishes on streets age too (only for the despawn rule; nothing else reads a dish's age). */
const streetDishAgeRule: CatchUpRule = {
  id: 'streetDishAge',
  apply(snap, w, env) {
    if (env.kind !== 'street' && env.kind !== 'path') return;
    for (const o of sortedObjects(snap)) {
      if (o.defId !== ITEM_DISH || o.placement.kind !== 'loose') continue;
      const d = dataOf(o);
      d.ageMin = q(isNum(d.ageMin) ? Math.max(0, d.ageMin) : 0) + w.ticks / TICKS_PER_MIN;
    }
  },
};

const gardenRule: CatchUpRule = {
  id: 'garden',
  apply(snap, w) {
    for (const o of sortedObjects(snap)) {
      const d = o.data;
      if (!d || !isNum(d.growStartTick) || !isNum(d.growTicksPerStage) || d.growTicksPerStage <= 0 || !isNum(d.growMaxStage)) continue;
      const stage = Math.max(0, Math.min(Math.floor(d.growMaxStage), Math.floor((w.now - d.growStartTick) / d.growTicksPerStage)));
      d.growStage = stage;
    }
  },
};

/** `snapshot.data.residents`: agent id → the needs it froze with (absent residents). */
export type ResidentNeeds = Record<string, Partial<Record<NeedId, number>>>;

export function residentsOf(snap: RegionSnapshot): ResidentNeeds | null {
  const r = snap.data ? snap.data.residents : undefined;
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as ResidentNeeds) : null;
}

const residentsRule: CatchUpRule = {
  id: 'residents',
  apply(snap, w) {
    const res = residentsOf(snap);
    if (!res) return;
    const drift = hourBoundaries(w.from, w.now) * RESIDENT_DRIFT_PER_HOUR;
    if (drift <= 0) return;
    for (const id of Object.keys(res).sort()) {
      const needs = res[id];
      if (!needs || typeof needs !== 'object') continue;
      for (const n of RESIDENT_NEEDS) {
        const v = needs[n];
        if (!isNum(v)) continue;
        const cur = q(Math.max(0, Math.min(100, v)));
        needs[n] = cur < RESIDENT_REST_LEVEL ? Math.min(RESIDENT_REST_LEVEL, cur + drift) : Math.max(RESIDENT_REST_LEVEL, cur - drift);
      }
    }
  },
};

/** TODO(S6): place absent townies at their scheduled stop `(worldSeed, townieId, day) → stop` (pure, hash32). */
const townieScheduleRule: CatchUpRule = { id: 'townieSchedule', apply() {} };

/** Order matters: dirt reads the items' ages at the start of the window; the age rules run before the despawn rule. */
export const CATCH_UP_RULES: readonly CatchUpRule[] = [dirtRule, fridgeRule, mealsOutRule, streetDishAgeRule, itemDespawnRule, gardenRule, residentsRule, townieScheduleRule];

/** True for a usable watermark / tick (non-negative safe integer). */
export function isTick(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/**
 * Apply the closed-form catch-up of `record.snapshot` from its watermark to `now` (see the header). Returns true when
 * the record is caught up to `now` afterwards (also when nothing had to change), false when refused (no change).
 * A record without a snapshot only moves its watermark (nothing to age: it regenerates from the seed).
 */
export function catchUpRecord(record: RegionRecord, now: number, env: CatchUpEnv): boolean {
  if (!record || typeof record !== 'object' || !isTick(now) || !isTick(record.caughtUpTick) || now < record.caughtUpTick) return false;
  const from = record.caughtUpTick;
  if (now === from) return true;
  const snap = record.snapshot;
  if (snap && typeof snap === 'object') {
    const w: CatchUpWindow = { from, now, ticks: now - from };
    for (const r of CATCH_UP_RULES) r.apply(snap, w, env);
  }
  record.caughtUpTick = now;
  return true;
}
