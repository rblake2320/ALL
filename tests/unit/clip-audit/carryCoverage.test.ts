import { describe, expect, it } from 'vitest';
import { CARRY_ITEMS } from '../../../src/shared/appearance';
import { buildMatrix } from '../../../tools/clip-audit/scenarios';

describe('runtime carry coverage', () => {
  it('includes the actual standing seat fallbacks, with content provenance', () => {
    const matrix = buildMatrix();
    for (const key of ['floor:standEat+plate', 'floor:read+book']) {
      const scenario = matrix.find((s) => s.key === key);
      expect(scenario, key).toBeDefined();
      expect(scenario!.via.join(' '), key).toContain('fallback');
    }
    expect(matrix.some((s) => s.key === 'floor:sitRead+book')).toBe(false);
  });

  it('covers retained carries during movement and waiting, without inventing arbitrary action/item pairs', () => {
    const keys = new Set(buildMatrix().map((s) => s.key));
    for (const item of CARRY_ITEMS) for (const anim of ['walk', 'limp', 'crawl', 'idle']) {
      expect(keys.has(`floor:${anim}+${item}`), `${anim}+${item}`).toBe(true);
    }
    expect(keys.has('floor:standEat+brush')).toBe(false);
  });

  it('includes the required held limb for self/other stitching and the held-object stages after pickup', () => {
    const matrix = buildMatrix();
    const cases: Record<string, string> = {
      'floor:stitch+limb': 'home_stitchOther',
      'slot:table_stitchnmend#front:stitch+limb': 'home_stitchSelf',
      'slot:station_embalming#work:stitch+limb': 'home_limbStitch',
      'floor:pickup+limb': 'home_throwAwayLimb',
      'floor:pickup+plate': 'home_throwAwayFood',
      'slot:trash_lidded#use:pickup+pizza': 'home_throwAwayFood',
      'slot:fridge_humming#front:pickup+plate': 'home_putAwayLeftovers',
      'slot:sink_rusty#front:washHands+dish': 'home_cleanDish',
    };
    for (const [key, via] of Object.entries(cases)) {
      const sc = matrix.find((s) => s.key === key);
      expect(sc, key).toBeDefined();
      expect(sc!.via.join(' '), key).toContain(via);
    }
  });
});
