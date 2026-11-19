/**
 * W-073: a floor-kind Bayou model must stay on its own tiles, or it intersects whatever stands on the next one.
 * The level kit's validator allows 15% overhang, which let tree_cypress (56 mm) and platform_viewing (22 mm)
 * through. This holds every Bayou floor model to 5 mm.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Entry {
  id: string; kind: string; tileFootprint: [number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}
const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'public', 'assets', 'manifest.bayou.json'), 'utf8'),
) as { models: Entry[] };
const FLOOR = MANIFEST.models.filter((e) => e.kind === 'floor');

/** Millimetres by which the model's bounds exceed its footprint rectangle (negative = inside). */
const overhang = (e: Entry): number =>
  Math.round(1000 * Math.max(
    Math.max(-e.bounds.min[0], e.bounds.max[0]) - e.tileFootprint[0] / 2,
    Math.max(-e.bounds.min[2], e.bounds.max[2]) - e.tileFootprint[1] / 2,
  ));

describe('Bayou floor models stay on their tiles (W-073)', () => {
  it('no floor model reaches more than 5 mm past its footprint', () => {
    expect(FLOOR.length).toBeGreaterThan(15);
    expect(FLOOR.map((e) => [e.id, overhang(e)] as const).filter(([, mm]) => mm > 5)).toEqual([]);
  });

  it('the cypress and the viewing platform, the two that were over, are inside', () => {
    for (const id of ['tree_cypress', 'platform_viewing']) {
      const e = FLOOR.find((m) => m.id === id);
      expect(e, id).toBeDefined();
      expect(overhang(e!)).toBeLessThanOrEqual(5);
    }
  });
});
