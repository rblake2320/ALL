/**
 * W-113 story start: the `derelict` lot template ("The Condemned Shack on Mildew Lane", docs/systems/story-start.md §3).
 * Valid and reachable like the other templates, but MOSTLY BARE: a coffin to sleep in, a table + chair, a sink — no
 * kitchen appliance, no shower — one interior partition, a mailbox and one dead tree outside. Adversarial checks
 * included (mutation isolation, seed independence, every-object validity).
 */
import { describe, expect, it } from 'vitest';
import { createLotTemplate, createSpatial, edgeSides, LOT_TEMPLATE_INFO } from '../../../src/sim/spatial';
import { createNewWorld, loadContent } from '../../../src/sim/index';
import type { ObjectState } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { makeContent, templateWorld } from './fixtures';

const content = makeContent();
const real = loadContent();

function spatialFor() {
  const state = templateWorld('derelict', 2500);
  const S = createSpatial(() => state, content);
  return { state, S };
}

function checkObject(S: ReturnType<typeof createSpatial>, o: ObjectState) {
  const p = o.placement;
  if (p.kind === 'floor') return S.checkPlace(o.defId, p.x, p.z, p.rot, o.id);
  if (p.kind === 'wall') return S.checkWallItem(o.defId, p.edge, p.side, o.id);
  if (p.kind === 'opening') return S.checkOpening(o.defId, p.edge, o.id);
  throw new Error(`unexpected template placement ${p.kind}`);
}

const tagsOf = (defId: string): string[] => real.objects[defId]?.tags ?? [];
const KITCHEN = ['fridge', 'stove', 'microwave', 'appliance'];
const WASH = ['shower', 'tub', 'plumbing'];

/** Upper bound on template objects (doors/windows included): the shack must stay mostly bare. */
export const DERELICT_MAX_OBJECTS = 12;
/** Upper bound on furniture inside the house (no doors/windows, nothing in the yard). */
export const DERELICT_MAX_INDOOR = 5;

describe('derelict lot: catalog entry', () => {
  it('is listed first, as the story start, with less money than the furnished starter', () => {
    expect(LOT_TEMPLATE_INFO[0].id).toBe('derelict');
    const d = LOT_TEMPLATE_INFO.find((t) => t.id === 'derelict')!;
    const s = LOT_TEMPLATE_INFO.find((t) => t.id === 'starter')!;
    expect(d.name).toBe('The Condemned Shack on Mildew Lane');
    expect(d.description.length).toBeGreaterThan(20);
    expect(d.startingFunds).toBe(2500);
    expect(d.startingFunds).toBeLessThan(s.startingFunds);
  });
});

describe('derelict lot: shape and validity', () => {
  it('standard 30x30 lot shape, JSON-safe', () => {
    const { lot } = createLotTemplate('derelict');
    expect([lot.width, lot.depth]).toEqual([30, 30]);
    expect(lot.buildable).toEqual({ x0: 1, z0: 1, x1: 29, z1: 27 });
    expect(lot.floors.length).toBe(900);
    expect(JSON.parse(JSON.stringify(lot))).toEqual(lot);
  });

  it('every object is a catalog object that passes its placement check with no blocked slots', () => {
    const { state, S } = spatialFor();
    for (const o of Object.values(state.objects)) {
      expect(real.objects[o.defId], `${o.defId} must be a shipped catalog object`).toBeDefined();
      const r = checkObject(S, o);
      expect(r.ok, `${o.defId} ${JSON.stringify(o.placement)}: ${r.reason}`).toBe(true);
      expect(r.blockedSlots, `${o.defId} blocked slots`).toEqual([]);
    }
    expect(S.debugFaults()).toEqual([]);
  });

  it('every slot of every object (doors included) is reachable from BOTH sidewalk entry points', () => {
    const { state, S } = spatialFor();
    for (const ep of state.lot.entryPoints) {
      const df = S.distanceField(ep);
      for (const o of Object.values(state.objects)) {
        const spec = content.objects[o.defId];
        const resolved = S.resolveSlots(o);
        spec.slots.forEach((slot, idx) => {
          const tiles = resolved.filter((r) => r.index === idx).flatMap((r) => r.approach);
          const reachable = tiles.filter((t) => Number.isFinite(df.dist[t.z * 30 + t.x]));
          expect(reachable.length, `${o.defId}.${slot.id} unreachable from ${JSON.stringify(ep)}`).toBeGreaterThan(0);
          expect(S.findPath(ep, reachable[0]), `${o.defId}.${slot.id} path`).not.toBeNull();
        });
      }
    }
  });

  it('every walkable tile inside the shack is reachable from the sidewalk (both rooms, through both doors)', () => {
    const { S } = spatialFor();
    const df = S.distanceField({ x: 0.5, z: 28.5 });
    const indoor = S.rooms().filter((r) => r.indoor);
    for (const r of indoor) for (const i of r.tiles) if (S.isWalkable(i % 30, Math.floor(i / 30))) expect(Number.isFinite(df.dist[i]), `tile ${i % 30},${Math.floor(i / 30)}`).toBe(true);
  });
});

describe('derelict lot: mostly bare', () => {
  const { state, S } = spatialFor();
  const objs = Object.values(state.objects);
  const indoorIds = new Set(S.rooms().filter((r) => r.indoor).map((r) => r.id));
  const isIndoor = (x: number, z: number) => indoorIds.has(S.roomAt(x, z));
  const indoorRoomOf = (o: ObjectState) => {
    const c = S.objectCenter(o);
    return isIndoor(c.x, c.z);
  };

  it(`has at most ${DERELICT_MAX_OBJECTS} objects in all and at most ${DERELICT_MAX_INDOOR} pieces of furniture inside`, () => {
    expect(objs.length).toBeLessThanOrEqual(DERELICT_MAX_OBJECTS);
    const furniture = objs.filter((o) => o.placement.kind !== 'opening' && indoorRoomOf(o));
    expect(furniture.length).toBeLessThanOrEqual(DERELICT_MAX_INDOOR);
    expect(furniture.length).toBeGreaterThanOrEqual(2); // "a couple of things in there", not an empty box
  });

  it('two small indoor rooms (the shack), roughly 8 x 6 tiles, divided by exactly ONE interior partition', () => {
    const indoor = S.rooms().filter((r) => r.indoor);
    expect(indoor.length).toBe(2);
    const tiles = indoor.flatMap((r) => r.tiles);
    expect(tiles.length).toBe(48);
    // interior wall segments = segments with an indoor room on both sides; they all lie on one straight line
    const interior = Object.keys(state.lot.walls).filter((k) => {
      const [a, b] = edgeSides(k);
      return isIndoor(a.x + 0.5, a.z + 0.5) && isIndoor(b.x + 0.5, b.z + 0.5);
    });
    expect(interior.length).toBeGreaterThan(0);
    const lines = new Set(interior.map((k) => k.split(':').slice(0, 2).join(':')));
    expect([...lines]).toEqual(['v:16']);
  });

  it('one front door to the outside, one interior doorway, one or two windows', () => {
    const doors = objs.filter((o) => tagsOf(o.defId).includes('door'));
    const windows = objs.filter((o) => tagsOf(o.defId).includes('window'));
    expect(doors.length).toBe(2);
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(windows.length).toBeLessThanOrEqual(2);
    const front = doors.filter((d) => {
      const p = d.placement;
      if (p.kind !== 'opening') return false;
      const [a, b] = edgeSides(p.edge);
      return !isIndoor(a.x + 0.5, a.z + 0.5) || !isIndoor(b.x + 0.5, b.z + 0.5);
    });
    expect(front.length).toBe(1);
  });

  it('contains a place to sleep (a coffin) and NO kitchen appliance, shower or tub', () => {
    const sleep = objs.filter((o) => tagsOf(o.defId).includes('bed'));
    expect(sleep.map((o) => o.defId)).toEqual(['coffin_pine']);
    expect(real.objects.coffin_pine.interactions).toContain('home_sleep');
    for (const o of objs) {
      expect(KITCHEN.some((t) => tagsOf(o.defId).includes(t)), `${o.defId} is a kitchen appliance`).toBe(false);
      expect(WASH.some((t) => tagsOf(o.defId).includes(t)), `${o.defId} is a shower/tub`).toBe(false);
    }
  });

  it('a mailbox and exactly one tree outside; nothing else in the yard', () => {
    const outside = objs.filter((o) => o.placement.kind !== 'opening' && !indoorRoomOf(o));
    expect(outside.map((o) => o.defId).sort()).toEqual(['mailbox_crooked', 'tree_gnarled']);
  });

  it('bare / damaged floors (worn planks, packed dirt) and a trodden path to the curb', () => {
    const lot = state.lot;
    const indoorFloors = new Set(S.rooms().filter((r) => r.indoor).flatMap((r) => r.tiles).map((i) => lot.floors[i]));
    expect([...indoorFloors].sort()).toEqual(['floor_dirt_packed', 'floor_planks_worn']);
    for (let z = 19; z < 27; z++) expect(lot.floors[z * 30 + 13], `path tile 13,${z}`).toBe('floor_dirt_packed');
  });
});

describe('derelict lot: isolation and determinism', () => {
  it('returns fresh, unshared data on every call', () => {
    const a = createLotTemplate('derelict');
    a.lot.walls['h:13:19'].paint[0] = 'MUTATED';
    a.lot.floors[13 * 30 + 11] = 'MUTATED';
    a.objects.length = 0;
    const b = createLotTemplate('derelict');
    expect(b.lot.walls['h:13:19'].paint[0]).not.toBe('MUTATED');
    expect(b.lot.floors[13 * 30 + 11]).toBe('floor_planks_worn');
    expect(b.objects.length).toBe(10);
  });

  it('the shack is identical whatever the seed (only the household varies), and only derelict worlds carry the story arc', () => {
    const shape = (seed: number, lot: 'derelict' | 'starter') => {
      const w = createNewWorld({ seed, householdName: 'The Graves', lotTemplate: lot, difficulty: 'normal', members: [{ firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null }] });
      const objects = Object.values(w.objects).map((o) => [o.defId, JSON.stringify(o.placement)]).sort();
      return { w, key: JSON.stringify({ walls: w.lot.walls, floors: w.lot.floors, objects }) };
    };
    const first = shape(1, 'derelict');
    for (const seed of [2, 77, 4096, 0xdeadbeef]) {
      const s = shape(seed, 'derelict');
      expect(s.key, `seed ${seed}`).toBe(first.key);
      expect(s.w.flags.storyArc).toBe('act1');
      expect(s.w.household.funds).toBe(2500);
    }
    const starter = shape(1, 'starter');
    expect(starter.w.flags.storyArc).toBeUndefined();
    expect(starter.key).not.toBe(first.key);
  });
});
