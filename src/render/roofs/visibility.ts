/**
 * Roofs and ceilings, part 3: WHAT SHOWS WHEN (owner rules, docs/contract-requests/roofs-views.md, replacing the first
 * answers). PURE: the rules as a function of the view, plus the fade, so they are testable without a GPU.
 *
 *  1. From above (overview, shoulder) NO roof is drawn on the player's lot: every building on it is the player's own home
 *     ("your own building, or your household's home"), whoever is where. First person keeps every roof (eyes at ground level).
 *  2. Buildings OFF the lot (neighbours) keep their roofs always; they are not part of this layer.
 *  3. Inside, in the shoulder or first-person view, the CEILING of the room you are in is shown (it is seen when you look up).
 *     It is never faded out by a rule. A ceiling faces down, so from the overview (above) it is invisible by itself and the
 *     layer simply does not draw it there.
 *  4. Build and Buy: no roof and no ceiling on this lot (every building on the household's lot is the player's own home, and
 *     the player must see in). Neighbouring buildings off the lot are not part of this layer.
 *  5/6. Floor levels (not in the sim yet): a building has `levels` storeys; its roof sits on the top one and ceilings are per
 *     level, so the layer is level-aware by design (the viewed level shows itself and the levels below it).
 *
 * The player's wall mode (up, cutaway, down) only changes walls and is deliberately NOT an input here.
 */
import type { Perspective, ViewMode } from '../contracts';
import type { Building } from './footprint';

export interface RoofView {
  viewMode: ViewMode;
  perspective: Perspective;
  /** The building the selected (or followed) zombie stands in, or -1 for outdoors or nobody. */
  subjectBuilding: number;
}

/** Target opacity 0..1 of one building's roof and ceiling. */
export interface RoofTarget {
  roof: number;
  ceiling: number;
}

export function roofTargets(buildings: readonly Building[], view: RoofView): RoofTarget[] {
  return buildings.map((b) => {
    if (view.viewMode !== 'live') return { roof: 0, ceiling: 0 }; // rule 4: Build and Buy
    const inside = b.id === view.subjectBuilding;
    // first person: the eyes are at ground level under the roof, and a roof is not seen from below, so every roof stays
    if (view.perspective === 'firstPerson') return { roof: 1, ceiling: inside ? 1 : 0 };
    // from above (overview, shoulder) every building on this lot is the player's own home: NO roof, whoever is where.
    // The subject only decides whose ceiling is shown (rule 3, shoulder: the room you are in; overview: none, invisible from above).
    return { roof: 0, ceiling: view.perspective === 'shoulder' && inside ? 1 : 0 };
  });
}

export const FADE_SECONDS = 0.25;

/** One step of the fade: a straight line over FADE_SECONDS (0.25 s), no pop, never past the target, safe for a bad dt. */
export function fadeStep(current: number, target: number, dt: number, seconds = FADE_SECONDS): number {
  const c = Number.isFinite(current) ? Math.max(0, Math.min(1, current)) : target;
  const t = Math.max(0, Math.min(1, target));
  if (!(dt > 0) || !Number.isFinite(dt)) return c;
  const step = dt / Math.max(1e-6, seconds);
  return c < t ? Math.min(t, c + step) : Math.max(t, c - step);
}

/** A mesh is drawn only while it is at all visible: at 0 it costs no draw call. */
export const drawn = (opacity: number): boolean => opacity > 0.001;
