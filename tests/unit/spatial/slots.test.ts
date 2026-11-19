import { describe, expect, it } from 'vitest';
import { createSpatial } from '../../../src/sim/spatial';
import { PHYSICAL_SPECS } from '../../../src/shared/catalog';
import { rotateDir, rotYaw, type Rot } from '../../../src/shared/dimensions';
import { faceObjectPose, worldFacing } from '../../../src/sim/spatial/geometry';
import { addAgent, addFloor, addLoose, addObj, addWall, blankLot, makeContent, makeWorld } from './fixtures';

const ROTS: Rot[] = [0, 1, 2, 3];
const TAU = Math.PI * 2;
const angEq = (a: number, b: number, eps = 1e-6) => {
  const d = (((a - b) % TAU) + TAU) % TAU;
  return d < eps || TAU - d < eps;
};

function setup(w = 30, d = 30) {
  const state = makeWorld(blankLot(w, d));
  const content = makeContent();
  const S = createSpatial(() => state, content);
  return { state, content, S };
}

describe('facing math', () => {
  it('worldFacing == normalizeAngle(f + rotYaw(rot)) for all 4 rotations, and -Z is +PI', () => {
    for (const r of ROTS) {
      for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.3, -2.2]) {
        const wf = worldFacing(r, f);
        expect(angEq(wf, f + rotYaw(r))).toBe(true);
        // and it is literally atan2 of the rotated local facing vector
        const v = rotateDir(r, Math.sin(f), Math.cos(f));
        expect(angEq(wf, Math.atan2(v.x, v.z))).toBe(true);
        expect(wf).toBeGreaterThan(-Math.PI - 1e-12);
        expect(wf).toBeLessThanOrEqual(Math.PI + 1e-12);
      }
    }
    expect(worldFacing(0, Math.PI)).toBe(Math.PI);
    expect(worldFacing(2, 0)).toBe(Math.PI);
    expect(worldFacing(1, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(worldFacing(3, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(worldFacing(0, NaN)).toBe(0);
  });

  it('faceObjectPose: 0.28 toward the centre, facing it', () => {
    const p = faceObjectPose({ x: 5, z: 6 }, { x: 5.5, z: 5.5 });
    expect(p.x).toBeCloseTo(5.5);
    expect(p.z).toBeCloseTo(6.22);
    expect(p.facing).toBe(Math.PI);
    const q = faceObjectPose({ x: 4, z: 5 }, { x: 5.5, z: 5.5 });
    expect(q.x).toBeCloseTo(4.78);
    expect(q.facing).toBeCloseTo(Math.PI / 2);
    expect(faceObjectPose({ x: 5, z: 5 }, { x: 5.5, z: 5.5 })).toEqual({ x: 5.5, z: 5.5, facing: 0 });
  });
});

describe('floor object slots (rotation aware)', () => {
  it('a chair faces its front in every rotation and its first approach tile is the front tile', () => {
    for (const r of ROTS) {
      const { state, S } = setup();
      const chair = addFloor(state, 'chair_creaky', 5, 5, r);
      const [slot] = S.resolveSlots(chair);
      expect(slot.kind).toBe('sit');
      expect(slot.pose.x).toBeCloseTo(5.5);
      expect(slot.pose.z).toBeCloseTo(5.5);
      expect(slot.pose.y).toBe(0);
      expect(angEq(slot.pose.facing, rotYaw(r))).toBe(true);
      const front = { x: 5 + Math.round(Math.sin(slot.pose.facing)), z: 5 + Math.round(Math.cos(slot.pose.facing)) };
      expect(slot.approach[0]).toEqual(front);
      expect(slot.approach.length).toBe(4);
    }
  });

  it('2x1 loveseat: exact poses and approach tiles for all 4 rotations', () => {
    const expected: Record<Rot, { tiles: [number, number][]; sit0: [number, number]; sit1: [number, number]; a0: [number, number][]; a1: [number, number][]; facing: number }> = {
      0: { tiles: [[5, 5], [6, 5]], sit0: [5.55, 5.5], sit1: [6.45, 5.5], a0: [[5, 6], [4, 5]], a1: [[6, 6], [7, 5]], facing: 0 },
      1: { tiles: [[5, 5], [5, 6]], sit0: [5.5, 5.55], sit1: [5.5, 6.45], a0: [[4, 5], [5, 4]], a1: [[4, 6], [5, 7]], facing: -Math.PI / 2 },
      2: { tiles: [[5, 5], [6, 5]], sit0: [6.45, 5.5], sit1: [5.55, 5.5], a0: [[6, 4], [7, 5]], a1: [[5, 4], [4, 5]], facing: Math.PI },
      3: { tiles: [[5, 5], [5, 6]], sit0: [5.5, 6.45], sit1: [5.5, 5.55], a0: [[6, 6], [5, 7]], a1: [[6, 5], [5, 4]], facing: Math.PI / 2 },
    };
    for (const r of ROTS) {
      const { state, S } = setup();
      const sofa = addFloor(state, 'sofa_moldy', 5, 5, r);
      const e = expected[r];
      expect(S.objectTiles(sofa).map((t) => [t.x, t.z]).sort()).toEqual(e.tiles.slice().sort());
      const [s0, s1] = S.resolveSlots(sofa);
      expect([s0.id, s1.id]).toEqual(['sit0', 'sit1']);
      expect(s0.pose.x).toBeCloseTo(e.sit0[0]);
      expect(s0.pose.z).toBeCloseTo(e.sit0[1]);
      expect(s1.pose.x).toBeCloseTo(e.sit1[0]);
      expect(s1.pose.z).toBeCloseTo(e.sit1[1]);
      expect(s0.approach.map((t) => [t.x, t.z])).toEqual(e.a0);
      expect(s1.approach.map((t) => [t.x, t.z])).toEqual(e.a1);
      expect(angEq(s0.pose.facing, e.facing) && angEq(s1.pose.facing, e.facing)).toBe(true);
    }
  });

  it('3x1 sofa and 1x2 coffin: slot poses stay inside the footprint and approach tiles are adjacent outside it', () => {
    for (const defId of ['sofa_velvet', 'coffin_pine', 'bed_normal', 'table_bonechess', 'station_embalming', 'desk_hauntedpc', 'tub_icebath']) {
      for (const r of ROTS) {
        const { state, S } = setup();
        const obj = addFloor(state, defId, 10, 10, r);
        const tiles = S.objectTiles(obj);
        const inFp = (t: { x: number; z: number }) => tiles.some((f) => f.x === t.x && f.z === t.z);
        for (const s of S.resolveSlots(obj)) {
          for (const a of s.approach) {
            expect(inFp(a), `${defId} r${r} ${s.id} approach inside footprint`).toBe(false);
            const adj = tiles.some((f) => Math.abs(f.x - a.x) + Math.abs(f.z - a.z) === 1);
            const tv = defId === 'tv_crt';
            expect(adj || tv, `${defId} r${r} ${s.id} approach ${a.x},${a.z} not adjacent`).toBe(true);
          }
          if (s.kind !== 'stand') {
            expect(inFp({ x: Math.floor(s.pose.x), z: Math.floor(s.pose.z) }), `${defId} r${r} ${s.id} pose outside`).toBe(true);
          }
        }
      }
    }
  });

  it('PROPERTY: for every floor spec, slots / surfaces / footprint rotate rigidly about the footprint centre', () => {
    const floorSpecs = PHYSICAL_SPECS.filter((s) => s.placement === 'floor');
    expect(floorSpecs.length).toBeGreaterThan(40);
    for (const spec of floorSpecs) {
      const results = ROTS.map((r) => {
        const { state, S } = setup();
        const obj = addFloor(state, spec.id, 12, 12, r);
        const c = S.objectCenter(obj);
        const rel = (x: number, z: number) => ({ x: x - c.x, z: z - c.z });
        return {
          slots: S.resolveSlots(obj).map((s) => ({
            index: s.index,
            id: s.id,
            kind: s.kind,
            y: s.pose.y,
            facing: s.pose.facing,
            pose: rel(s.pose.x, s.pose.z),
            approach: s.approach.map((t) => rel(t.x + 0.5, t.z + 0.5)),
          })),
          surfaces: S.surfacePoints(obj).map((p) => ({ index: p.index, y: p.y, p: rel(p.x, p.z) })),
          tiles: S.objectTiles(obj).map((t) => rel(t.x + 0.5, t.z + 0.5)),
        };
      });
      const base = results[0];
      for (const r of ROTS) {
        const cur = results[r];
        expect(cur.slots.length, spec.id).toBe(base.slots.length);
        cur.slots.forEach((s, i) => {
          const b = base.slots[i];
          expect([s.index, s.id, s.kind, s.y]).toEqual([b.index, b.id, b.kind, b.y]);
          const rp = rotateDir(r, b.pose.x, b.pose.z);
          expect(s.pose.x).toBeCloseTo(rp.x, 9);
          expect(s.pose.z).toBeCloseTo(rp.z, 9);
          expect(angEq(s.facing, b.facing + rotYaw(r)), `${spec.id} r${r} facing`).toBe(true);
          expect(s.approach.length).toBe(b.approach.length);
          s.approach.forEach((a, k) => {
            const ra = rotateDir(r, b.approach[k].x, b.approach[k].z);
            expect(a.x).toBeCloseTo(ra.x, 9);
            expect(a.z).toBeCloseTo(ra.z, 9);
          });
        });
        cur.surfaces.forEach((p, i) => {
          const rp = rotateDir(r, base.surfaces[i].p.x, base.surfaces[i].p.z);
          expect(p.p.x).toBeCloseTo(rp.x, 9);
          expect(p.p.z).toBeCloseTo(rp.z, 9);
          expect(p.y).toBe(base.surfaces[i].y);
        });
        const want = base.tiles.map((t) => rotateDir(r, t.x, t.z)).map((t) => `${t.x.toFixed(6)},${t.z.toFixed(6)}`).sort();
        const got = cur.tiles.map((t) => `${(t.x + 0).toFixed(6)},${(t.z + 0).toFixed(6)}`).sort();
        expect(got.map((s) => s.replace('-0.000000', '0.000000'))).toEqual(want.map((s) => s.replace('-0.000000', '0.000000')));
      }
    }
  });

  it('drops approach tiles that are off the lot or separated from the object by a wall', () => {
    const { state, S } = setup();
    const fridge = addFloor(state, 'fridge_humming', 5, 5, 0);
    addWall(state, 'h:5:6'); // directly in front of the fridge
    const [slot] = S.resolveSlots(fridge);
    expect(slot.approach).toEqual([]); // slot still listed (index alignment), but unusable
    const tv = addFloor(state, 'tv_crt', 10, 5, 0); // watch tiles (10,7) and (10,8)
    expect(S.resolveSlots(tv)[0].approach).toEqual([{ x: 10, z: 7 }, { x: 10, z: 8 }]);
    addWall(state, 'h:10:8'); // between (10,7) and (10,8)
    expect(S.resolveSlots(tv)[0].approach).toEqual([{ x: 10, z: 7 }]);
    addWall(state, 'h:10:6');
    expect(S.resolveSlots(tv)[0].approach).toEqual([]);
    const corner = addFloor(state, 'chair_creaky', 0, 0, 0);
    expect(S.resolveSlots(corner)[0].approach).toEqual([{ x: 0, z: 1 }, { x: 1, z: 0 }]);
  });

  it('faceObject slots expand to one entry per approach tile, sharing the slot index', () => {
    const { state, S } = setup();
    const trash = addFloor(state, 'trash_lidded', 5, 5, 0);
    const slots = S.resolveSlots(trash);
    expect(slots.map((s) => s.approach[0])).toEqual([
      { x: 5, z: 6 },
      { x: 4, z: 5 },
      { x: 6, z: 5 },
      { x: 5, z: 4 },
    ]);
    expect(slots.every((s) => s.index === 0 && s.id === 'use' && s.approach.length === 1)).toBe(true);
    expect(slots[0].pose.z).toBeCloseTo(6.22);
    expect(slots[0].pose.facing).toBe(Math.PI);
    expect(slots[1].pose.x).toBeCloseTo(4.78);
    expect(slots[1].pose.facing).toBeCloseTo(Math.PI / 2);
    expect(slots[3].pose.facing).toBe(0);
    const corner = addFloor(state, 'mailbox_crooked', 0, 0, 0);
    expect(S.resolveSlots(corner).length).toBe(2);
  });
});

describe('wall item, loose item and opening slots', () => {
  const cases: { edge: string; side: 0 | 1; tile: [number, number]; pose: [number, number]; facing: number }[] = [
    { edge: 'h:5:8', side: 1, tile: [5, 8], pose: [5.5, 8.62], facing: Math.PI },
    { edge: 'h:5:8', side: 0, tile: [5, 7], pose: [5.5, 7.38], facing: 0 },
    { edge: 'v:5:8', side: 1, tile: [5, 8], pose: [5.62, 8.5], facing: -Math.PI / 2 },
    { edge: 'v:5:8', side: 0, tile: [4, 8], pose: [4.38, 8.5], facing: Math.PI / 2 },
  ];
  for (const c of cases) {
    it(`painting on ${c.edge} side ${c.side}: stand on the mounted tile 0.62 from the wall, facing it`, () => {
      const { state, S } = setup();
      addWall(state, c.edge);
      const p = addObj(state, 'painting_greatgrand', { kind: 'wall', edge: c.edge, side: c.side });
      const [slot] = S.resolveSlots(p);
      expect(slot.approach).toEqual([{ x: c.tile[0], z: c.tile[1] }]);
      expect(slot.pose.x).toBeCloseTo(c.pose[0]);
      expect(slot.pose.z).toBeCloseTo(c.pose[1]);
      expect(angEq(slot.pose.facing, c.facing)).toBe(true);
      expect(S.objectTiles(p)).toEqual([]);
      const ctr = S.objectCenter(p);
      expect(Math.floor(ctr.x)).toBe(c.tile[0]);
      expect(Math.floor(ctr.z)).toBe(c.tile[1]);
    });
  }

  it('loose items: approach around the item tile, poses face the item itself', () => {
    const { state, S } = setup();
    const dish = addLoose(state, 'item_dish', 3.3, 3.6);
    const slots = S.resolveSlots(dish);
    expect(slots.map((s) => s.approach[0])).toEqual([
      { x: 3, z: 4 },
      { x: 2, z: 3 },
      { x: 4, z: 3 },
      { x: 3, z: 2 },
    ]);
    for (const s of slots) {
      const t = s.approach[0];
      const d0 = Math.hypot(t.x + 0.5 - 3.3, t.z + 0.5 - 3.6);
      expect(Math.hypot(s.pose.x - 3.3, s.pose.z - 3.6)).toBeCloseTo(d0 - 0.28);
      expect(angEq(s.pose.facing, Math.atan2(3.3 - s.pose.x, 3.6 - s.pose.z))).toBe(true);
    }
    expect(S.objectTiles(dish)).toEqual([{ x: 3, z: 3 }]);
    expect(S.objectCenter(dish)).toEqual({ x: 3.3, z: 3.6 });
  });

  it('openings, held items, unknown defs and malformed objects have no slots and never throw', () => {
    const { state, S } = setup();
    addWall(state, 'h:3:3');
    const door = addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:3:3' });
    const a = addAgent(state, 'a1', 7.25, 8.5);
    const held = addObj(state, 'item_dish', { kind: 'held', agentId: a.id });
    const ghost = addObj(state, 'held_by_nobody', { kind: 'held', agentId: 'nobody' });
    const unknown = addFloor(state, 'no_such_def', 4, 4, 0);
    expect(S.resolveSlots(door)).toEqual([]);
    expect(S.resolveSlots(held)).toEqual([]);
    expect(S.resolveSlots(unknown)).toEqual([]);
    expect(S.resolveSlots(null as never)).toEqual([]);
    expect(S.resolveSlots({ id: 'x', defId: 'chair_creaky' } as never)).toEqual([]);
    expect(S.objectCenter(door)).toEqual({ x: 3.5, z: 3 });
    expect(S.objectCenter(held)).toEqual({ x: 7.25, z: 8.5 });
    expect(S.objectCenter(ghost)).toEqual({ x: 0, z: 0 });
    expect(S.surfacePoints(door)).toEqual([]);
    expect(S.debugFaults()).toEqual([]);
  });
});

describe('surfaces', () => {
  it('table_wake surfaces in all rotations sit inside its tiles at table height', () => {
    const want: Record<Rot, [number, number][]> = {
      0: [[5.5, 5.5], [6.5, 5.5]],
      1: [[5.5, 5.5], [5.5, 6.5]],
      2: [[6.5, 5.5], [5.5, 5.5]],
      3: [[5.5, 6.5], [5.5, 5.5]],
    };
    for (const r of ROTS) {
      const { state, S } = setup();
      const t = addFloor(state, 'table_wake', 5, 5, r);
      const pts = S.surfacePoints(t);
      expect(pts.map((p) => [p.x, p.z])).toEqual(want[r]);
      expect(pts.every((p) => p.y === 0.76)).toBe(true);
      expect(pts.map((p) => p.index)).toEqual([0, 1]);
    }
  });

  it('freeSurfaceNear skips occupied / burning surfaces, honours maxDist and the preferred object', () => {
    const { state, S } = setup();
    const table = addFloor(state, 'table_wake', 5, 5, 0); // surfaces (5.5,5.5) (6.5,5.5)
    const counter = addFloor(state, 'counter_butcher', 9, 5, 0); // (9.5,5.45)
    const p = { x: 5.5, z: 6.5 };
    expect(S.freeSurfaceNear(p, 3)).toMatchObject({ objectId: table.id, index: 0 });
    addLoose(state, 'item_dish', 5.5, 5.5, { parentId: table.id, surfaceIndex: 0, y: 0.76 });
    expect(S.freeSurfaceNear(p, 3)).toMatchObject({ objectId: table.id, index: 1, y: 0.76 });
    expect(S.freeSurfaceNear(p, 5, counter.id)).toMatchObject({ objectId: counter.id, index: 0 });
    expect(S.freeSurfaceNear(p, 0.5)).toBeNull();
    table.condition.burning = true;
    expect(S.freeSurfaceNear(p, 5)).toMatchObject({ objectId: counter.id });
    expect(S.freeSurfaceNear({ x: NaN, z: 1 }, 5)).toBeNull();
    expect(S.freeSurfaceNear(p, NaN)).toBeNull();
    expect(S.freeSurfaceNear(p, -1)).toBeNull();
  });
});
