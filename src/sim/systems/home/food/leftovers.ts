/**
 * Leftovers live in fridge object data as a compact JSON list (ObjectState.data only holds scalars):
 *   data.leftovers = '[{"s":3,"q":4,"r":"frontalLasagna","a":120}]'   (servings, quality, recipe, age minutes)
 *   data.leftoverServings / data.spoiledServings = totals for UI & requirements.
 * Spoilage (GDD §5): leftovers spoil after 48 h; time runs ×2 with the power off (or a broken fridge) and ×0.5 in a
 * Cryo-Fridge (ObjectDef.params.spoilMult). Meals left out spoil after 24 h.
 */
import type { SimContext } from '../../../contracts';
import type { ObjectState } from '../../../types';
import { DATA, ITEM } from '../../../content/home/ids';
import { RECIPES_BY_ID } from '../../../content/home/recipes';
import { clamp, dataBool, dataNum, isNum, objParam, setData, sortedObjects, str } from '../util';

export const LEFTOVER_SPOIL_MIN = 48 * 60;
export const MEAL_OUT_SPOIL_MIN = 24 * 60;
export const DEFAULT_FRIDGE_CAPACITY = 30;

export interface Leftover {
  /** servings */
  s: number;
  /** quality 1..6 */
  q: number;
  /** recipe id */
  r: string;
  /** spoilage age in minutes (already scaled by fridge/power multipliers) */
  a: number;
}

export function readLeftovers(fridge: ObjectState | null | undefined): Leftover[] {
  const raw = fridge?.data?.[DATA.leftovers];
  if (typeof raw !== 'string' || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Leftover[] = [];
  for (const e of parsed) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const s = Math.floor(isNum(o.s) ? o.s : 0);
    if (s < 1) continue;
    out.push({
      s: Math.min(s, 99),
      q: clamp(Math.round(isNum(o.q) ? o.q : 2), 1, 6),
      r: typeof o.r === 'string' && RECIPES_BY_ID[o.r] ? o.r : 'brainLoaf',
      a: Math.max(0, isNum(o.a) ? o.a : 0),
    });
  }
  return out;
}

export function isSpoiledEntry(e: Leftover): boolean {
  return e.a >= LEFTOVER_SPOIL_MIN;
}

export function writeLeftovers(ctx: SimContext, fridge: ObjectState, list: Leftover[]): void {
  const clean = list.filter((e) => e.s >= 1).map((e) => ({ s: e.s, q: e.q, r: e.r, a: Math.round(e.a * 100) / 100 }));
  const total = clean.reduce((n, e) => n + e.s, 0);
  const spoiled = clean.filter(isSpoiledEntry).reduce((n, e) => n + e.s, 0);
  if (!fridge.data || typeof fridge.data !== 'object') fridge.data = {};
  fridge.data[DATA.leftovers] = JSON.stringify(clean);
  setData(ctx, fridge, DATA.leftoverServings, total);
  setData(ctx, fridge, DATA.spoiledServings, spoiled);
}

export function leftoverCount(fridge: ObjectState | null | undefined): number {
  return readLeftovers(fridge).reduce((n, e) => n + e.s, 0);
}

export function spoiledCount(fridge: ObjectState | null | undefined): number {
  return readLeftovers(fridge)
    .filter(isSpoiledEntry)
    .reduce((n, e) => n + e.s, 0);
}

export function fridgeCapacity(ctx: SimContext, fridge: ObjectState): number {
  return Math.max(1, Math.floor(objParam(ctx, fridge, 'capacity', DEFAULT_FRIDGE_CAPACITY)));
}

/** Store servings; merges with an identical (recipe, quality, ~age) entry. */
export function addLeftovers(ctx: SimContext, fridge: ObjectState, entry: Leftover): true | string {
  const list = readLeftovers(fridge);
  const have = list.reduce((n, e) => n + e.s, 0);
  const cap = fridgeCapacity(ctx, fridge);
  const s = Math.floor(entry.s);
  if (!(s >= 1)) return 'Nothing to store';
  if (have + s > cap) return 'The fridge is full';
  const same = list.find((e) => e.r === entry.r && e.q === entry.q && Math.abs(e.a - entry.a) < 30);
  if (same) same.s += s;
  else list.push({ s, q: clamp(Math.round(entry.q), 1, 6), r: entry.r, a: Math.max(0, entry.a) });
  writeLeftovers(ctx, fridge, list);
  return true;
}

/** Take one serving: oldest fresh first; only spoiled ones left → the oldest spoiled. */
export function takeServing(ctx: SimContext, fridge: ObjectState): Leftover | null {
  const list = readLeftovers(fridge);
  if (list.length === 0) return null;
  const fresh = list.filter((e) => !isSpoiledEntry(e)).sort((a, b) => b.a - a.a);
  const pool = fresh.length > 0 ? fresh : list.slice().sort((a, b) => b.a - a.a);
  const pick = pool[0];
  pick.s -= 1;
  writeLeftovers(ctx, fridge, list);
  return { s: 1, q: pick.q, r: pick.r, a: pick.a };
}

/** Toss every spoiled serving; returns how many were thrown out. */
export function tossSpoiled(ctx: SimContext, fridge: ObjectState): number {
  const list = readLeftovers(fridge);
  const keep = list.filter((e) => !isSpoiledEntry(e));
  const tossed = list.filter(isSpoiledEntry).reduce((n, e) => n + e.s, 0);
  writeLeftovers(ctx, fridge, keep);
  return tossed;
}

/** Spoilage speed of a fridge right now (power off or broken = no cooling = ×2). */
export function fridgeSpoilRate(ctx: SimContext, fridge: ObjectState): number {
  const mult = Math.max(0, objParam(ctx, fridge, 'spoilMult', 1));
  let cooling = true;
  try {
    cooling = ctx.powered(fridge);
  } catch {
    cooling = !!ctx.state.household?.utilitiesOn;
  }
  return mult * (cooling ? 1 : 2);
}

export function ageFridge(ctx: SimContext, fridge: ObjectState, minutes: number): void {
  const list = readLeftovers(fridge);
  if (list.length === 0) return;
  const rate = fridgeSpoilRate(ctx, fridge);
  for (const e of list) e.a += minutes * rate;
  writeLeftovers(ctx, fridge, list);
}

export function isMealItem(obj: ObjectState | null | undefined): boolean {
  return !!obj && (obj.defId === ITEM.meal || obj.defId === ITEM.pizza);
}

export function mealSpoiled(obj: ObjectState | null | undefined): boolean {
  return !!obj && (dataBool(obj, DATA.spoiled, false) || dataNum(obj, DATA.ageMin, 0) >= MEAL_OUT_SPOIL_MIN);
}

/** Meals / pizza sitting out (not in a hand) age 1:1; spoiled at 24 h. */
export function ageMealsOut(ctx: SimContext, minutes: number): void {
  for (const o of sortedObjects(ctx)) {
    if (!isMealItem(o) || o.placement.kind === 'held') continue;
    const age = dataNum(o, DATA.ageMin, 0) + minutes;
    if (!o.data || typeof o.data !== 'object') o.data = {};
    o.data[DATA.ageMin] = age;
    if (age >= MEAL_OUT_SPOIL_MIN && !dataBool(o, DATA.spoiled, false)) setData(ctx, o, DATA.spoiled, true);
  }
}

/** A fresh meal/pizza with servings is out (not in someone's hand), or some fridge holds fresh leftovers. */
export function freshFoodAvailable(ctx: SimContext): boolean {
  for (const o of sortedObjects(ctx)) {
    if (!o || o.placement?.kind === 'held') continue;
    if (isMealItem(o) && dataNum(o, DATA.servings, 0) >= 1 && !mealSpoiled(o)) return true;
    if (typeof o.data?.[DATA.leftovers] === 'string' && readLeftovers(o).some((e) => !isSpoiledEntry(e))) return true;
  }
  return false;
}

/** Free leftover capacity of the roomiest fridge on the lot (0 when there is none or all are full). */
export function bestFridgeRoom(ctx: SimContext, hasFridgeTag: (o: ObjectState) => boolean): number {
  let best = 0;
  for (const o of sortedObjects(ctx)) {
    if (!hasFridgeTag(o) || o.placement?.kind === 'held' || o.condition?.burning) continue;
    best = Math.max(best, fridgeCapacity(ctx, o) - leftoverCount(o));
  }
  return best;
}

export function ageAllFridges(ctx: SimContext, minutes: number): void {
  for (const o of sortedObjects(ctx)) {
    if (str(o.data?.[DATA.leftovers], '') === '') continue;
    ageFridge(ctx, o, minutes);
  }
}
