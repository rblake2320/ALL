/**
 * SIM STREAMING TIERS, SNAPSHOTS AND CATCH-UP (W-025 S4; docs/DESIGN_WORLD_LEVELS.md §1.4, §1.8, §1.11, §1.20).
 *
 * TIER EVALUATION. Every STREAM_EVAL_TICKS ticks, at the start of `step()` (before the tick advances), the live set is
 * recomputed from world data only (household positions, the tick, the saved `town.stream`), never from the camera or
 * the device, so the same save gives the same tiers everywhere and a journal replay re-derives exactly the same
 * activations (§1.11: tier changes are derived in `step()`, not journaled; the journal fingerprint carries a hash of
 * the active set so a replay verifies them):
 *  - REQUIRED (never capped, never subject to dwell): the home; every region a household member stands in; the region
 *    past the next portal of a member's route once the member is within PREACTIVATE_TILES of that portal ("activate
 *    ahead of walkers"); the region of a member's queued / running object or agent target (its target object lives
 *    in `state.objects` only while its region is active);
 *  - SURROUNDINGS: a dormant region enters when its rect is within ENTER_RADIUS tiles (Chebyshev, world) of a member;
 *    an active one leaves when it is farther than LEAVE_RADIUS from every member. Both moves wait MIN_DWELL_TICKS
 *    after the region's last tier change (hysteresis: a member pacing at the band edge changes a tier at most once
 *    per 30 game minutes). Incumbents get the band as a head start in the budget order, so a near newcomer does not
 *    evict them one tick and lose to them the next;
 *  - the budget is `selectLiveRegions` (world.ts): ≤ LIVE_LOT_BUDGET lots in total with the household together,
 *    ≤ LIVE_STREET_BUDGET streets / paths, required lots always (worst case LIVE_LOT_WORST_CASE).
 * Deactivations are applied before activations, each list in RegionId order.
 *
 * FREEZE (active → dormant) writes the region's `RegionSnapshot`: its objects move from `state.objects` into
 * `snapshot.objects` (held items stay with their holder), the needs of non-household agents standing there are kept
 * as absent residents (`snapshot.data.residents`; the agents stay in `state.agents`, unsimulated), `savedTick` and
 * the catch-up watermark are set to now, `data.modifiedTick` is set when the region's structure (lot + object set)
 * differs from what was generated (`data.genHash`), the snapshot is trimmed to its hard limit and the world to the
 * 4 MB cap (worldBudget.ts, S2 drop order).
 *
 * THAW (dormant → active) validates the snapshot (a corrupted one is repaired or dropped with a note, never a
 * crash), applies the closed-form catch-up (catchUp.ts) from the watermark to now, moves the objects back and writes
 * the residents' caught-up needs back. A region without a snapshot (never visited, or dropped by the cap) is built from
 * the region builder (S7 / S14 seam, `setRegionBuilder`; default: a street lot for streets, a plain lot otherwise).
 *
 * PLANNING over dormant regions uses services over the snapshot (or the regenerated build), never registered and
 * never simulated (`regions.planner`). S6 seam: `onStreamChange` listeners hear every freeze / thaw (townies
 * materialise / dematerialise there).
 */
import type { LotState, ObjectState, WorldState } from '../types';
import { NEED_IDS } from '../types';
import {
  type RegionId,
  type RegionKind,
  type RegionRecord,
  type RegionSnapshot,
  type WorldRegionDef,
  LIVE_LOT_WORST_CASE,
  hash32,
  lotToWorld,
  placementWorldRect,
  selectLiveRegions,
} from '../../shared/world';
import { SNAPSHOT_MODIFIED_KEY, capWorldSize, jsonBytes, regionSnapshotLimit, sortedJson } from '../../shared/worldBudget';
import { decodeRoute } from '../../shared/worldRoute';
import { newLot } from '../spatial/templates/builder';
import type { TemplateObject } from '../spatial/templates/builder';
import { catchUpRecord, isTick, residentsOf, type ResidentNeeds } from './catchUp';
import { recordFault } from './faults';
import { isHouseholdAgent } from './agents';
import { activateRegion, liveLot, regionServices, registerActiveRegion, streetLot } from './regionSetup';
import { agentRegion, isHomeRegion, isRegionActive, objectRegion, unregisterRegion, type RegionService } from './regions';
import type { Engine } from './types';
import { regionBlockedNow, regionDefOf, worldOf } from './worldMove';
import { slotOfRegionId } from '../../shared/mildewLane';
import { createStartTemplate } from '../world/startTemplates';

/** Tier evaluation period (1 game minute). */
export const STREAM_EVAL_TICKS = 4;
/** A dormant region enters within this many tiles (Chebyshev, world) of a household member. */
export const ENTER_RADIUS = 45;
/** An active region leaves beyond this many tiles from every member. */
export const LEAVE_RADIUS = 60;
/** Minimum ticks between two tier changes of a surrounding region (30 game minutes). */
export const MIN_DWELL_TICKS = 120;
/** A member's next region is required live this many tiles before the portal. */
export const PREACTIVATE_TILES = 10;

/** What the region builder returns: the region's grid plus the objects spawned into it on its first activation. */
export interface BuiltRegion {
  lot: LotState;
  objects: readonly TemplateObject[];
}

/** S7 / S14 seam: build a never-visited region from its def (deterministic: map data + world seed only). */
export type RegionBuilder = (eng: Engine, def: WorldRegionDef) => BuiltRegion | null;

export type StreamChange = { kind: 'thaw' | 'freeze'; regionId: RegionId; tick: number };

interface StreamRuntime {
  builder: RegionBuilder | null;
  /** Never-activated regions' builds (planning + the first thaw), derived, never saved. */
  built: Map<RegionId, { lot: LotState; objects: Record<string, ObjectState> | null; template: readonly TemplateObject[] }>;
  /** Planning-only services of dormant regions. */
  planning: Map<RegionId, RegionService | null>;
  listeners: ((c: StreamChange) => void)[];
  notes: string[];
  stats: { evaluations: number; thaws: number; freezes: number; dropped: number };
}

const runtimes = new WeakMap<Engine, StreamRuntime>();

function rt(eng: Engine): StreamRuntime {
  let r = runtimes.get(eng);
  if (!r) {
    r = { builder: null, built: new Map(), planning: new Map(), listeners: [], notes: [], stats: { evaluations: 0, thaws: 0, freezes: 0, dropped: 0 } };
    runtimes.set(eng, r);
  }
  return r;
}

const MAX_NOTES = 200;

function note(eng: Engine, text: string): void {
  const r = rt(eng);
  r.notes.push(`tick ${eng.state.tick}: ${text}`);
  if (r.notes.length > MAX_NOTES) r.notes.splice(0, r.notes.length - MAX_NOTES);
}

/** Repair / drop notes of streaming (corrupted snapshots, id clashes, oversize trims). */
export function streamNotes(eng: Engine): string[] {
  return rt(eng).notes.slice();
}

/** Counters (tests, diagnostics). */
export function streamStats(eng: Engine): StreamRuntime['stats'] {
  return { ...rt(eng).stats };
}

/** S7 / S14 seam (tests: the shipped templates as stand-ins). Clears cached builds. */
export function setRegionBuilder(eng: Engine, builder: RegionBuilder | null): void {
  const r = rt(eng);
  r.builder = builder;
  r.built.clear();
  r.planning.clear();
}

/** S6 seam: hear every freeze / thaw (after it happened). Returns an unsubscribe function. */
export function onStreamChange(eng: Engine, fn: (c: StreamChange) => void): () => void {
  const r = rt(eng);
  r.listeners.push(fn);
  return () => {
    const i = r.listeners.indexOf(fn);
    if (i >= 0) r.listeners.splice(i, 1);
  };
}

function emitChange(eng: Engine, c: StreamChange): void {
  for (const fn of rt(eng).listeners.slice()) {
    try {
      fn(c);
    } catch (e) {
      recordFault(eng, `stream:${c.regionId}`, e);
    }
  }
}

// ─────────────────────────────────────────── helpers ───────────────────────────────────────────

function streamingOn(eng: Engine): boolean {
  const t = eng.state.town;
  return !!t && typeof t === 'object' && t.expandPending !== true && !!t.stream && Array.isArray(t.stream.active) && !!worldOf(eng);
}

function openDef(eng: Engine, id: RegionId): WorldRegionDef | null {
  const def = regionDefOf(eng, id);
  if (!def || def.kind === 'unfinished' || def.unfinished) return null;
  return regionBlockedNow(eng, def) ? null : def;
}

/** FNV-1a 32 of a string (structure hash; not cryptographic). */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Structure of a region (its grid + which objects stand where): what "the player changed it" compares. */
function structureHash(lot: unknown, objects: readonly ObjectState[]): number {
  const objs = objects
    .map((o) => [o.defId, o.placement, o.tint ?? null])
    .map((x) => sortedJson(x))
    .sort();
  return fnv(sortedJson({ lot, objs }));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sortedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort();
}

// ─────────────────────────────────────────── building ───────────────────────────────────────────

function defaultBuild(eng: Engine, def: WorldRegionDef): BuiltRegion | null {
  if (def.kind === 'street' || def.kind === 'path') {
    const lot = streetLot(eng, def.id);
    return lot ? { lot, objects: [] } : null;
  }
  if (def.kind !== 'lot') return null;
  // S7's shared map assignment names the exact furnished neighbour template. Its snapshot becomes the live lot;
  // an edited saved snapshot takes precedence in the thaw path and is never regenerated here.
  if (slotOfRegionId(def.id) !== null && def.templateId !== null) return createStartTemplate(def.templateId);
  // S14 community templates (park / Old Graveyard) retain the existing plain-lot fallback until their own builder.
  if (def.placement.width !== 30 || def.placement.depth !== 30) return null;
  return { lot: newLot(), objects: [] };
}

function buildOf(eng: Engine, def: WorldRegionDef): StreamRuntime['built'] extends Map<RegionId, infer V> ? V | null : never {
  const r = rt(eng);
  const have = r.built.get(def.id);
  if (have) return have;
  let b: BuiltRegion | null = null;
  try {
    b = r.builder ? r.builder(eng, def) : null;
    if (!b) b = defaultBuild(eng, def);
  } catch (e) {
    recordFault(eng, `stream:build:${def.id}`, e);
    b = null;
  }
  if (!b || !b.lot || b.lot.width !== def.placement.width || b.lot.depth !== def.placement.depth) return null;
  const entry = { lot: JSON.parse(JSON.stringify(b.lot)) as LotState, objects: null, template: b.objects ?? [] };
  r.built.set(def.id, entry);
  return entry;
}

/** Planning stand-in objects of a never-built region (ids never reach the world). */
function plannedObjects(id: RegionId, template: readonly TemplateObject[]): Record<string, ObjectState> {
  const out: Record<string, ObjectState> = {};
  template.forEach((t, i) => {
    const oid = `plan:${i}`;
    out[oid] = {
      id: oid,
      defId: t.defId,
      regionId: id,
      placement: JSON.parse(JSON.stringify(t.placement)),
      value: 0,
      purchasedTick: 0,
      tint: t.tint ?? null,
      condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
      data: {},
      reservedBy: {},
      inUseBy: [],
      rev: 0,
    };
  });
  return out;
}

// ─────────────────────────────────────────── planning over dormant regions ───────────────────────────────────────────

function planner(eng: Engine, id: RegionId): RegionService | null {
  if (!streamingOn(eng) || isHomeRegion(eng, id) || isRegionActive(eng, id)) return null;
  const def = openDef(eng, id);
  if (!def) return null;
  const r = rt(eng);
  if (r.planning.has(id)) return r.planning.get(id) ?? null;
  const getLot = (): LotState | null => {
    const rec = eng.state.town?.regions?.[id];
    if (rec && rec.snapshot && isObj(rec.snapshot.lot)) return rec.snapshot.lot as unknown as LotState;
    const b = buildOf(eng, def);
    return b ? b.lot : null;
  };
  const getObjects = (): WorldState['objects'] => {
    const rec = eng.state.town?.regions?.[id];
    if (rec && rec.snapshot && isObj(rec.snapshot.lot)) return (isObj(rec.snapshot.objects) ? rec.snapshot.objects : {}) as WorldState['objects'];
    const b = buildOf(eng, def);
    if (!b) return {};
    if (!b.objects) b.objects = plannedObjects(id, b.template);
    return b.objects;
  };
  const s = getLot() ? regionServices(eng, id, getLot, getObjects) : null;
  r.planning.set(id, s);
  return s;
}

// ─────────────────────────────────────────── snapshot validation ───────────────────────────────────────────

const PLACEMENT_KINDS = new Set(['floor', 'wall', 'opening', 'loose', 'held']);

function lotUsable(lot: unknown, def: WorldRegionDef): lot is LotState {
  if (!isObj(lot)) return false;
  const l = lot as unknown as LotState;
  const w = def.placement.width;
  const d = def.placement.depth;
  return (
    l.width === w &&
    l.depth === d &&
    Array.isArray(l.floors) &&
    l.floors.length === w * d &&
    isObj(l.walls) &&
    Array.isArray(l.entryPoints) &&
    isObj(l.buildable) &&
    finite(l.version) &&
    finite(l.wallVersion)
  );
}

function placementUsable(p: unknown, lot: LotState): boolean {
  if (!isObj(p) || typeof p.kind !== 'string' || !PLACEMENT_KINDS.has(p.kind)) return false;
  switch (p.kind) {
    case 'floor':
      return Number.isInteger(p.x) && Number.isInteger(p.z) && (p.x as number) >= 0 && (p.z as number) >= 0 && (p.x as number) < lot.width && (p.z as number) < lot.depth && [0, 1, 2, 3].includes(p.rot as number);
    case 'wall':
      return typeof p.edge === 'string' && (p.side === 0 || p.side === 1);
    case 'opening':
      return typeof p.edge === 'string';
    case 'loose':
      return finite(p.x) && finite(p.z) && finite(p.y) && (p.x as number) >= 0 && (p.z as number) >= 0 && (p.x as number) <= lot.width && (p.z as number) <= lot.depth;
    default:
      return false; // a held item is never frozen
  }
}

/**
 * Repair or drop the damaged parts of a dormant region's record before it thaws. Returns false when the snapshot had
 * to be dropped entirely (the region is then rebuilt from the seed). Every change leaves a note.
 */
function repairRecord(eng: Engine, id: RegionId, rec: RegionRecord, def: WorldRegionDef): boolean {
  const now = eng.state.tick;
  const snap = rec.snapshot as RegionSnapshot | null;
  if (!snap) return false;
  if (!isObj(snap) || !lotUsable(snap.lot, def)) {
    note(eng, `${id}: snapshot lot is damaged; snapshot dropped, the region is rebuilt from the seed`);
    rec.snapshot = null;
    return false;
  }
  if (!isTick(snap.savedTick) || snap.savedTick > now) {
    note(eng, `${id}: snapshot savedTick ${String(snap.savedTick)} repaired`);
    snap.savedTick = isTick(rec.caughtUpTick) && rec.caughtUpTick <= now ? rec.caughtUpTick : now;
  }
  if (!isTick(rec.caughtUpTick) || rec.caughtUpTick > now) {
    note(eng, `${id}: catch-up watermark ${String(rec.caughtUpTick)} repaired (no catch-up applied)`);
    rec.caughtUpTick = now;
  }
  if (!isObj(snap.data)) {
    note(eng, `${id}: snapshot data reset`);
    snap.data = {};
  }
  if (!isObj(snap.objects)) {
    note(eng, `${id}: snapshot objects were not a map; dropped`);
    snap.objects = {};
  }
  const objs = snap.objects as Record<string, unknown>;
  const lot = snap.lot as LotState;
  for (const k of sortedKeys(objs)) {
    const o = objs[k];
    const bad = (why: string) => {
      note(eng, `${id}: object ${k} dropped (${why})`);
      delete objs[k];
    };
    if (!isObj(o)) {
      bad('not an object');
      continue;
    }
    if (o.id !== k) {
      bad('id does not match its key');
      continue;
    }
    if (typeof o.defId !== 'string' || !eng.content.objects[o.defId]) {
      bad(`unknown def ${String(o.defId)}`);
      continue;
    }
    if (!placementUsable(o.placement, lot)) {
      bad('bad placement');
      continue;
    }
    if (eng.state.objects[k]) {
      bad('its id is already used in the world');
      continue;
    }
    if (o.regionId !== id) o.regionId = id;
    if (!finite(o.value)) o.value = 0;
    if (!finite(o.purchasedTick)) o.purchasedTick = 0;
    if (!finite(o.rev)) o.rev = 0;
    if (o.tint !== null && typeof o.tint !== 'string') o.tint = null;
    if (!isObj(o.condition)) o.condition = { broken: false, dirt: 0, burning: false, burnMinutes: 0 };
    if (!isObj(o.data)) o.data = {};
    o.reservedBy = {};
    o.inUseBy = [];
  }
  // loose items on a surface that is gone fall to the floor
  for (const k of sortedKeys(objs)) {
    const p = (objs[k] as ObjectState).placement;
    if (p.kind === 'loose' && p.parentId !== null && !objs[p.parentId as string]) {
      note(eng, `${id}: object ${k} lost its surface ${String(p.parentId)}; now on the floor`);
      p.parentId = null;
      p.surfaceIndex = null;
      p.y = 0;
    }
  }
  const res = snap.data.residents;
  if (res !== undefined && !isObj(res)) {
    note(eng, `${id}: absent residents' needs dropped (damaged)`);
    delete snap.data.residents;
  }
  return true;
}

// ─────────────────────────────────────────── freeze / thaw ───────────────────────────────────────────

function kindOf(eng: Engine, id: RegionId): RegionKind {
  return regionDefOf(eng, id)?.kind ?? 'lot';
}

function regionSeed(eng: Engine, id: RegionId): number {
  const seed = eng.state.town?.map?.seed;
  return hash32(typeof seed === 'number' ? seed : 0, fnv(id));
}

function spoilMultOf(eng: Engine): (defId: string) => number {
  return (defId) => {
    const p = (eng.content.objects[defId] as unknown as { params?: Record<string, unknown> } | undefined)?.params;
    const m = p ? p.spoilMult : undefined;
    return typeof m === 'number' && Number.isFinite(m) && m >= 0 ? m : 1;
  };
}

/** Trim a snapshot to its hard limit: loose items go first (highest id first), then a note. */
function trimSnapshot(eng: Engine, id: RegionId, snap: RegionSnapshot): void {
  const limit = regionSnapshotLimit(id, kindOf(eng, id));
  if (jsonBytes(snap) <= limit) return;
  const objs = snap.objects as Record<string, ObjectState>;
  const loose = sortedKeys(objs)
    .filter((k) => objs[k].placement.kind === 'loose')
    .reverse();
  let dropped = 0;
  for (const k of loose) {
    if (jsonBytes(snap) <= limit) break;
    delete objs[k];
    dropped++;
  }
  note(eng, `${id}: snapshot over its ${limit}-byte limit; ${dropped} loose item(s) cleared${jsonBytes(snap) > limit ? ', still over (kept)' : ''}`);
}

/** Active → dormant (see the header). False when refused (home, not active, a member stands there). */
export function freezeRegion(eng: Engine, id: RegionId): boolean {
  const t = eng.state.town;
  if (!t || isHomeRegion(eng, id) || !isRegionActive(eng, id)) return false;
  const now = eng.state.tick;
  for (const a of Object.values(eng.state.agents)) if (a.regionId === id && isHouseholdAgent(eng, a) && a.presence === 'onLot') return false;
  const rec = t.regions[id];
  const lot = liveLot(eng, id);
  if (!rec || !rec.snapshot || !lot) {
    // a registered region without its record: nothing to keep
    unregisterRegion(eng, id);
    t.stream.active = t.stream.active.filter((r) => r !== id);
    t.stream.changedTick[id] = now;
    note(eng, `${id}: active without a live lot; deactivated without a snapshot`);
    return true;
  }
  const objects: Record<string, ObjectState> = {};
  for (const k of sortedKeys(eng.state.objects)) {
    const o = eng.state.objects[k];
    if (!o || o.regionId !== id || o.placement.kind === 'held') continue;
    o.reservedBy = {};
    o.inUseBy = [];
    objects[k] = o;
    delete eng.state.objects[k];
  }
  // reservations other regions' agents held on these objects are gone with them
  const data: Record<string, unknown> = isObj(rec.snapshot.data) ? { ...rec.snapshot.data } : {};
  delete data.residents;
  const residents: ResidentNeeds = {};
  for (const a of Object.values(eng.state.agents).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    if (a.regionId !== id || a.presence !== 'onLot' || isHouseholdAgent(eng, a)) continue;
    const needs: Record<string, number> = {};
    for (const n of NEED_IDS) if (finite(a.needs[n])) needs[n] = a.needs[n];
    residents[a.id] = needs;
  }
  if (Object.keys(residents).length > 0) data.residents = residents;
  const h = structureHash(lot, Object.values(objects));
  if (!finite(data.genHash)) data.genHash = h;
  else if (data.genHash !== h) data[SNAPSHOT_MODIFIED_KEY] = now;
  rec.snapshot = { savedTick: now, lot, objects, data };
  rec.caughtUpTick = now;
  unregisterRegion(eng, id);
  t.stream.active = t.stream.active.filter((r) => r !== id);
  t.stream.changedTick[id] = now;
  rt(eng).planning.delete(id);
  rt(eng).stats.freezes++;
  trimSnapshot(eng, id, rec.snapshot);
  const dropped = capWorldSize(eng.state as unknown as Parameters<typeof capWorldSize>[0]);
  if (dropped.length > 0) {
    rt(eng).stats.dropped += dropped.length;
    for (const d of dropped) rt(eng).planning.delete(d);
    note(eng, `world over the hard cap: dropped never-modified snapshot(s) ${dropped.join(', ')}`);
  }
  emitChange(eng, { kind: 'freeze', regionId: id, tick: now });
  return true;
}

/** Dormant → active (see the header). False when refused (home, already active, not an open region, no builder). */
export function thawRegion(eng: Engine, id: RegionId): boolean {
  const t = eng.state.town;
  if (!t || isHomeRegion(eng, id) || isRegionActive(eng, id)) return false;
  const def = openDef(eng, id);
  if (!def) return false;
  const now = eng.state.tick;
  const r = rt(eng);
  r.planning.delete(id);
  const rec = t.regions[id];
  if (rec && rec.snapshot && repairRecord(eng, id, rec, def)) {
    const snap = rec.snapshot;
    catchUpRecord(rec, now, { kind: def.kind, seed: regionSeed(eng, id), spoilMult: spoilMultOf(eng) });
    const objs = snap.objects as Record<string, ObjectState>;
    for (const k of sortedKeys(objs)) {
      if (eng.state.objects[k]) {
        note(eng, `${id}: object ${k} dropped (its id is already used in the world)`);
        continue;
      }
      eng.state.objects[k] = objs[k];
    }
    snap.objects = {};
    const res = residentsOf(snap);
    if (res) {
      for (const aid of sortedKeys(res)) {
        const a = eng.state.agents[aid];
        const needs = res[aid];
        if (!a || !isObj(needs)) continue;
        for (const n of NEED_IDS) if (finite(needs[n])) a.needs[n] = needs[n] as number;
      }
      delete snap.data.residents;
    }
    if (!registerActiveRegion(eng, id)) {
      note(eng, `${id}: could not register its services`);
      return false;
    }
  } else {
    if (rec && rec.snapshot === null && rec.firstActiveTick !== null) note(eng, `${id}: no snapshot (dropped earlier); rebuilt from the seed`);
    const b = buildOf(eng, def);
    if (!b) {
      note(eng, `${id}: no builder for this region`);
      return false;
    }
    const lot = JSON.parse(JSON.stringify(b.lot)) as LotState;
    const res = activateRegion(eng, id, { lot, objects: b.template });
    if (!res.ok) {
      note(eng, `${id}: activation refused (${res.reason})`);
      return false;
    }
    const nrec = t.regions[id];
    const objs = Object.values(eng.state.objects).filter((o) => o.regionId === id && o.placement.kind !== 'held');
    if (nrec && nrec.snapshot) nrec.snapshot.data.genHash = structureHash(liveLot(eng, id), objs);
    r.built.delete(id);
  }
  r.stats.thaws++;
  emitChange(eng, { kind: 'thaw', regionId: id, tick: now });
  return true;
}

// ─────────────────────────────────────────── tier evaluation ───────────────────────────────────────────

interface MemberPos {
  agentId: string;
  regionId: RegionId;
  wx: number;
  wz: number;
}

function memberPositions(eng: Engine): MemberPos[] {
  const out: MemberPos[] = [];
  for (const id of [...eng.state.household.memberIds].sort()) {
    const a = eng.state.agents[id];
    if (!a || a.presence !== 'onLot' || !a.pos) continue;
    const rid = agentRegion(eng, a);
    const def = regionDefOf(eng, rid);
    const w = def ? lotToWorld(def.placement, a.pos.x, a.pos.z) : null;
    if (w) out.push({ agentId: id, regionId: rid, wx: w.x, wz: w.z });
  }
  return out;
}

function rectDistance(def: WorldRegionDef, p: { wx: number; wz: number }): number {
  const r = placementWorldRect(def.placement);
  if (!r) return Infinity;
  const dx = Math.max(r.x0 - p.wx, 0, p.wx - r.x1);
  const dz = Math.max(r.z0 - p.wz, 0, p.wz - r.z1);
  return Math.max(dx, dz);
}

/** Regions a member's walk needs live now: the next region of its route (within PREACTIVATE_TILES), its target's. */
function heldByWalks(eng: Engine, members: readonly MemberPos[]): RegionId[] {
  const w = worldOf(eng);
  const out = new Set<RegionId>();
  for (const m of members) {
    const a = eng.state.agents[m.agentId];
    const run = a.active;
    if (run && w) {
      const route = decodeRoute(run.data._route);
      const next = route && route.length > 0 ? route[0] : null;
      const span = next ? w.spans.get(next.portalId) : undefined;
      if (span && next) {
        const here = next.from === 'a' ? span.portal.a.regionId : span.portal.b.regionId;
        const there = next.from === 'a' ? span.portal.b.regionId : span.portal.a.regionId;
        const def = regionDefOf(eng, here);
        const tile = span.pairs[0][next.from];
        const pw = def ? lotToWorld(def.placement, tile.x + 0.5, tile.z + 0.5) : null;
        if (here === m.regionId && pw && Math.max(Math.abs(pw.x - m.wx), Math.abs(pw.z - m.wz)) <= PREACTIVATE_TILES + span.pairs.length) out.add(there);
      }
    }
    for (const item of [...(run ? [run] : []), ...a.queue]) {
      const tg = item.target;
      if (tg.kind === 'object') {
        const o = eng.state.objects[tg.id];
        if (o) out.add(objectRegion(eng, o));
      } else if (tg.kind === 'agent') {
        const o = eng.state.agents[tg.id];
        if (o && o.presence === 'onLot') out.add(agentRegion(eng, o));
      }
    }
  }
  return [...out].filter((id) => !isHomeRegion(eng, id) && openDef(eng, id) !== null).sort();
}

/** The live set the tier rules give now (pure with respect to the world; see the header). */
export function computeLiveSet(eng: Engine): RegionId[] | null {
  if (!streamingOn(eng)) return null;
  const t = eng.state.town!;
  const w = worldOf(eng)!;
  const now = eng.state.tick;
  const home = t.homeLotId;
  const members = memberPositions(eng);
  const required = new Set<RegionId>();
  for (const m of members) if (!isHomeRegion(eng, m.regionId)) required.add(m.regionId);
  for (const id of heldByWalks(eng, members)) required.add(id);
  const candidates: { regionId: RegionId; kind: RegionKind; distance: number }[] = [];
  for (const def of w.map.regions) {
    if (def.id === home || required.has(def.id) || !openDef(eng, def.id)) continue;
    let d = Infinity;
    for (const m of members) d = Math.min(d, rectDistance(def, m));
    const active = isRegionActive(eng, def.id);
    const changed = t.stream.changedTick[def.id];
    const dwelling = isTick(changed) && now - changed < MIN_DWELL_TICKS;
    if (active) {
      // dwell: stays (first in the budget order); else stays while within the leave radius, with the band as a head start
      if (dwelling) candidates.push({ regionId: def.id, kind: def.kind, distance: 0 });
      else if (d <= LEAVE_RADIUS) candidates.push({ regionId: def.id, kind: def.kind, distance: Math.max(0, d - (LEAVE_RADIUS - ENTER_RADIUS)) });
    } else if (!dwelling && d <= ENTER_RADIUS) candidates.push({ regionId: def.id, kind: def.kind, distance: d });
  }
  const req = [...required].sort();
  const sel = selectLiveRegions({
    homeRegionId: home,
    memberRegions: req.slice(0, LIVE_LOT_WORST_CASE - 1).map((id) => ({ regionId: id, kind: regionDefOf(eng, id)?.kind ?? 'lot' })),
    candidates,
  });
  if (!sel) return null;
  // more held regions than selectLiveRegions takes (≥ 9 distinct): they are live all the same (members first)
  return [...new Set([...sel.live, ...req])].sort();
}

/** One tier evaluation: deactivations, then activations, each in RegionId order. */
export function evaluateStreaming(eng: Engine): void {
  const live = computeLiveSet(eng);
  if (!live) return;
  const t = eng.state.town!;
  const r = rt(eng);
  r.stats.evaluations++;
  const want = new Set(live);
  const active = [...eng.regions.services.keys()].sort();
  for (const id of active) if (!want.has(id)) freezeRegion(eng, id);
  for (const id of live) if (!isHomeRegion(eng, id) && !isRegionActive(eng, id)) thawRegion(eng, id);
  t.stream.lastEvalTick = eng.state.tick;
}

/** step() hook: evaluate every STREAM_EVAL_TICKS ticks, before the tick advances. Never throws. */
export function streamStep(eng: Engine): void {
  if (!eng.state.town) return;
  const tick = eng.state.tick;
  if (!Number.isInteger(tick) || tick % STREAM_EVAL_TICKS !== 0) return;
  try {
    evaluateStreaming(eng);
  } catch (e) {
    recordFault(eng, 'stream', e);
  }
}

/** Movement hook: a household member about to cross into a dormant region wakes it now (§1.4 "Crossing into…"). */
function activateNow(eng: Engine, id: RegionId, agentId: string): boolean {
  const a = eng.state.agents[agentId];
  if (!a || !isHouseholdAgent(eng, a) || !streamingOn(eng)) return false;
  return thawRegion(eng, id);
}

/**
 * Engine creation: install the planner + the crossing hook, then re-register the active regions of a loaded world,
 * repairing a damaged one (a live lot that is unusable is rebuilt from the seed, with a note in `warnings`).
 */
export function installStreaming(eng: Engine, warnings?: string[]): void {
  eng.regions.planner = (id) => planner(eng, id);
  eng.regions.activateNow = (id, agentId) => activateNow(eng, id, agentId);
  const t = eng.state.town;
  if (!t || !t.stream || !Array.isArray(t.stream.active)) return;
  for (const id of [...t.stream.active].sort()) {
    if (isHomeRegion(eng, id) || isRegionActive(eng, id)) continue;
    const def = regionDefOf(eng, id);
    const rec = t.regions ? t.regions[id] : undefined;
    if (!def || def.kind === 'unfinished' || def.unfinished || !rec || !rec.snapshot || !lotUsable(rec.snapshot.lot, def)) {
      const why = `${id}: listed active but its lot is missing or damaged; set dormant (rebuilt on its next activation)`;
      note(eng, why);
      warnings?.push(why);
      if (rec && rec.snapshot && def && !lotUsable(rec.snapshot.lot, def)) rec.snapshot = null;
      // its objects lost their grid: dropped (the region is rebuilt from the seed on its next activation)
      for (const k of sortedKeys(eng.state.objects)) {
        const o = eng.state.objects[k];
        if (o && o.regionId === id && o.placement.kind !== 'held') delete eng.state.objects[k];
      }
      t.stream.active = t.stream.active.filter((r) => r !== id);
      continue;
    }
    registerActiveRegion(eng, id, undefined, { restore: true });
    if (!isRegionActive(eng, id)) t.stream.active = t.stream.active.filter((r) => r !== id);
  }
}
