/** S7 version-1 neighbour assignment, shared by generation, simulation and rendering. Keep pool/order/salt frozen. */
import { RESIDENTIAL_SLOTS, slotOfRegionId, slotRegionId } from './mildewLane';
import { hash32, type RegionId, type StartPick, type WorldMap } from './world';

export const START_NEIGHBOUR_POOL_V1 = ['starter', 'starter', 'wormwood_bungalow', 'wormwood_bungalow', 'wormwood_townhouse', 'wormwood_townhouse', 'empty'] as const;

/** Bounds of the actual authored templates, in lot-local tiles; shell origins/doors must match their colliders. */
export const START_TEMPLATE_BOUNDS_V1: Readonly<Record<string, { x0: number; x1: number; z0: number; z1: number; doorX: number }>> = {
  starter: { x0: 9, x1: 20, z0: 9, z1: 19, doorX: 14.5 },
  wormwood_bungalow: { x0: 7, x1: 20, z0: 11, z1: 20, doorX: 10.5 },
  wormwood_townhouse: { x0: 11, x1: 18, z0: 6, z1: 21, doorX: 14.5 },
};

/** Mutate only template IDs on a freshly built map. A legacy home with no saved pick uses the canonical seed-0 pool.
 * No home layout, portal, placement, RNG or persisted state changes here. Unknown saved generators fail closed.
 */
export function assignStartNeighbours(map: WorldMap, homeId: RegionId, pick: StartPick | null | undefined): WorldMap {
  const homeSlot = slotOfRegionId(homeId);
  if (!homeSlot) return map;
  if (pick && (pick.genVersion !== 1 || pick.slotId !== homeSlot || !Number.isInteger(pick.neighbourSeed) || pick.neighbourSeed < 0 || pick.neighbourSeed > 0xffffffff)) {
    throw new Error('Unsupported or mismatched saved neighbour assignment');
  }
  const seed = pick?.neighbourSeed ?? 0;
  const pool: string[] = [...START_NEIGHBOUR_POOL_V1];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = hash32(seed, 21, i) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let n = 0;
  for (const slot of RESIDENTIAL_SLOTS) {
    if (slot === homeSlot) continue;
    const region = map.regions.find((r) => r.id === slotRegionId(slot));
    if (!region || region.kind !== 'lot') throw new Error(`Missing residential slot: ${slot}`);
    region.templateId = pool[n++];
  }
  return map;
}
