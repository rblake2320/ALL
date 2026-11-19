/**
 * The living diorama behind the main menu: a fixed-seed starter lot with three seeded random zombies running at
 * 1× with full autonomy while the camera slowly orbits. It is never saved, makes no sound and shows no UI.
 * If the simulation cannot build it (module missing / throwing), the menu simply shows an empty scene.
 */
import type { NewGameOptions, SimulationAPI } from '../sim/contracts';
import type { Vec2 } from '../sim/types';
import type { SimModule } from './simTypes';
import type { CazCatalog } from './gddCatalog';
import type { CastBodyId } from '../shared/cast';
import { randomHousehold, withBody } from './randomZombie';

export const DEMO_SEED = 0x0a11fe55;
export const DEMO_MEMBERS = 3;
/** Rebuild the demo after this long on the menu so it never drifts into an unpleasant state (power cut, repo). */
/** One cast body per category (zombie / boss / freshly turned) so the menu shows the sculpted cast immediately. */
export const DEMO_BODIES: readonly CastBodyId[] = ['bride', 'ringmaster', 'jogger'];
export const DEMO_MAX_AGE_MS = 20 * 60_000;

export function demoOptions(catalog: CazCatalog): NewGameOptions {
  const { householdName, members } = randomHousehold(DEMO_SEED, catalog, DEMO_MEMBERS);
  return {
    seed: DEMO_SEED,
    householdName,
    members: members.map((m, i) => ({ ...m, appearance: withBody(m.appearance, DEMO_BODIES[i % DEMO_BODIES.length] ?? null) })),
    lotTemplate: catalog.lotTemplateIds.includes('starter') ? 'starter' : (catalog.lotTemplateIds[0] as NewGameOptions['lotTemplate']),
    difficulty: 'relaxed',
  };
}

export function createDemoSim(sim: SimModule, catalog: CazCatalog): SimulationAPI {
  const world = sim.createNewWorld(demoOptions(catalog));
  const api = sim.createSimulation(world);
  api.dispatch({ type: 'setSettings', settings: { autonomy: 'full' } });
  return api;
}

/** Centre of the house (indoor rooms), else the lot centre — camera focus for the menu and new games. */
export function houseCenter(sim: SimulationAPI): Vec2 {
  try {
    const width = sim.spatial.width();
    const depth = sim.spatial.depth();
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (const room of sim.spatial.rooms()) {
      if (!room.indoor) continue;
      for (const idx of room.tiles) {
        if (!Number.isInteger(idx) || idx < 0) continue;
        sx += (idx % width) + 0.5;
        sz += Math.floor(idx / width) + 0.5;
        n++;
      }
    }
    if (n > 0) return { x: sx / n, z: sz / n };
    if (Number.isFinite(width) && Number.isFinite(depth) && width > 0 && depth > 0) return { x: width / 2, z: depth / 2 };
  } catch {
    /* fall through */
  }
  const lot = sim.state?.lot;
  return { x: (lot?.width ?? 30) / 2, z: (lot?.depth ?? 30) / 2 };
}
