/**
 * Home services state: creation and SEMANTIC healing of WorldState.homeServices (structure is the save validator's job,
 * src/persistence/validation/homeServicesSchema.ts). Heal is a no-op on a world the game itself wrote.
 */
import { MAX_BUILD_ID, MAX_SAVED_BUILDS, buildIdNumber, isBuildId, newHomeServicesState, newWardrobe, type WardrobeState } from '../../../shared/homeServices';
import type { WorldState } from '../../types';

export const createHomeServicesState = newHomeServicesState;

/** Heal in place: a missing or unreadable block becomes empty; wardrobes of zombies that are gone are dropped; ids stay unique. */
export function healHomeServicesState(state: WorldState): void {
  const hs = state.homeServices;
  if (!hs || hs.version !== 1) {
    state.homeServices = createHomeServicesState();
    return;
  }
  const members = new Set(state.household?.memberIds ?? []);
  const wardrobe: Record<string, WardrobeState> = {};
  for (const id of Object.keys(hs.wardrobe).sort()) {
    if (!members.has(id)) continue;
    const w = hs.wardrobe[id] ?? newWardrobe();
    const seen = new Set<string>();
    // only canonical ids survive, each once; the next id is finite, schema-valid and above every id ever seen
    const slots = w.slots.filter((s) => isBuildId(s.id) && (seen.has(s.id) ? false : (seen.add(s.id), true))).slice(0, MAX_SAVED_BUILDS);
    let max = 0;
    for (const s of slots) max = Math.max(max, buildIdNumber(s.id) ?? 0);
    const given = Number.isInteger(w.nextId) && w.nextId >= 1 ? w.nextId : 1;
    wardrobe[id] = { slots, activeId: slots.some((s) => s.id === w.activeId) ? w.activeId : null, lastSwapTick: w.lastSwapTick, nextId: Math.min(MAX_BUILD_ID + 1, Math.max(given, max + 1)) };
  }
  hs.wardrobe = wardrobe;
}
