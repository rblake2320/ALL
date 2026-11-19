/**
 * W-013 pets state: creation and SEMANTIC healing of WorldState.pets (structure is the save validator's job,
 * src/persistence/validation/petsSchema.ts). Heal is a no-op on a world the game itself wrote.
 */
import type { PetsState, WorldState } from '../../types';

export function createPetsState(): PetsState {
  return { version: 1, nextId: 1, strays: [], pets: [], away: [], pending: [] };
}

/** Heal in place: a missing / unreadable block becomes empty; nextId moves past every id in use; duplicate ids dropped. */
export function healPetsState(state: WorldState): void {
  const ps = state.pets;
  if (ps && ps.version === 1 && !Array.isArray(ps.pending)) ps.pending = [];
  if (!ps || ps.version !== 1 || !Array.isArray(ps.strays) || !Array.isArray(ps.pets) || !Array.isArray(ps.away)) {
    state.pets = createPetsState();
    return;
  }
  const seen = new Set<string>();
  const fresh = <T extends { id: string }>(list: T[]): T[] => list.filter((x) => (seen.has(x.id.slice(1)) ? false : (seen.add(x.id.slice(1)), true)));
  ps.pets = fresh(ps.pets);
  ps.away = fresh(ps.away);
  ps.strays = fresh(ps.strays);
  let max = 0;
  for (const id of seen) max = Math.max(max, Number(id) || 0);
  if (!Number.isInteger(ps.nextId) || ps.nextId <= max) ps.nextId = max + 1;
}
