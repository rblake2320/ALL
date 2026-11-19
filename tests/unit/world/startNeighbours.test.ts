import { describe, expect, it } from 'vitest';
import FIXTURE from './fixtures/s7-neighbours-v1.json';
import { buildWorldMap, slotRegionId } from '../../../src/shared/mildewLane';
import { assignStartNeighbours } from '../../../src/shared/startNeighbours';
import type { StartPick } from '../../../src/shared/world';

describe('shared S7 neighbour assignments', () => {
  it('matches all 50 frozen generator outputs used by Astra before this integration', () => {
    for (const row of FIXTURE.rows) {
      const home = slotRegionId(row.pick.slotId);
      const map = buildWorldMap({ seed: row.seed, genVersion: 1, contentVersion: 1 }, { regionId: home, templateId: row.pick.templateId });
      const before = structuredClone(map);
      assignStartNeighbours(map, home, row.pick as StartPick);
      for (const [id, template] of Object.entries(row.neighbours)) {
        expect(map.regions.find((r) => r.id === id)?.templateId, `seed ${row.seed}, ${id}`).toBe(template);
      }
      // The shared assignment changes neither navigation topology nor any region's world placement.
      expect({ ...map, regions: map.regions.map((r) => ({ ...r, templateId: null })) }).toEqual({ ...before, regions: before.regions.map((r) => ({ ...r, templateId: null })) });
      expect(map.regions.find((r) => r.id === home)).toEqual(before.regions.find((r) => r.id === home));
    }
  });
  it('a legacy home gets a deterministic canonical pool; malformed saved picks fail before changing the map', () => {
    const home = 'wormwood:mildew_n2';
    const make = () => buildWorldMap({ seed: 923, genVersion: 1, contentVersion: 1 }, { regionId: home, templateId: null });
    expect(assignStartNeighbours(make(), home, null)).toEqual(assignStartNeighbours(make(), home, null));
    const map = make(), before = structuredClone(map);
    expect(() => assignStartNeighbours(map, home, { ...FIXTURE.rows[0].pick, genVersion: 99 } as StartPick)).toThrow();
    expect(map).toEqual(before);
  });
});
