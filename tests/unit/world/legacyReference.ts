/** Historical compatibility only. Full current-state save/replay hashes remain unprojected. */
import { newHomeServicesState } from '../../../src/shared/homeServices';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { savePayloadSha256 } from '../../../src/persistence/saveManager';
import { timeInfo } from '../../../src/sim/time';
import type { WorldState } from '../../../src/sim/types';

/** #105 adds an inert accounting block even to older worlds. Never omit actual feature progress. */
export function legacyReferenceWorld(world: WorldState): WorldState {
  const copy = JSON.parse(JSON.stringify(world)) as WorldState;
  if (copy.homeBuild !== undefined) throw new Error('Legacy reference requires home building disabled');
  const hs = copy.homeServices;
  if (hs) {
    const empty = { ...newHomeServicesState(), essenceDay: hs.essenceDay };
    if (!Number.isInteger(hs.essenceDay) || hs.essenceDay < -1 || hs.essenceDay > timeInfo(copy.tick).day || canonicalJson(hs) !== canonicalJson(empty)) {
      throw new Error('Active or malformed home services must remain in full-state comparisons');
    }
    delete copy.homeServices;
  }
  return copy;
}
export const legacyReferenceHash = (world: WorldState): string => savePayloadSha256(legacyReferenceWorld(world));
