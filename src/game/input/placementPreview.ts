/**
 * The ONE verdict for build/buy placement (ghost colour, cursor label, keyboard announcement and the click that
 * follows): `sim.build.preview(cmd)` for the exact command a click would dispatch. It runs the same planner as
 * `sim.build.apply` (validation, not-for-sale, wall/opening rules) plus the funds rule ("Not enough money"), so a
 * green ghost always means the click applies and a red one always means it does not.
 *
 * The raw spatial checks (checkPlace / checkWallItem / checkOpening) must not decide validity on their own: they
 * know nothing about funds or the catalog, which is how a window could show green and then refuse the click.
 * They are only used here as a display fallback for footprint tiles / blocked-slot markers the plan omits (a
 * no-op move onto the object's own spot).
 */
import type { BuildCommand, BuildPreview, PlacementResult, SimulationAPI } from '../../sim/contracts';

export const CANT_PLACE = "Can't place here";

/** sim.build.preview, guarded and normalised: a throwing / malformed preview reads as "can't", never a crash. */
export function previewBuild(sim: SimulationAPI, cmd: BuildCommand): BuildPreview {
  try {
    const p = sim.build.preview(cmd);
    if (p && typeof p === 'object') {
      const out: BuildPreview = { ...p, ok: p.ok === true, cost: Number.isFinite(p.cost) ? p.cost : 0 };
      if (!out.ok && typeof out.reason !== 'string') out.reason = CANT_PLACE;
      return out;
    }
  } catch {
    /* fall through */
  }
  return { ok: false, reason: 'Preview unavailable', cost: 0 };
}

/**
 * Placement verdict for a buy / move / wall-item / opening command as a PlacementResult (what the ghost draws).
 * ok / reason / cost come from previewBuild(cmd) only; `display` may supply tiles / blocked slots for drawing.
 */
export function placementVerdict(
  sim: SimulationAPI,
  cmd: BuildCommand,
  display?: PlacementResult | null | (() => PlacementResult | null),
): PlacementResult {
  const p = previewBuild(sim, cmd);
  // The display fallback is evaluated lazily, only when the plan omitted tiles/slots (e.g. a no-op move), so a
  // re-validation costs one spatial check (inside the preview), not two — event floods stay coalesced.
  let shown: PlacementResult | null | undefined;
  const fallback = (): PlacementResult | null => {
    if (shown === undefined) shown = typeof display === 'function' ? display() : display ?? null;
    return shown;
  };
  const tiles = Array.isArray(p.tiles) ? p.tiles : (fallback()?.tiles ?? []);
  const blockedSlots = Array.isArray(p.blockedSlots) ? p.blockedSlots : (fallback()?.blockedSlots ?? []);
  return { ok: p.ok, reason: p.ok ? undefined : p.reason ?? CANT_PLACE, cost: p.cost, tiles, blockedSlots };
}
