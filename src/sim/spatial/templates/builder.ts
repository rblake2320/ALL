/**
 * LOT TEMPLATE BUILDER (SIM-SPATIAL) — helpers that assemble a fresh LotState + object list.
 *
 * Standard lot (GDD §15): 30 x 30 tiles; buildable x in [1,29), z in [1,27); sidewalk row z = 28 (street beyond z = 30);
 * entry points at the sidewalk ends (0.5, 28.5) and (29.5, 28.5); floors.length = 900 (null = grass).
 * Template objects carry no ids: the engine spawns them. Openings are listed as { kind: 'opening', edge } and the wall's
 * openingId is left null — call linkOpenings(state) after spawning (the spatial grid also resolves unlinked openings by
 * edge, so doors work either way).
 * Wall paint is assigned per side: a side facing a template room gets that room's wall style, every other side gets
 * DEFAULT_EXTERIOR_WALL (peeling siding).
 */
import type { LotState, ObjectPlacement, WallSegment, WorldState } from '../../types';
import type { Rot } from '../../../shared/dimensions';
import { DEFAULT_EXTERIOR_WALL } from '../../../shared/styles';
import { edgeKey, edgeSides, normalizeEdge, rectEdges } from '../edges';

export interface TemplateObject {
  defId: string;
  placement: ObjectPlacement;
  tint?: string | null;
}

export interface TemplateResult {
  lot: LotState;
  objects: TemplateObject[];
}

export interface TemplateRoom {
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floor: string;
  wall: string;
}

export const LOT_WIDTH = 30;
export const LOT_DEPTH = 30;
export const SIDEWALK_Z = 28;

export function newLot(): LotState {
  return {
    width: LOT_WIDTH,
    depth: LOT_DEPTH,
    buildable: { x0: 1, z0: 1, x1: 29, z1: 27 },
    sidewalkZ: SIDEWALK_Z,
    entryPoints: [
      { x: 0.5, z: SIDEWALK_Z + 0.5 },
      { x: LOT_WIDTH - 0.5, z: SIDEWALK_Z + 0.5 },
    ],
    walls: {},
    floors: new Array<string | null>(LOT_WIDTH * LOT_DEPTH).fill(null),
    version: 1,
    wallVersion: 1,
    floorVersion: 1,
  };
}

function roomAtTile(rooms: TemplateRoom[], x: number, z: number): TemplateRoom | null {
  for (const r of rooms) if (x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return r;
  return null;
}

/** Walls = union of every room rectangle's perimeter; floors filled per room; paint per side. */
export function buildRooms(lot: LotState, rooms: TemplateRoom[]): void {
  const keys = new Set<string>();
  for (const r of rooms) for (const e of rectEdges(r.x0, r.z0, r.x1, r.z1)) keys.add(e);
  for (const key of keys) {
    const [a, b] = edgeSides(key);
    const ra = roomAtTile(rooms, a.x, a.z);
    const rb = roomAtTile(rooms, b.x, b.z);
    const seg: WallSegment = {
      paint: [ra ? ra.wall : DEFAULT_EXTERIOR_WALL, rb ? rb.wall : DEFAULT_EXTERIOR_WALL],
      openingId: null,
    };
    lot.walls[key] = seg;
  }
  for (const r of rooms) fillFloor(lot, r.x0, r.z0, r.x1, r.z1, r.floor);
}

export function fillFloor(lot: LotState, x0: number, z0: number, x1: number, z1: number, style: string | null): void {
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) lot.floors[z * lot.width + x] = style;
}

export function floorObj(defId: string, x: number, z: number, rot: Rot, tint?: string | null): TemplateObject {
  return tint === undefined ? { defId, placement: { kind: 'floor', x, z, rot } } : { defId, placement: { kind: 'floor', x, z, rot }, tint };
}

export function wallObj(defId: string, kind: 'h' | 'v', x: number, z: number, side: 0 | 1, tint?: string | null): TemplateObject {
  const o: TemplateObject = { defId, placement: { kind: 'wall', edge: edgeKey(kind, x, z), side } };
  if (tint !== undefined) o.tint = tint;
  return o;
}

export function openingObj(defId: string, kind: 'h' | 'v', x: number, z: number, tint?: string | null): TemplateObject {
  const o: TemplateObject = { defId, placement: { kind: 'opening', edge: edgeKey(kind, x, z) } };
  if (tint !== undefined) o.tint = tint;
  return o;
}

/**
 * Point every wall's openingId at the spawned opening object on that edge (first by state.objects order) and clear
 * links that point at missing / non-opening objects. Returns the number of walls changed. Idempotent; does not bump
 * versions (call before the first spatial query, or bump lot.wallVersion yourself).
 */
export function linkOpenings(state: WorldState): number {
  const walls = state.lot && state.lot.walls;
  if (!walls) return 0;
  const byEdge = new Map<string, string>();
  for (const id in state.objects || {}) {
    const p = state.objects[id] && state.objects[id].placement;
    if (!p || p.kind !== 'opening') continue;
    const e = normalizeEdge(p.edge);
    if (e && !byEdge.has(e)) byEdge.set(e, id);
  }
  let changed = 0;
  for (const raw in walls) {
    const seg = walls[raw];
    if (!seg || typeof seg !== 'object') continue;
    const e = normalizeEdge(raw);
    const want = (e && byEdge.get(e)) || null;
    const cur = seg.openingId;
    const curObj = typeof cur === 'string' ? state.objects[cur] : undefined;
    const curOk = !!curObj && curObj.placement && curObj.placement.kind === 'opening' && normalizeEdge(curObj.placement.edge) === e;
    if (curOk) continue;
    if (cur !== want) {
      seg.openingId = want;
      changed++;
    }
  }
  return changed;
}
