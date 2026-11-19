/** Cast body UI helpers: grouping, thumbnails/crops, option applicability, i18n coverage, picker keyboard nav. */
import { describe, expect, it } from 'vitest';
import { CAST_BODIES, CAST_BODY_IDS, SCULPTED_BODIES, SCULPTED_BODY_IDS } from '../../../src/shared/cast';
import { PREMIUM_BODY_IDS } from '../../../src/shared/premiumBodies';
import { defaultAppearance } from '../../../src/shared/appearance';
import { en } from '../../../src/i18n/en';
import {
  CAST_CATEGORY_ORDER,
  castBodyOf,
  castFaceCrop,
  castGroups,
  castThumbUrl,
  faceCropRect,
  lookOptionApplies,
  type CazLookOption,
} from '../../../src/ui/common/castArt';
import { spatialNeighbor, type TileRect } from '../../../src/ui/shell/screens/caz/bodyNav';

const dict = en as Record<string, string>;

describe('castArt', () => {
  it('groups every sculpted body by category in Premium / Zombies / Bosses / Freshly Turned order, none lost or duplicated', () => {
    const g = castGroups();
    expect(g.map((x) => x.category)).toEqual(['premium', 'zombie', 'boss', 'turned']);
    const ids = g.flatMap((x) => x.bodies.map((b) => b.id));
    expect(ids.slice().sort()).toEqual([...SCULPTED_BODY_IDS].sort());
    expect(new Set(ids).size).toBe(30);
    // the cast kit is still exactly the 25: the last three groups hold it, the first holds the premium bodies
    expect(g.slice(1).flatMap((x) => x.bodies.map((b) => b.id)).sort()).toEqual([...CAST_BODY_IDS].sort());
    expect(g[0].bodies.map((b) => b.id)).toEqual([...PREMIUM_BODY_IDS]);
    for (const grp of g) for (const b of grp.bodies) expect(b.category).toBe(grp.category);
    expect(CAST_CATEGORY_ORDER).toHaveLength(new Set(SCULPTED_BODIES.map((b) => b.category)).size);
  });
  it('castBodyOf reads only real cast ids', () => {
    expect(castBodyOf({ ...defaultAppearance(), body: 'gold' })).toBe('gold');
    for (const v of [undefined, null, 'classic', 'dragon', 3, {}, '__proto__']) expect(castBodyOf({ body: v } as never)).toBeNull();
    expect(castBodyOf(null)).toBeNull();
    expect(castBodyOf(undefined)).toBeNull();
    expect(castBodyOf('walker' as never)).toBeNull();
  });
  it('thumbnail URLs are relative to the Vite base and the public asset layout', () => {
    for (const id of CAST_BODY_IDS) expect(castThumbUrl(id)).toMatch(new RegExp(`assets/ui/cast/${id}\\.webp$`));
  });
  it('face crops centre the face inside the portrait circle', () => {
    for (const id of CAST_BODY_IDS) {
      const c = castFaceCrop(id);
      const r = faceCropRect(c);
      expect(r.w).toBeGreaterThan(100); // zoomed in (bust → face)
      expect(r.x + c.fx * r.w).toBeCloseTo(50);
      expect(r.y + c.fy * r.h).toBeCloseTo(50);
      // the face point lies inside the image and the frame centre is always covered (transparent thumbnails sit
      // on the portrait's own background, so edge coverage is not required)
      expect(c.fx).toBeGreaterThan(0.2);
      expect(c.fx).toBeLessThan(0.8);
      expect(c.fy).toBeGreaterThan(0.1);
      expect(c.fy).toBeLessThan(0.6);
      expect(r.w).toBeLessThan(300);
    }
  });
  it('per shared/cast.ts + cast.md: cast bodies keep height + voice, grey everything else (no eye material); classic keeps all', () => {
    const all: CazLookOption[] = ['height', 'build', 'skinTone', 'eyeStyle', 'eyeColor', 'stitches', 'hair', 'outfit', 'accessory', 'voice'];
    for (const o of all) expect(lookOptionApplies(null, o)).toBe(true);
    for (const id of CAST_BODY_IDS) {
      expect(lookOptionApplies(id, 'height')).toBe(true);
      expect(lookOptionApplies(id, 'voice')).toBe(true);
      for (const o of ['build', 'skinTone', 'eyeStyle', 'eyeColor', 'stitches', 'hair', 'outfit', 'accessory'] as const) expect(lookOptionApplies(id, o)).toBe(false);
    }
  });
});

describe('i18n', () => {
  it('every body has a name + blurb (cast.<id>, cast.<id>.blurb) matching the contract, plus categories + classic', () => {
    for (const b of CAST_BODIES) {
      expect(dict[`cast.${b.id}`]).toBe(b.name);
      expect(dict[`cast.${b.id}.blurb`]).toBe(b.blurb);
    }
    for (const c of CAST_CATEGORY_ORDER) expect(dict[`cast.category.${c}`]).toBeTruthy();
    for (const k of ['cast.classic', 'cast.classic.blurb', 'caz.bodyType', 'caz.bodyTypeHint', 'caz.castLocked', 'caz.castUseClassic', 'caz.castLockedShort', 'caz.castHeightHint', 'caz.castThumbMissing'])
      expect(dict[k]).toBeTruthy();
    expect(dict['caz.castLocked']).toContain('{name}');
  });
});

describe('body picker spatial navigation', () => {
  // Layout: classic alone in row 0; a group of 5 in rows 1-2 (3 per row); a group of 2 in row 3.
  const tile = (col: number, row: number): TileRect => ({ x: col * 80, y: row * 100, w: 76, h: 90 });
  const rects = [tile(0, 0), tile(0, 1), tile(1, 1), tile(2, 1), tile(0, 2), tile(1, 2), tile(0, 3), tile(1, 3)];
  it('left/right follow reading order and clamp at the ends', () => {
    expect(spatialNeighbor(rects, 0, 'ArrowRight')).toBe(1);
    expect(spatialNeighbor(rects, 3, 'ArrowRight')).toBe(4);
    expect(spatialNeighbor(rects, 7, 'ArrowRight')).toBe(7);
    expect(spatialNeighbor(rects, 0, 'ArrowLeft')).toBe(0);
  });
  it('up/down jump to the nearest row (across groups) and the closest column', () => {
    expect(spatialNeighbor(rects, 0, 'ArrowDown')).toBe(1);
    expect(spatialNeighbor(rects, 3, 'ArrowDown')).toBe(5); // col 2 → row 2 has only cols 0-1: nearest is col 1
    expect(spatialNeighbor(rects, 5, 'ArrowDown')).toBe(7);
    expect(spatialNeighbor(rects, 7, 'ArrowDown')).toBe(7);
    expect(spatialNeighbor(rects, 6, 'ArrowUp')).toBe(4);
    expect(spatialNeighbor(rects, 2, 'ArrowUp')).toBe(0);
    expect(spatialNeighbor(rects, 0, 'ArrowUp')).toBe(0);
  });
  it('garbage geometry and indices never throw or escape the range', () => {
    expect(spatialNeighbor([], 3, 'ArrowDown')).toBe(0);
    expect(spatialNeighbor(rects, -4, 'ArrowDown')).toBe(1);
    expect(spatialNeighbor(rects, 99, 'ArrowLeft')).toBe(0);
    const bad = [...rects];
    bad[1] = { x: NaN, y: NaN, w: 1, h: 1 };
    expect(spatialNeighbor(bad, 0, 'ArrowDown')).toBe(2);
    expect(spatialNeighbor(bad, 1, 'ArrowDown')).toBe(1);
  });
});
