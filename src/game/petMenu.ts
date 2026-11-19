/**
 * The click menu of a stray or a household pet (W-013). The engine's interaction menu belongs to objects and zombies;
 * animals are not in it, so this builds the same `MenuEntry` rows from the world's `pets` block and Gameplay
 * dispatches the choice as a `{ type: 'pet' }` command (the pets system validates it again). Strays offer Chase,
 * Offer Scraps, Befriend, Pet and Adopt; pets offer Feed, Play and Cuddle. Names come from the sim's preset name
 * pools, so a child profile never types a pet name.
 */
import type { MenuEntry } from '../sim/contracts';
import type { PetsState, WorldState } from '../sim/types';
import { HOUSEHOLD_PET_CAP } from '../shared/petLimits';

export const PET_ENTRY_PREFIX = '__pet:';
/** Trust needed to adopt (src/sim/systems/pets PET_ADOPT_TRUST); the sim enforces it, the label only explains it. */
const ADOPT_TRUST = 70;
const SNACK_COST = 5;

export type PetTargetKind = 'stray' | 'pet';

const SPECIES_WORD: Readonly<Record<string, string>> = { cat: 'cat', dog: 'dog', raccoon: 'raccoon', crow: 'crow' };

function entry(action: string, key: 'strayId' | 'petId', id: string, label: string, icon: MenuEntry['icon'], available = true, reason: string | null = null, cost: number | null = null): MenuEntry {
  return { interactionId: `${PET_ENTRY_PREFIX}${action}`, label, group: null, icon, available, reason, cost, params: { action, [key]: id } };
}

/** Title and rows for the animal `id`; null when it is not there (any more). */
export function petMenuFor(world: Pick<WorldState, 'pets'>, kind: PetTargetKind, id: string): { title: string; entries: MenuEntry[]; x: number; z: number } | null {
  const ps: PetsState | undefined = world.pets;
  if (!ps) return null;
  if (kind === 'stray') {
    const s = ps.strays.find((x) => x.id === id);
    if (!s) return null;
    const trust = Math.floor(s.trust);
    const full = ps.pets.length >= HOUSEHOLD_PET_CAP;
    const canAdopt = !full && s.trust >= ADOPT_TRUST;
    return {
      title: `${s.name} the ${SPECIES_WORD[s.species] ?? s.species} · trust ${trust}/${ADOPT_TRUST}`,
      x: s.pos.x,
      z: s.pos.z,
      entries: [
        entry('offerScraps', 'strayId', id, 'Offer Scraps', 'plate', true, null, SNACK_COST),
        entry('befriend', 'strayId', id, 'Befriend', 'heart'),
        entry('pet', 'strayId', id, 'Pet', 'happy'),
        entry('adopt', 'strayId', id, 'Adopt', 'house', canAdopt, full ? `The household already has ${HOUSEHOLD_PET_CAP} or more pets` : canAdopt ? null : `Needs trust ${ADOPT_TRUST} (now ${trust})`),
        entry('chase', 'strayId', id, 'Chase', 'exclamation'),
      ],
    };
  }
  const p = ps.pets.find((x) => x.id === id);
  if (!p) return null;
  return {
    title: `${p.name} the ${SPECIES_WORD[p.species] ?? p.species}`,
    x: p.pos.x,
    z: p.pos.z,
    entries: [
      entry('feed', 'petId', id, 'Feed', 'plate', true, null, SNACK_COST),
      entry('play', 'petId', id, 'Play', 'game'),
      entry('cuddle', 'petId', id, 'Cuddle', 'heart'),
    ],
  };
}

/** The `{ type: 'pet' }` command for a chosen row, or null if the row is not a pet row. */
export function petCommandFor(entry: MenuEntry, agentId: string): Record<string, unknown> | null {
  if (typeof entry.interactionId !== 'string' || !entry.interactionId.startsWith(PET_ENTRY_PREFIX)) return null;
  const { action, strayId, petId } = entry.params as Record<string, string | undefined>;
  if (typeof action !== 'string') return null;
  return { type: 'pet', action, agentId, ...(typeof strayId === 'string' ? { strayId } : {}), ...(typeof petId === 'string' ? { petId } : {}) };
}

/** Hover text for an animal. */
export function petHoverLabel(world: Pick<WorldState, 'pets'>, kind: PetTargetKind, id: string): string {
  const m = petMenuFor(world, kind, id);
  return m ? m.title : 'Animal';
}
