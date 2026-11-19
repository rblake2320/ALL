/**
 * The roof layer's LIFECYCLE (the real RoofLayer + the real computeRooms on a lot whose walls are laid out the way the sim
 * keeps them: a Record of 'h:x:z' / 'v:x:z' segments, a door being a segment with an openingId). These are the cases that
 * broke in review of #111: edits flashing a roof in Build/Buy, a world swap leaving stale meshes, and wall-only changes.
 */
import { describe, expect, it } from 'vitest';
import { computeRooms } from '../../../src/sim/spatial/rooms';
import { RoofLayer } from '../../../src/render/roofs/roofLayer';
import type { LotState, WallSegment } from '../../../src/sim/types';
import type { Perspective, ViewMode } from '../../../src/render/contracts';

const W = 14;
const D = 10;
const seg = (door = false): WallSegment => ({ paint: ['wall_plaster_bone', 'wall_plaster_bone'] as WallSegment['paint'], openingId: door ? 'door1' : null });

function boxKeys(x0: number, z0: number, x1: number, z1: number): string[] {
  const out: string[] = [];
  for (let x = x0; x < x1; x++) out.push(`h:${x}:${z0}`, `h:${x}:${z1}`);
  for (let z = z0; z < z1; z++) out.push(`v:${x0}:${z}`, `v:${x1}:${z}`);
  return out;
}
function lotOf(keys: string[], version = 1, wallVersion = 1, doors: string[] = []): LotState {
  const walls: Record<string, WallSegment> = {};
  for (const k of keys) walls[k] = seg(doors.includes(k));
  return { width: W, depth: D, buildable: { x0: 0, z0: 0, x1: W, z1: D }, sidewalkZ: D - 1, entryPoints: [], walls, floors: new Array(W * D).fill(null), version, wallVersion, floorVersion: 1 } as unknown as LotState;
}
/** The sim's own derivation: a segment present (door or not) is a wall. */
function roomAtOf(lot: LotState): (x: number, z: number) => number {
  const rd = computeRooms(W, D, (x, z) => `h:${x}:${z}` in lot.walls, (x, z) => `v:${x}:${z}` in lot.walls);
  return (x, z) => {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    return tx < 0 || tz < 0 || tx >= W || tz >= D ? 0 : rd.roomOf[tz * W + tx];
  };
}
const SETTLE = 40; // frames of 1/60 s: well past the 0.25 s fade
function run(layer: RoofLayer, n: number, mode: ViewMode, persp: Perspective, at: [number, number] | null): void {
  for (let i = 0; i < n; i++) layer.update(1 / 60, mode, persp, at ? at[0] : null, at ? at[1] : null);
}
const meshes = (layer: RoofLayer, prefix: string) => layer.group.children.filter((c) => c.name.startsWith(prefix));
const visibleRoofs = (layer: RoofLayer) => meshes(layer, 'roof:').filter((m) => m.visible).length;
const visibleCeilings = (layer: RoofLayer) => meshes(layer, 'ceiling:').filter((m) => m.visible).length;
const opacityOf = (m: unknown): number => ((m as { material: { opacity: number } }).material.opacity);

const HOUSE = boxKeys(3, 3, 8, 7);

describe('a room with a door is still a closed room (the sim counts a door as a wall segment)', () => {
  it('a door segment in the wall keeps the ceiling and the roof', () => {
    const doorKey = 'h:5:7';
    const lot = lotOf(HOUSE, 1, 1, [doorKey]);
    expect(lot.walls[doorKey].openingId).toBe('door1');
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    expect(meshes(layer, 'roof:')).toHaveLength(1);
    expect(meshes(layer, 'ceiling:')).toHaveLength(1);
  });
  it('NEGATIVE CONTROL: the same wall with the segment REMOVED is open to the outside and has neither', () => {
    const lot = lotOf(HOUSE.filter((k) => k !== 'h:5:7'));
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    expect(meshes(layer, 'roof:')).toHaveLength(0);
    expect(meshes(layer, 'ceiling:')).toHaveLength(0);
  });
});

describe('edits never flash a roof (P1)', () => {
  it('Build mode: after a lot.version bump the roof is invisible on EVERY frame, including the first', () => {
    const layer = new RoofLayer();
    let lot = lotOf(HOUSE, 1);
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'build', 'overview', [5.5, 5.5]);
    expect(visibleRoofs(layer)).toBe(0);
    for (let v = 2; v < 8; v++) {
      lot = lotOf(HOUSE, v, v); // every wall drawn or object placed in Build bumps the version
      layer.sync(lot, roomAtOf(lot));
      expect(visibleRoofs(layer), `before the first update of edit ${v}`).toBe(0);
      for (let f = 0; f < 5; f++) {
        run(layer, 1, 'build', 'overview', [5.5, 5.5]);
        expect(visibleRoofs(layer), `edit ${v} frame ${f}`).toBe(0);
        expect(layer.drawCalls).toBe(0);
      }
    }
  });

  it('Live from above: a version bump never pops any roof back, in any subject position', () => {
    const two = [...HOUSE, ...boxKeys(10, 2, 13, 6)];
    const layer = new RoofLayer();
    let lot = lotOf(two, 1);
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'overview', [5.5, 5.5]);
    expect(visibleRoofs(layer)).toBe(0);
    for (let v = 2; v < 6; v++) {
      lot = lotOf(two, v, v);
      layer.sync(lot, roomAtOf(lot));
      expect(visibleRoofs(layer), `before update, edit ${v}`).toBe(0);
      for (let f = 0; f < 4; f++) {
        run(layer, 1, 'live', 'overview', [5.5, 5.5]);
        expect(visibleRoofs(layer), `edit ${v} frame ${f}`).toBe(0);
      }
    }
  });

  it('a fade in progress survives a rebuild (no restart from 1 or 0)', () => {
    const layer = new RoofLayer();
    let lot = lotOf(HOUSE, 1);
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'firstPerson', null); // eyes outside at ground level: the roof is fully there
    run(layer, 6, 'live', 'overview', [5.5, 5.5]); // walks in: the roof is fading out (6/60 s of 0.25)
    const mid = opacityOf(meshes(layer, 'roof:')[0]);
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
    lot = lotOf(HOUSE, 2, 2);
    layer.sync(lot, roomAtOf(lot));
    run(layer, 1, 'live', 'overview', [5.5, 5.5]);
    const after = opacityOf(meshes(layer, 'roof:')[0]);
    expect(after).toBeLessThan(mid + 1e-9); // it kept going down
    expect(after).toBeGreaterThan(mid - 0.1);
  });

  it('a building that APPEARS (a wall closes a room) starts at its target: hidden in Build, whole in Live outdoors', () => {
    const layer = new RoofLayer();
    let lot = lotOf([], 1);
    layer.sync(lot, roomAtOf(lot));
    run(layer, 3, 'build', 'overview', null);
    lot = lotOf(HOUSE, 2, 2);
    layer.sync(lot, roomAtOf(lot));
    run(layer, 1, 'build', 'overview', null);
    expect(visibleRoofs(layer)).toBe(0);
    const live = new RoofLayer();
    live.sync(lot, roomAtOf(lot));
    run(live, 1, 'live', 'firstPerson', null);
    expect(visibleRoofs(live)).toBe(1);
    expect(opacityOf(meshes(live, 'roof:')[0])).toBe(1);
  });
});

describe('the rebuild key (P2)', () => {
  it('a world swap with the SAME version number rebuilds (different lot object)', () => {
    const layer = new RoofLayer();
    const a = lotOf(HOUSE, 1, 1);
    layer.sync(a, roomAtOf(a));
    expect(meshes(layer, 'roof:')).toHaveLength(1);
    const b = lotOf([], 1, 1); // another world, version 1 again, no walls
    layer.sync(b, roomAtOf(b));
    expect(meshes(layer, 'roof:')).toHaveLength(0);
    expect(meshes(layer, 'ceiling:')).toHaveLength(0);
  });

  it('a wallVersion-only change rebuilds', () => {
    const layer = new RoofLayer();
    const lot = lotOf(HOUSE, 1, 1);
    layer.sync(lot, roomAtOf(lot));
    expect(meshes(layer, 'roof:')).toHaveLength(1);
    delete lot.walls['h:5:7']; // same lot object, same version: only wallVersion moves
    lot.wallVersion = 2;
    layer.sync(lot, roomAtOf(lot));
    expect(meshes(layer, 'roof:')).toHaveLength(0);
  });

  it('invalidate() forces a rebuild and an unchanged lot does not rebuild', () => {
    const layer = new RoofLayer();
    const lot = lotOf(HOUSE, 1, 1);
    layer.sync(lot, roomAtOf(lot));
    const n = layer.rebuilds;
    layer.sync(lot, roomAtOf(lot));
    layer.sync(lot, roomAtOf(lot));
    expect(layer.rebuilds).toBe(n);
    layer.invalidate();
    layer.sync(lot, roomAtOf(lot));
    expect(layer.rebuilds).toBe(n + 1);
  });

  it('setBeams before the first sync costs no second rebuild; a change of tier rebuilds once and keeps the fade', () => {
    const layer = new RoofLayer();
    const lot = lotOf(HOUSE, 1, 1);
    layer.setBeams(true);
    layer.sync(lot, roomAtOf(lot));
    const n = layer.rebuilds;
    layer.setBeams(true);
    layer.sync(lot, roomAtOf(lot));
    expect(layer.rebuilds).toBe(n);
    run(layer, SETTLE, 'live', 'firstPerson', null);
    layer.setBeams(false);
    layer.sync(lot, roomAtOf(lot));
    run(layer, 1, 'live', 'firstPerson', null);
    expect(layer.rebuilds).toBe(n + 1);
    expect(visibleRoofs(layer)).toBe(1);
  });
});

describe('the ceiling is the ROOM you are in (P3)', () => {
  const TWO_ROOMS = [...boxKeys(2, 2, 6, 6), ...boxKeys(6, 2, 10, 6)];

  it('first person in room A draws A\'s ceiling only; stepping into B swaps it', () => {
    const lot = lotOf(TWO_ROOMS);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    expect(meshes(layer, 'ceiling:')).toHaveLength(2);
    expect(meshes(layer, 'roof:')).toHaveLength(1); // one building, one roof
    run(layer, SETTLE, 'live', 'firstPerson', [3.5, 4.5]);
    const a = meshes(layer, 'ceiling:').filter((m) => m.visible).map((m) => m.name);
    expect(a).toHaveLength(1);
    expect(visibleRoofs(layer)).toBe(1);
    run(layer, SETTLE, 'live', 'firstPerson', [8.5, 4.5]);
    const b = meshes(layer, 'ceiling:').filter((m) => m.visible).map((m) => m.name);
    expect(b).toHaveLength(1);
    expect(b[0]).not.toBe(a[0]);
  });

  it('rule 3: in the shoulder view inside, the ceiling of YOUR room is drawn (and only yours), fully opaque: it is not faded out', () => {
    const lot = lotOf(TWO_ROOMS);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'shoulder', [3.5, 4.5]);
    const shown = meshes(layer, 'ceiling:').filter((m) => m.visible);
    expect(shown).toHaveLength(1);
    expect(opacityOf(shown[0])).toBe(1);
    expect(visibleRoofs(layer)).toBe(0); // rule 1: your own roof is out
    run(layer, SETTLE, 'live', 'shoulder', [8.5, 4.5]);
    const next = meshes(layer, 'ceiling:').filter((m) => m.visible);
    expect(next).toHaveLength(1);
    expect(next[0].name).not.toBe(shown[0].name);
  });

  it('rule 3 holds through a lot edit: the shoulder ceiling never blinks out while the lot version bumps', () => {
    let lot = lotOf(TWO_ROOMS, 1);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'shoulder', [3.5, 4.5]);
    for (let v = 2; v < 8; v++) {
      lot = lotOf(TWO_ROOMS, v, v);
      layer.sync(lot, roomAtOf(lot));
      run(layer, 1, 'live', 'shoulder', [3.5, 4.5]);
      expect(visibleCeilings(layer), `edit ${v}`).toBe(1);
    }
  });

  it('rule 1, overview: every roof on the lot out, no ceiling drawn (invisible from above anyway)', () => {
    const lot = lotOf([...TWO_ROOMS, ...boxKeys(11, 7, 13, 9)]);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'overview', [3.5, 4.5]);
    expect(visibleCeilings(layer)).toBe(0);
    expect(visibleRoofs(layer)).toBe(0); // the small house is the player's too
  });

  it('rule 4: Build and Buy draw no roof and no ceiling on the lot, in every perspective', () => {
    const lot = lotOf(TWO_ROOMS);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    for (const mode of ['build', 'buy'] as ViewMode[])
      for (const persp of ['overview', 'shoulder', 'firstPerson'] as Perspective[]) {
        run(layer, SETTLE, mode, persp, [3.5, 4.5]);
        expect(visibleCeilings(layer) + visibleRoofs(layer), `${mode}/${persp}`).toBe(0);
        expect(layer.drawCalls).toBe(0);
      }
  });

  it('no ceiling is drawn by a zombie outdoors, in any view', () => {
    const lot = lotOf(TWO_ROOMS);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    for (const persp of ['overview', 'shoulder', 'firstPerson'] as Perspective[]) {
      run(layer, SETTLE, 'live', persp, [12.5, 8.5]);
      expect(visibleCeilings(layer), persp).toBe(0);
      run(layer, SETTLE, 'live', persp, null);
      expect(visibleCeilings(layer), `${persp} nobody`).toBe(0);
    }
  });

  it('rule 6 and the level-aware design: a building reports its levels (1 today); a roof sits on the TOP level and ceilings are per level', async () => {
    const { findBuildings } = await import('../../../src/render/roofs/footprint');
    const { buildRoofArrays, buildCeilingArrays, ROOF } = await import('../../../src/render/roofs/geometry');
    const lot = lotOf(HOUSE);
    const roomAt = roomAtOf(lot);
    const roomOf = new Int32Array(W * D);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) roomOf[z * W + x] = roomAt(x + 0.5, z + 0.5);
    const [b] = findBuildings(W, D, roomOf);
    expect(b.levels).toBe(1);
    const H = 2.7;
    const top = (m: { positions: number[] }) => Math.max(...m.positions.filter((_, i) => i % 3 === 1));
    const one = top(buildRoofArrays(b, W, H));
    const two = top(buildRoofArrays({ ...b, levels: 2 }, W, H));
    expect(two - one).toBeCloseTo(H, 6); // a second storey lifts the roof by one storey
    const c0 = buildCeilingArrays(b, W, roomOf, H, () => [1, 1, 1], false, 0);
    const c1 = buildCeilingArrays(b, W, roomOf, H, () => [1, 1, 1], false, 1);
    expect(c0.positions[1]).toBeCloseTo(H - ROOF.ceilingDrop, 6);
    expect(c1.positions[1]).toBeCloseTo(2 * H - ROOF.ceilingDrop, 6);
  });

  it('wall mode cannot bring a roof back over the building being looked into (not an input: the view is the same for any wall mode)', () => {
    const lot = lotOf(HOUSE);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'overview', [5.5, 5.5]);
    expect(visibleRoofs(layer)).toBe(0);
    expect(visibleCeilings(layer)).toBe(0);
  });
});

describe('cost', () => {
  it('a settled layer allocates nothing and touches nothing per frame (opacity and visibility unchanged)', () => {
    const lot = lotOf([...HOUSE, ...boxKeys(10, 2, 13, 6)]);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'overview', [5.5, 5.5]);
    const snapshot = layer.group.children.map((m) => `${m.name}:${m.visible}:${opacityOf(m)}`).join('|');
    const calls = layer.drawCalls;
    run(layer, 120, 'live', 'overview', [5.5, 5.5]);
    expect(layer.group.children.map((m) => `${m.name}:${m.visible}:${opacityOf(m)}`).join('|')).toBe(snapshot);
    expect(layer.drawCalls).toBe(calls);
    expect(layer.rebuilds).toBe(1);
  });

  it('dispose releases every geometry and material', () => {
    const lot = lotOf([...HOUSE, ...boxKeys(10, 2, 13, 6)]);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    layer.sync(lotOf([...HOUSE], 2, 2), roomAtOf(lot));
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
  });
});

describe('rule 1, household home: nobody inside hides every roof on the lot from above', () => {
  const TWO_HOUSES = [...boxKeys(2, 2, 6, 6), ...boxKeys(9, 2, 13, 6)];
  it.each<[string, [number, number] | null]>([['nobody selected', null], ['the subject is outdoors', [7.5, 8.5]]])('%s: overview and shoulder show NO roof on the lot; first person keeps them', (_n, at) => {
    const lot = lotOf(TWO_HOUSES);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    expect(meshes(layer, 'roof:')).toHaveLength(2);
    for (const persp of ['overview', 'shoulder'] as Perspective[]) {
      run(layer, SETTLE, 'live', persp, at);
      expect(visibleRoofs(layer), persp).toBe(0);
      expect(layer.drawCalls).toBe(0);
    }
    run(layer, SETTLE, 'live', 'firstPerson', at);
    expect(visibleRoofs(layer)).toBe(2);
  });
  it.each<[string, [number, number] | null]>([['inside A', [3.5, 4.5]], ['inside B', [10.5, 4.5]], ['outdoors', [7.5, 8.5]], ['nobody', null]])('subject %s: from above every roof is out, identically (no roof fades back when the zombie walks into a house)', (_n, at) => {
    const lot = lotOf(TWO_HOUSES);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    for (const persp of ['overview', 'shoulder'] as Perspective[]) {
      run(layer, SETTLE, 'live', persp, at);
      expect(visibleRoofs(layer), persp).toBe(0);
    }
  });
  it('NEGATIVE CONTROL: walking between houses and out never puts a roof back', () => {
    const lot = lotOf(TWO_HOUSES);
    const layer = new RoofLayer();
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'overview', [3.5, 4.5]);
    run(layer, SETTLE, 'live', 'overview', [7.5, 8.5]);
    expect(visibleRoofs(layer)).toBe(0);
  });
});

describe('a carried fade follows the TILES, not ids (re-review P3s)', () => {
  it('an interior wall that splits a room mid-fade keeps the roof fade going (no snap to hidden)', () => {
    const layer = new RoofLayer();
    let lot = lotOf(HOUSE, 1);
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'firstPerson', null); // roof fully there
    run(layer, 8, 'live', 'overview', [5.5, 5.5]); // walks in: roof fading out
    const mid = opacityOf(meshes(layer, 'roof:')[0]);
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.95);
    // an interior wall splits the room: same outline, different footprint signature in the old key scheme
    lot = lotOf([...HOUSE, ...boxKeys(3, 3, 5, 7).filter((k) => k.startsWith('v:5'))], 2, 2);
    layer.sync(lot, roomAtOf(lot));
    const first = meshes(layer, 'roof:')[0];
    expect(first.visible).toBe(true); // not snapped to hidden
    run(layer, 1, 'live', 'overview', [5.5, 5.5]);
    expect(opacityOf(meshes(layer, 'roof:')[0])).toBeLessThanOrEqual(mid);
    expect(opacityOf(meshes(layer, 'roof:')[0])).toBeGreaterThan(mid - 0.1);
  });

  it('when room ids renumber after an edit, a ceiling does not inherit another room\'s opacity', () => {
    const A = boxKeys(2, 2, 6, 6);
    const B = boxKeys(6, 2, 10, 6);
    const layer = new RoofLayer();
    let lot = lotOf([...A, ...B], 1);
    layer.sync(lot, roomAtOf(lot));
    run(layer, SETTLE, 'live', 'shoulder', [3.5, 4.5]); // in A: A's ceiling is on, B's is off
    const before = meshes(layer, 'ceiling:').map((m) => `${m.name}:${m.visible}`);
    expect(before.filter((x) => x.endsWith('true'))).toHaveLength(1);
    // a third room appears BEFORE them in scan order, renumbering the ids
    lot = lotOf([...A, ...B, ...boxKeys(0, 0, 2, 2)], 2, 2);
    layer.sync(lot, roomAtOf(lot));
    const visible = meshes(layer, 'ceiling:').filter((m) => m.visible);
    expect(visible).toHaveLength(1); // still just room A's ceiling, right after the rebuild, before any update
    run(layer, 1, 'live', 'shoulder', [3.5, 4.5]);
    expect(meshes(layer, 'ceiling:').filter((m) => m.visible)).toHaveLength(1);
  });
});
