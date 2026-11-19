/**
 * Home build rules inside the spatial placement check (src/shared/homeBuild.ts; docs/contract-requests/
 * home-build-system.md section 4 step 2). Only worlds that carry `state.homeBuild` are affected (new games with
 * "snap-point building" on; old saves and every test world keep the free placement they always had).
 *
 *  - Snap mode (the first 20 placed items): a floor / garden object must stand on a snap tile, a wall item on a snap edge.
 *  - Caps: the tier's decoration budget and service points refuse further objects with a typed, player-facing reason.
 *  - Moving an object (ignoreObjectId set) is never refused by these rules: it is already counted.
 * The base placement check (collisions, walls, outside the lot ...) always runs first and wins.
 */
import { PHYSICAL_BY_ID } from '../../shared/catalog';
import { canPlace, isSnapSpot, serviceOf, snapKindFor, type PlaceableInfo, type PlacedItem, type PlaceCheck, type SnapKind } from '../../shared/homeBuild';
import type { PlacementResult } from '../contracts';
import type { WorldState } from '../types';
import { buildHomeObjects } from './build/region';

const info = (defId: string): PlaceableInfo | undefined => PHYSICAL_BY_ID[defId];

/** The objects that count towards the home's caps and sets: standing floor and wall objects of the catalogue. */
export function placedItems(state: WorldState): PlacedItem[] {
  const out: PlacedItem[] = [];
  const objs = buildHomeObjects(state);
  for (const id in objs) {
    const o = objs[id];
    const k = o?.placement?.kind;
    if ((k === 'floor' || k === 'wall') && info(o.defId)) out.push({ id, defId: o.defId });
  }
  return out;
}

/** Apply the home build rules to a placement the base check accepted. */
export function applyHomeBuildRules(state: WorldState, base: PlacementResult, defId: string, at: { x: number; z: number } | { edge: string }, ignoreObjectId?: string | null): PlacementResult {
  const hb = state.homeBuild;
  if (!hb || !base.ok || ignoreObjectId) return base;
  const obj = info(defId);
  if (!obj) return base;
  const kind = snapKindFor(obj);
  const spot: SnapKind | null = isSnapSpot(kind, at) ? kind : null;
  // in snap mode the question is "is this one of the snap points of the item's kind?" (null = no snap point here)
  const check: PlaceCheck = canPlace(hb, placedItems(state), obj, info, spot);
  if (check.ok) return base;
  return { ...base, ok: false, reason: check.message };
}

/** Every snap point where `base(spot)` accepts the object, for the markers in Build mode. */
export function snapSpots(
  state: WorldState,
  defId: string,
  checkFloor: (x: number, z: number) => PlacementResult,
  checkWall: (edge: string, side: 0 | 1) => PlacementResult,
): { kind: SnapKind | 'service'; x: number; z: number; edge?: string; side?: 0 | 1 }[] {
  const obj = info(defId);
  if (!obj) return [];
  const kind = snapKindFor(obj);
  const marker: SnapKind | 'service' = serviceOf(defId) ? 'service' : kind;
  const out: { kind: SnapKind | 'service'; x: number; z: number; edge?: string; side?: 0 | 1 }[] = [];
  if (obj.placement === 'floor' || obj.placement === 'item') {
    const w = state.lot?.width ?? 0;
    const d = state.lot?.depth ?? 0;
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if (!isSnapSpot(kind, { x, z })) continue;
        if (checkFloor(x, z).ok) out.push({ kind: marker, x: x + 0.5, z: z + 0.5 });
      }
    }
  } else if (obj.placement === 'wall') {
    for (const edge of Object.keys(state.lot?.walls ?? {})) {
      if (!isSnapSpot('wall', { edge })) continue;
      const m = /^([hv]):(-?\d+):(-?\d+)$/.exec(edge);
      if (!m) continue;
      const ex = Number(m[2]);
      const ez = Number(m[3]);
      for (const side of [0, 1] as const) {
        if (checkWall(edge, side).ok) out.push({ kind: 'wall', x: m[1] === 'h' ? ex + 0.5 : ex, z: m[1] === 'h' ? ez : ez + 0.5, edge, side });
      }
    }
  }
  return out;
}
