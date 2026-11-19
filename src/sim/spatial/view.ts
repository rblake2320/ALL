/**
 * REGION VIEWS (SIM-SPATIAL, W-025 S3; docs/DESIGN_WORLD_LEVELS.md §1.5 / §1.7).
 *
 * A spatial service is built over a `WorldState`-shaped object. The home region's service reads `WorldState` itself;
 * every other active region's service reads a VIEW: a stable object whose `lot` is that region's lot-local grid and
 * which carries a `regionView` descriptor. Objects of all active regions live in the one `state.objects` map
 * (`ObjectState.regionId`, absent = home), so every spatial loop over objects keeps only the objects of its own region:
 *  - the home service (no descriptor) keeps objects WITHOUT `regionId` (all of them in a home-only world, so the home
 *    grid is byte-identical to the pre-world one);
 *  - a region view keeps objects whose `regionId` equals the view's id.
 *
 * The descriptor also carries the two S3 path rules a region may need:
 *  - `privacy`: the PUBLIC step mask of a neighbour's residential lot (§1.7 item 4): every door with an indoor room on
 *    either side is closed (`WALL_PRIVATE`). The RESIDENT mask is the same view without `privacy`. Yard gates (doors
 *    between two outdoor tiles) stay open, so the yard is walkable;
 *  - `stepCost`: extra cost per tile entered (row-major), e.g. +2 on road and curb tiles of a street so routes use the
 *    crosswalks (§1.5 ownership table). Never set on the home.
 */
import type { ObjectState, WorldState } from '../types';

export interface SpatialRegionView {
  /** Region whose objects this view shows (`ObjectState.regionId`). */
  id: string;
  /** Public mask: doors into indoor rooms are closed. */
  privacy: boolean;
  /** Extra cost per entered tile (length w*d), or null. */
  stepCost: ArrayLike<number> | null;
}

/** The region descriptor of a state view (null for the home: `WorldState` itself). */
export function regionViewOf(state: WorldState | null | undefined): SpatialRegionView | null {
  if (!state) return null;
  const v = (state as WorldState & { regionView?: unknown }).regionView;
  return v && typeof v === 'object' && typeof (v as SpatialRegionView).id === 'string' ? (v as SpatialRegionView) : null;
}

/** Predicate "this object belongs to the grid of this state / view" (computed once per loop). */
export function objectFilterOf(state: WorldState | null | undefined): (o: ObjectState) => boolean {
  const v = regionViewOf(state);
  if (!v) return (o) => o.regionId === undefined;
  const id = v.id;
  return (o) => o.regionId === id;
}
