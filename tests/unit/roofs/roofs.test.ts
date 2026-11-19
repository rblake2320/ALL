/**
 * Roofs and ceilings (src/render/roofs): ceiling generation from the sim's real room grid (a closed room, an L-shape, a room
 * with a door, a room open to the outside, two houses), the geometry (counts, winding agrees with the normals, nothing under
 * the floor), and the visibility rules and fade for every view and mode.
 */
import { describe, expect, it } from 'vitest';
import { computeRooms } from '../../../src/sim/spatial/rooms';
import { boundaryEdges, buildingAt, findBuildings, type Building } from '../../../src/render/roofs/footprint';
import { ROOF, SHINGLE, buildCeilingArrays, buildRoofArrays, triangles, type MeshArrays, type Rgb } from '../../../src/render/roofs/geometry';
import { FADE_SECONDS, drawn, fadeStep, roofTargets, type RoofView } from '../../../src/render/roofs/visibility';
import type { Perspective, ViewMode } from '../../../src/render/contracts';

const W = 12;
const D = 10;

/** A lot with the given wall edges ('h:x:z' / 'v:x:z'); returns the room grid exactly as the sim computes it. */
function rooms(edges: string[], w = W, d = D): Int32Array {
  const set = new Set(edges);
  return computeRooms(w, d, (x, z) => set.has(`h:${x}:${z}`), (x, z) => set.has(`v:${x}:${z}`)).roomOf;
}
/** The wall edges of a rectangle of tiles [x0,x1) x [z0,z1). */
function box(x0: number, z0: number, x1: number, z1: number): string[] {
  const out: string[] = [];
  for (let x = x0; x < x1; x++) out.push(`h:${x}:${z0}`, `h:${x}:${z1}`);
  for (let z = z0; z < z1; z++) out.push(`v:${x0}:${z}`, `v:${x1}:${z}`);
  return out;
}
const buildings = (edges: string[], w = W, d = D) => findBuildings(w, d, rooms(edges, w, d));
const flatColor = (): Rgb => [0.8, 0.75, 0.65];

describe('which tiles get a ceiling', () => {
  it('a closed room: a ceiling over exactly its tiles, one building, one room', () => {
    const edges = box(3, 3, 7, 6); // 4 x 3 tiles
    const b = buildings(edges);
    expect(b).toHaveLength(1);
    expect(b[0].cells).toHaveLength(12);
    expect(b[0].rooms).toHaveLength(1);
    expect(b[0].rect).toBe(true);
    expect([b[0].minX, b[0].maxX, b[0].minZ, b[0].maxZ]).toEqual([3, 6, 3, 5]);
    const ceil = buildCeilingArrays(b[0], W, rooms(edges), 2.7, flatColor);
    expect(triangles(ceil)).toBe(24); // two triangles per tile, nothing else
  });

  it('an L-shape: one building, every tile of the L, and not the notch', () => {
    // an L made of two rooms sharing a wall: 4x2 on top, 2x2 below the left end
    const edges = [...box(2, 2, 6, 4), ...box(2, 4, 4, 6)];
    const b = buildings(edges);
    expect(b).toHaveLength(1);
    expect(b[0].cells).toHaveLength(8 + 4);
    expect(b[0].rooms).toHaveLength(2);
    expect(b[0].rect).toBe(false);
    // the notch (x 4..5, z 4..5) is outdoors and has no ceiling
    const roomOf = rooms(edges);
    expect(roomOf[4 * W + 5]).toBe(0);
    expect(b[0].cells.includes(4 * W + 5)).toBe(false);
    expect(buildingAt(b, W, 5.5, 4.5)).toBe(-1);
    expect(buildingAt(b, W, 3.5, 4.5)).toBe(0);
    expect(triangles(buildCeilingArrays(b[0], W, roomOf, 2.7, flatColor))).toBe(24);
  });

  it('a room with a gap to the outside is open: no ceiling at all', () => {
    const edges = box(3, 3, 7, 6).filter((e) => e !== 'h:5:6'); // one wall segment missing on the south side
    expect(buildings(edges)).toHaveLength(0);
  });

  it('open yard and an empty lot get none', () => {
    expect(buildings([])).toHaveLength(0);
    expect(findBuildings(0, 0, [])).toEqual([]);
  });

  it('a room touching the lot border is outdoors (the sim rule) and gets none', () => {
    expect(buildings(box(0, 0, 3, 3))).toHaveLength(0);
  });

  it('two houses with a tile of yard between them are two buildings, ids ordered by lowest tile, stable on a rerun', () => {
    const edges = [...box(1, 1, 4, 4), ...box(6, 2, 10, 6)];
    const a = buildings(edges);
    const b = buildings(edges);
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.cells.length)).toEqual([9, 16]);
    expect(a.map((x) => x.id)).toEqual([0, 1]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(buildingAt(a, W, 2.5, 2.5)).toBe(0);
    expect(buildingAt(a, W, 7.5, 3.5)).toBe(1);
    expect(buildingAt(a, W, 5.5, 3.5)).toBe(-1);
  });

  it('two rooms that share a wall are ONE building (one roof), two rooms under it', () => {
    const edges = [...box(2, 2, 5, 5), ...box(5, 2, 8, 5)];
    const b = buildings(edges);
    expect(b).toHaveLength(1);
    expect(b[0].rooms).toHaveLength(2);
    expect(b[0].rect).toBe(true);
  });

  it('buildingAt is safe for junk points', () => {
    const b = buildings(box(3, 3, 7, 6));
    for (const [x, z] of [[NaN, 1], [1, Infinity], [-5, 4], [99, 99], [4, -2]] as const) expect(buildingAt(b, W, x, z)).toBe(-1);
  });
});

describe('the outline', () => {
  it('a rectangle has 2 * (w + d) outline edges and an L has the same perimeter as its drawing', () => {
    const rect = buildings(box(3, 3, 7, 6))[0];
    expect(boundaryEdges(rect, W)).toHaveLength(2 * (4 + 3));
    const l = buildings([...box(2, 2, 6, 4), ...box(2, 4, 4, 6)])[0];
    expect(boundaryEdges(l, W)).toHaveLength(16 + 0); // 4x2 on top (12) + 2x2 below the left end adds 4 more edges than it covers
  });

  it('every outline edge faces away from its building', () => {
    const l = buildings([...box(2, 2, 6, 4), ...box(2, 4, 4, 6)])[0];
    const cells = new Set(l.cells);
    for (const e of boundaryEdges(l, W)) {
      const mx = (e.x0 + e.x1) / 2 + e.nx * 0.25;
      const mz = (e.z0 + e.z1) / 2 + e.nz * 0.25;
      expect(cells.has(Math.floor(mz) * W + Math.floor(mx)), JSON.stringify(e)).toBe(false);
    }
  });
});

/** Every triangle's geometric normal agrees with the normal stored on its vertices, and no vertex is NaN or underground. */
function expectSound(m: MeshArrays, minY = 0): void {
  expect(m.positions.length % 3).toBe(0);
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.colors.length).toBe(m.positions.length);
  expect(m.positions.every((v) => Number.isFinite(v))).toBe(true);
  for (let v = 1; v < m.positions.length; v += 3) expect(m.positions[v]).toBeGreaterThanOrEqual(minY);
  expect(m.colors.every((c) => c >= 0 && c <= 1)).toBe(true);
  expect(m.indices.every((i) => i >= 0 && i < m.positions.length / 3)).toBe(true);
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const p = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(g[0], g[1], g[2]);
    expect(len, `degenerate triangle ${t / 3}`).toBeGreaterThan(1e-9);
    const n = [m.normals[a * 3], m.normals[a * 3 + 1], m.normals[a * 3 + 2]];
    expect((g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / len, `triangle ${t / 3} winds against its normal`).toBeGreaterThan(0.9);
  }
}

describe('the geometry', () => {
  const H = 2.7;

  it('the ceiling faces DOWN, sits just under the wall top, and is tinted per room', () => {
    const edges = [...box(2, 2, 5, 5), ...box(5, 2, 8, 5)];
    const roomOf = rooms(edges);
    const b = findBuildings(W, D, roomOf)[0];
    const tint = (room: number): Rgb => (room === b.rooms[0] ? [0.9, 0.2, 0.2] : [0.2, 0.2, 0.9]);
    const c = buildCeilingArrays(b, W, roomOf, H, tint);
    expectSound(c, H - 0.05);
    for (let v = 0; v < c.normals.length; v += 3) expect(c.normals[v + 1]).toBe(-1);
    for (let v = 1; v < c.positions.length; v += 3) expect(c.positions[v]).toBeCloseTo(H - ROOF.ceilingDrop, 6);
    const reds: number[] = [];
    const blues: number[] = [];
    for (let v = 0; v < c.colors.length; v += 3) (c.colors[v] > 0.5 ? reds : blues).push(v);
    expect(reds.length).toBe(blues.length); // two equal rooms, two tints
    expect(reds.length).toBeGreaterThan(0);
  });

  it('beams only when asked (High): none by default, and they hang below the ceiling plane', () => {
    const edges = box(3, 3, 7, 6);
    const roomOf = rooms(edges);
    const b = findBuildings(W, D, roomOf)[0];
    const plain = buildCeilingArrays(b, W, roomOf, H, flatColor);
    const beamed = buildCeilingArrays(b, W, roomOf, H, flatColor, true);
    expect(triangles(beamed)).toBeGreaterThan(triangles(plain));
    expect(triangles(plain)).toBe(b.cells.length * 2);
    expectSound(beamed, H - 0.5);
  });

  it('a rectangle gets a low gable: ridge at the pitch above the eaves, overhanging the walls, every face facing outward', () => {
    const b = findBuildings(W, D, rooms(box(3, 3, 7, 6)))[0];
    const r = buildRoofArrays(b, W, H);
    expectSound(r, H - 0.1);
    const ys = r.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(H + ROOF.pitch, 6);
    const xs = r.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(3 - ROOF.overhang, 6);
    expect(Math.max(...xs)).toBeCloseTo(7 + ROOF.overhang, 6);
    expect(triangles(r)).toBe(2 * 2 + 2); // two slopes (a quad each) and two gable ends
    // the slopes face up; the ends face sideways
    const upFacing = [];
    for (let v = 0; v < r.normals.length; v += 3) if (r.normals[v + 1] > 0.5) upFacing.push(v);
    expect(upFacing.length).toBe(8);
  });

  it('the ridge runs along the longer side', () => {
    const wide = buildRoofArrays(findBuildings(W, D, rooms(box(2, 3, 9, 6)))[0], W, H);
    const tall = buildRoofArrays(findBuildings(W, D, rooms(box(3, 2, 6, 9)))[0], W, H);
    const ridgeVerts = (m: MeshArrays) => {
      const out: number[][] = [];
      for (let v = 0; v < m.positions.length; v += 3) if (Math.abs(m.positions[v + 1] - (H + ROOF.pitch)) < 1e-6) out.push([m.positions[v], m.positions[v + 2]]);
      return out;
    };
    const wr = ridgeVerts(wide);
    const tr = ridgeVerts(tall);
    expect(new Set(wr.map((p) => p[1])).size).toBe(1); // wide house: ridge at one z, along x
    expect(new Set(tr.map((p) => p[0])).size).toBe(1); // tall house: ridge at one x, along z
  });

  it('an L-shape gets a flat slab with a rim over exactly its tiles, using the shingle colour family', () => {
    const b = findBuildings(W, D, rooms([...box(2, 2, 6, 4), ...box(2, 4, 4, 6)]))[0];
    const r = buildRoofArrays(b, W, H);
    expectSound(r, H - 0.01);
    const top = H + ROOF.slab;
    let slabTris = 0;
    for (let t = 0; t < r.indices.length; t += 3) {
      const a = r.indices[t];
      if (r.positions[a * 3 + 1] === top && r.normals[a * 3 + 1] === 1) slabTris++;
    }
    expect(slabTris).toBe(b.cells.length * 2);
    expect(Math.max(...r.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(top + ROOF.rim, 6);
    for (let c = 0; c < r.colors.length; c += 3) expect(r.colors[c]).toBeLessThanOrEqual(SHINGLE[0] * 1.2);
  });

  it('one mesh per building: a building is a single draw for ceilings and a single draw for its roof (two meshes), however many rooms', () => {
    const edges = [...box(1, 1, 4, 4), ...box(4, 1, 7, 4), ...box(7, 1, 10, 4), ...box(2, 6, 5, 9)];
    const bs = buildings(edges);
    const roomOf = rooms(edges);
    expect(bs.length).toBeLessThanOrEqual(2);
    for (const b of bs) {
      expect(triangles(buildCeilingArrays(b, W, roomOf, H, flatColor))).toBe(b.cells.length * 2);
      expectSound(buildRoofArrays(b, W, H), H - 0.1);
    }
  });

  it('is deterministic: the same building gives byte-identical arrays', () => {
    const b = findBuildings(W, D, rooms([...box(2, 2, 6, 4), ...box(2, 4, 4, 6)]))[0];
    expect(JSON.stringify(buildRoofArrays(b, W, H))).toBe(JSON.stringify(buildRoofArrays(b, W, H)));
  });
});

describe('what shows when', () => {
  const two: Building[] = findBuildings(W, D, rooms([...box(1, 1, 4, 4), ...box(6, 2, 10, 6)]));
  const view = (o: Partial<RoofView>): RoofView => ({ viewMode: 'live', perspective: 'overview', subjectBuilding: 0, ...o });

  it('Build and Buy: roofs and ceilings are always hidden, in every perspective', () => {
    for (const viewMode of ['buy', 'build'] as ViewMode[])
      for (const perspective of ['overview', 'shoulder', 'firstPerson'] as Perspective[])
        for (const subject of [-1, 0, 1]) expect(roofTargets(two, view({ viewMode, perspective, subjectBuilding: subject })), `${viewMode}/${perspective}/${subject}`).toEqual([{ roof: 0, ceiling: 0 }, { roof: 0, ceiling: 0 }]);
  });

  it('rule 1: from above (overview AND shoulder) every roof on the lot is hidden, identical whoever is where (inside A, inside B, outdoors, nobody)', () => {
    for (const perspective of ['overview', 'shoulder'] as Perspective[])
      for (const subjectBuilding of [0, 1, -1])
        expect(roofTargets(two, view({ perspective, subjectBuilding })).map((t) => t.roof), `${perspective}/${subjectBuilding}`).toEqual([0, 0]);
  });

  it('NEGATIVE CONTROL: first person is the one view that keeps every roof, whoever is where', () => {
    for (const subjectBuilding of [0, 1, -1]) expect(roofTargets(two, view({ perspective: 'firstPerson', subjectBuilding })).map((t) => t.roof)).toEqual([1, 1]);
  });

  it('rule 3: the shoulder wants the ceiling of the subject\'s building only; the overview wants none (invisible from above)', () => {
    expect(roofTargets(two, view({ perspective: 'shoulder', subjectBuilding: 0 })).map((t) => t.ceiling)).toEqual([1, 0]);
    expect(roofTargets(two, view({ perspective: 'shoulder', subjectBuilding: 1 })).map((t) => t.ceiling)).toEqual([0, 1]);
    expect(roofTargets(two, view({ perspective: 'shoulder', subjectBuilding: -1 })).map((t) => t.ceiling)).toEqual([0, 0]);
    for (const subjectBuilding of [0, 1, -1]) expect(roofTargets(two, view({ perspective: 'overview', subjectBuilding })).map((t) => t.ceiling)).toEqual([0, 0]);
  });

  it('first person: the BUILDING you are in has its ceiling wanted (the layer narrows it to your room, see roofLayer.test), roofs stay, other buildings have none', () => {
    expect(roofTargets(two, view({ perspective: 'firstPerson', subjectBuilding: 0 }))).toEqual([{ roof: 1, ceiling: 1 }, { roof: 1, ceiling: 0 }]);
    expect(roofTargets(two, view({ perspective: 'firstPerson', subjectBuilding: -1 }))).toEqual([{ roof: 1, ceiling: 0 }, { roof: 1, ceiling: 0 }]);
  });

  it('no buildings, no targets', () => {
    expect(roofTargets([], view({}))).toEqual([]);
  });
});

describe('the fade', () => {
  it('is a straight line over 0.25 s in either direction, never past the target, with no pop', () => {
    let v = 1;
    const dt = 1 / 60;
    let frames = 0;
    while (v > 0 && frames < 100) {
      const before = v;
      v = fadeStep(v, 0, dt);
      expect(before - v).toBeLessThanOrEqual(dt / FADE_SECONDS + 1e-9);
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(Math.ceil(FADE_SECONDS * 60));
    expect(frames).toBeLessThanOrEqual(Math.ceil(FADE_SECONDS * 60) + 1); // float accumulation may add one frame
    expect(v).toBe(0);
    for (let i = 0; i < 100 && v < 1; i++) v = fadeStep(v, 1, dt);
    expect(v).toBe(1);
    expect(fadeStep(0.5, 0.5, dt)).toBe(0.5);
  });

  it('a long frame still lands exactly on the target; junk time changes nothing; junk values are repaired', () => {
    expect(fadeStep(1, 0, 5)).toBe(0);
    expect(fadeStep(0, 1, 5)).toBe(1);
    for (const bad of [0, -1, NaN, Infinity]) expect(fadeStep(0.4, 0, bad), String(bad)).toBe(0.4);
    expect(fadeStep(NaN, 1, 0.01)).toBe(1);
    expect(fadeStep(7, 1, 0.01)).toBe(1);
    expect(fadeStep(0.5, 9, 10)).toBe(1);
  });

  it('a mesh is drawn only while it is visible: a hidden roof costs no draw call', () => {
    expect(drawn(0)).toBe(false);
    expect(drawn(0.0005)).toBe(false);
    expect(drawn(0.01)).toBe(true);
    expect(drawn(1)).toBe(true);
  });
});
