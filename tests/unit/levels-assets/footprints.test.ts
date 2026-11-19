/**
 * W-073 clipping request C (docs/contract-requests/clipping.md): a floor-kind level model must stay on its own
 * tiles. A model that reaches onto the next tile intersects whatever is placed there.
 *
 * The level kit's own validator allows 15% overhang, which let six graveyard models through (tree_willow 222 mm,
 * pond_murky 148, stairs_crypt 100, board_notice 46, rack_tools 20, den_stray_raccoon 19). This test holds the
 * whole manifest.levels.json kit to 5 mm.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Entry {
  id: string; level: string; kind: string; footprint?: [number, number]; tileFootprint?: [number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}
const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'public', 'assets', 'manifest.levels.json'), 'utf8'),
) as { models: Entry[] };
const FLOOR = MANIFEST.models.filter((e) => e.kind === 'floor');
const TOLERANCE = 0.005;

/** Metres by which the model's bounds exceed its footprint rectangle (negative = inside). */
function overhang(e: Entry): number {
  const fp = (e.tileFootprint ?? e.footprint)!;
  return Math.max(
    Math.max(-e.bounds.min[0], e.bounds.max[0]) - fp[0] / 2,
    Math.max(-e.bounds.min[2], e.bounds.max[2]) - fp[1] / 2,
  );
}

describe('level kit floor models stay on their tiles (W-073 request C)', () => {
  it('the kit has floor models, each with a footprint', () => {
    expect(FLOOR.length).toBeGreaterThan(30);
    for (const e of FLOOR) expect(e.tileFootprint ?? e.footprint, e.id).toHaveLength(2);
  });

  it('no floor model reaches more than 5 mm past its footprint', () => {
    const over = FLOOR.map((e) => [e.id, Math.round(overhang(e) * 1000)] as const).filter(([, mm]) => mm > TOLERANCE * 1000);
    expect(over).toEqual([]);
  });

  it.each(['tree_willow', 'pond_murky', 'stairs_crypt', 'board_notice', 'rack_tools', 'den_stray_raccoon'])(
    '%s, one of the six the audit named, is inside its footprint',
    (id) => {
      const e = FLOOR.find((m) => m.id === id);
      expect(e, id).toBeDefined();
      expect(overhang(e!)).toBeLessThanOrEqual(TOLERANCE);
    },
  );
});
