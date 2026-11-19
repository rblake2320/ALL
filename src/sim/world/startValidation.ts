/** Admission uses the production spatial service, including every interaction slot. */
import type { ContentRegistry } from '../contracts';
import { createSpatial, edgeSides, linkOpenings } from '../spatial';
import type { TemplateObject, TemplateResult } from '../spatial/templates/builder';
import { SAVE_SCHEMA_VERSION, type ObjectState, type WorldState } from '../types';
import { seedRngState } from '../rng';
import { FLOOR_STYLE_BY_ID, WALL_STYLE_BY_ID, WALL_SEGMENT_PRICE } from '../../shared/styles';
import { lotTileToWorldTile, type WorldMap } from '../../shared/world';

export function admissionObject(t: TemplateObject, id: string, registry: ContentRegistry): ObjectState {
  const def = registry.objects[t.defId];
  if (!def) throw new Error(`Unknown catalog object: ${t.defId}`);
  return { id, defId: t.defId, placement: structuredClone(t.placement), value: def.price, purchasedTick: 0,
    tint: t.tint ?? null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: {}, reservedBy: {}, inUseBy: [], rev: 1 };
}

/** A complete isolated state: no systems run, no live RNG or save is changed. */
export function admissionWorld(template: TemplateResult, registry: ContentRegistry): WorldState {
  const state: WorldState = { schemaVersion: SAVE_SCHEMA_VERSION, seed: 1, rng: seedRngState(1), tick: 0, nextId: template.objects.length + 1,
    household: { name: 'Start admission', funds: 2500, memberIds: [], bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
    lot: structuredClone(template.lot), objects: {}, agents: {}, relationships: {}, notifications: [], choices: [], party: null, flags: {},
    stats: { counters: {}, agent: {} }, settings: { autonomy: 'off', difficulty: 'normal', visitorsEnabled: false }, gameOver: false };
  template.objects.forEach((obj, i) => { const o = admissionObject(obj, `o${i + 1}`, registry); state.objects[o.id] = o; });
  linkOpenings(state);
  return state;
}

export interface StartLotValidation {
  ok: boolean;
  errors: string[];
  freeIndoorTiles: number;
  structuralValue: number;
  /** Simultaneous, legal places for the three day-one purchases, with all slots reachable. */
  dayOne: TemplateObject[];
  wallPatch: string[];
}

function reachableErrors(state: WorldState, registry: ContentRegistry, spatial: ReturnType<typeof createSpatial>): string[] {
  const errors: string[] = [];
  for (const ep of state.lot.entryPoints) {
    const df = spatial.distanceField(ep);
    for (const o of Object.values(state.objects)) {
      registry.objects[o.defId].slots.forEach((slot, i) => {
        const reachable = spatial.resolveSlots(o).filter(r => r.index === i).flatMap(r => r.approach)
          .filter(p => Number.isFinite(df.dist[p.z * state.lot.width + p.x]));
        if (!reachable.length || !spatial.findPath(ep, reachable[0])) errors.push(`${o.defId}.${slot.id} unreachable from ${ep.x},${ep.z}`);
      });
    }
  }
  return errors;
}

export function validateStartLot(template: TemplateResult, registry: ContentRegistry, story = false): StartLotValidation {
  const errors: string[] = [];
  const l = template.lot;
  if (!l || !Number.isInteger(l.width) || !Number.isInteger(l.depth) || l.width < 1 || l.depth < 1 || l.width > 256 || l.depth > 256 ||
      !Array.isArray(l.floors) || l.floors.length !== l.width * l.depth || !Array.isArray(l.entryPoints) || l.entryPoints.length !== 2 ||
      l.entryPoints.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || p.x < 0 || p.z < 0 || p.x >= l.width || p.z >= l.depth)) {
    return { ok: false, errors: ['Invalid grid or missing two real sidewalk entrances'], freeIndoorTiles: 0, structuralValue: 0, dayOne: [], wallPatch: [] };
  }
  let state: WorldState;
  try { state = admissionWorld(template, registry); }
  catch (e) { return { ok: false, errors: [String(e)], freeIndoorTiles: 0, structuralValue: 0, dayOne: [], wallPatch: [] }; }
  const S = createSpatial(() => state, registry);
  for (const o of Object.values(state.objects)) {
    const p = o.placement;
    const check = p.kind === 'floor' ? S.checkPlace(o.defId, p.x, p.z, p.rot, o.id)
      : p.kind === 'wall' ? S.checkWallItem(o.defId, p.edge, p.side, o.id)
      : p.kind === 'opening' ? S.checkOpening(o.defId, p.edge, o.id) : null;
    if (!check?.ok || check.blockedSlots.length) errors.push(`${o.defId}@${JSON.stringify(p)}: ${check?.reason ?? 'unsupported placement'}; blocked=${JSON.stringify(check?.blockedSlots)}`);
  }
  errors.push(...reachableErrors(state, registry, S));
  for (const f of state.lot.floors) if (f !== null && !FLOOR_STYLE_BY_ID[f]) errors.push(`Unknown floor: ${f}`);
  for (const wall of Object.values(state.lot.walls)) for (const paint of wall.paint) if (!WALL_STYLE_BY_ID[paint]) errors.push(`Unknown wall style: ${paint}`);
  const df = S.distanceField(state.lot.entryPoints[0]);
  const freeIndoorTiles = S.rooms().filter(r => r.indoor).flatMap(r => r.tiles).filter(i => S.isWalkable(i % state.lot.width, Math.floor(i / state.lot.width)) && Number.isFinite(df.dist[i])).length;
  const structuralValue = Math.round(Object.values(state.objects).reduce((n, o) => n + o.value, 0) + Object.keys(state.lot.walls).length * WALL_SEGMENT_PRICE
    + state.lot.floors.reduce<number>((n, f) => n + (f ? FLOOR_STYLE_BY_ID[f]?.price ?? 0 : 0), 0));
  const dayOne: TemplateObject[] = [];
  let wallPatch: string[] = [];
  if (story) {
    if (template.objects.length > 20) errors.push('Story home exceeds 20 objects');
    if (freeIndoorTiles < 12) errors.push('Fewer than 12 reachable free indoor tiles');
    for (const tag of ['mailbox', 'coffin']) if (!Object.values(state.objects).some(o => registry.objects[o.defId].tags.includes(tag))) errors.push(`Missing ${tag}`);
    // Four real, contiguous, vacant buildable edges; recheck all object approaches after erecting them.
    const b = state.lot.buildable;
    patch: for (let z = b.z0 + 1; z < b.z1; z++) for (let x = b.x0; x + 4 <= b.x1; x++) {
      const edges = Array.from({ length: 4 }, (_, i) => `h:${x + i}:${z}`);
      if (edges.some(e => state.lot.walls[e] || edgeSides(e).some(p => !S.isWalkable(p.x, p.z) || S.isIndoor(p.x, p.z)))) continue;
      for (const e of edges) state.lot.walls[e] = { paint: ['wall_exterior_siding', 'wall_exterior_siding'], openingId: null };
      S.invalidate();
      const reachable = reachableErrors(state, registry, S).length === 0;
      for (const e of edges) delete state.lot.walls[e];
      S.invalidate();
      if (reachable) { wallPatch = edges; break patch; }
    }
    if (wallPatch.length !== 4) errors.push('No reachable four-edge wall patch');
    if (!errors.length) {
      for (const defId of ['fridge_humming', 'microwave_nuke', 'shower_drizzle']) {
        let placed = false;
        search: for (let z = 1; z < state.lot.depth - 1; z++) for (let x = 1; x < state.lot.width - 1; x++) for (const rot of [0, 1, 2, 3] as const) {
          if (!S.isIndoor(x, z)) continue;
          const check = S.checkPlace(defId, x, z, rot);
          if (!check.ok || check.blockedSlots.length) continue;
          const t: TemplateObject = { defId, placement: { kind: 'floor', x, z, rot } };
          const obj = admissionObject(t, `probe-${dayOne.length}`, registry);
          state.objects[obj.id] = obj; S.invalidate();
          if (reachableErrors(state, registry, S).length) { delete state.objects[obj.id]; S.invalidate(); continue; }
          dayOne.push(t); placed = true; break search;
        }
        if (!placed) { errors.push(`No simultaneously reachable indoor place for ${defId}`); break; }
      }
    }
  }
  return { ok: errors.length === 0, errors, freeIndoorTiles, structuralValue, dayOne, wallPatch };
}

/** Measured gate route: real home pathfinding + orthogonal open-street walks and explicit adjacent portals.
 * Ends at the graveyard gate, not inside the (separately owned) graveyard template. */
export function graveyardWalkTiles(home: TemplateResult, registry: ContentRegistry, map: WorldMap, homeId: string): number {
  const state = admissionWorld(home, registry), S = createSpatial(() => state, registry);
  const starts: { regionId: string; x: number; z: number }[] = [];
  for (const o of Object.values(state.objects)) if (o.placement.kind === 'opening' && registry.objects[o.defId].tags.includes('door')) {
    const [a, b] = edgeSides(o.placement.edge);
    if (S.isIndoor(a.x, a.z) === S.isIndoor(b.x, b.z)) continue;
    const p = S.isIndoor(a.x, a.z) ? b : a;
    if (S.isWalkable(p.x, p.z)) starts.push({ regionId: homeId, ...p });
  }
  const allowed = new Map(map.regions.filter(r => !r.unfinished && (r.id === homeId || r.kind === 'street' || r.id === 'graveyard:old_graveyard')).map(r => [r.id, r]));
  const portals = map.portals.filter(p => {
    const ra = allowed.get(p.a.regionId), rb = allowed.get(p.b.regionId);
    if (!ra || !rb || !Number.isInteger(p.width) || p.width < 1) return false;
    const a = lotTileToWorldTile(ra.placement, p.a.x, p.a.z), b = lotTileToWorldTile(rb.placement, p.b.x, p.b.z);
    return a !== null && b !== null && Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1;
  });
  const nodes = [...starts, ...portals.flatMap(p => [p.a, p.b])];
  const dist = nodes.map((_, i) => i < starts.length ? 0 : Infinity), done = new Set<number>();
  while (done.size < nodes.length) {
    let k = -1;
    for (let i = 0; i < nodes.length; i++) if (!done.has(i) && (k < 0 || dist[i] < dist[k])) k = i;
    if (k < 0 || !Number.isFinite(dist[k])) break;
    if (nodes[k].regionId === 'graveyard:old_graveyard') return dist[k];
    done.add(k);
    const a = nodes[k];
    for (let j = 0; j < nodes.length; j++) {
      const b = nodes[j]; let cost = Infinity;
      if (a.regionId === b.regionId) cost = a.regionId === homeId
        ? S.distanceField({ x: a.x + 0.5, z: a.z + 0.5 }).dist[b.z * state.lot.width + b.x]
        : Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
      else if (k >= starts.length && j >= starts.length && Math.floor((k - starts.length) / 2) === Math.floor((j - starts.length) / 2)) {
        const p = portals[Math.floor((k - starts.length) / 2)];
        if (!p.oneWay || (k - starts.length) % 2 === 0) cost = 1;
      }
      if (dist[k] + cost < dist[j]) dist[j] = dist[k] + cost;
    }
  }
  return Infinity;
}
