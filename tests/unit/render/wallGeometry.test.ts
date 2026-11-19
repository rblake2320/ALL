import { describe, it, expect } from 'vitest';
import { buildWallMesh, applyWallHeights, updatePostHeights, vertexNeedsPost, sanitizeCut, sideMirrored, rayWalls, type OpeningCut } from '../../../src/render/build/wallGeometry';
import { wallAtlasLayout, wallStyleSlot, WALL_SLOT_COUNT, floorStyleSlot, floorAtlasLayout, floorTileUV, FLOOR_FALLBACK_SLOT } from '../../../src/render/build/atlasLayout';
import { DIM } from '../../../src/shared/dimensions';
import { WALL_STYLES, DEFAULT_INTERIOR_WALL } from '../../../src/shared/styles';
import type { WallSegment } from '../../../src/sim/types';

const layout = wallAtlasLayout(32); // small px density keeps tests fast
const cells = layout.cells;
const seg = (a = 'wall_plaster_bone', b = 'wall_exterior_siding'): WallSegment => ({ paint: [a, b], openingId: null });
const none = () => null;

/** A 2×2 room: tiles [2,4)×[2,4). */
function room(): Record<string, WallSegment> {
  const w: Record<string, WallSegment> = {};
  for (const x of [2, 3]) {
    w[`h:${x}:2`] = seg();
    w[`h:${x}:4`] = seg();
  }
  for (const z of [2, 3]) {
    w[`v:2:${z}`] = seg();
    w[`v:4:${z}`] = seg();
  }
  return w;
}

function bbox(pos: Float32Array): number[] {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

describe('wall atlas layout', () => {
  it('has a slot for every style + trim + cap, all inside [0,1] UV space without overlap', () => {
    expect(cells.length).toBe(WALL_SLOT_COUNT);
    for (const c of cells) {
      expect(c.u0).toBeGreaterThanOrEqual(0);
      expect(c.u1).toBeLessThanOrEqual(1);
      expect(c.v0).toBeGreaterThanOrEqual(0);
      expect(c.v1).toBeLessThanOrEqual(1);
      expect(c.u1).toBeGreaterThan(c.u0);
      expect(c.v1).toBeGreaterThan(c.v0);
    }
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], b = cells[j];
        const overlap = a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
        expect(overlap).toBe(false);
      }
  });

  it('style slots: known ids map to their index, unknown ids to the default interior wall', () => {
    WALL_STYLES.forEach((s, i) => expect(wallStyleSlot(s.id)).toBe(i));
    const def = WALL_STYLES.findIndex((s) => s.id === DEFAULT_INTERIOR_WALL);
    for (const g of ['nope', '', null, undefined, 3, {}]) expect(wallStyleSlot(g)).toBe(def);
  });

  it('floor slots + per-tile quarter UVs are continuous across neighbouring tiles', () => {
    const fl = floorAtlasLayout(16);
    expect(floorStyleSlot(null)).toBe(-1);
    expect(floorStyleSlot('floor_parquet')).toBeGreaterThanOrEqual(0);
    expect(floorStyleSlot('mystery')).toBe(FLOOR_FALLBACK_SLOT);
    const cell = fl.cells[0];
    const a = floorTileUV(cell, 4, 6, { u0: 0, v0: 0, u1: 0, v1: 0 });
    const b = floorTileUV(cell, 5, 6, { u0: 0, v0: 0, u1: 0, v1: 0 });
    expect(b.u0).toBeCloseTo(a.u1, 12); // x neighbour continues in u
    const c = floorTileUV(cell, 4, 7, { u0: 0, v0: 0, u1: 0, v1: 0 });
    expect(c.v1).toBeCloseTo(a.v0, 12); // z neighbour continues in v
    const neg = floorTileUV(cell, -3, -1, { u0: 0, v0: 0, u1: 0, v1: 0 });
    expect(neg.u0).toBeGreaterThanOrEqual(cell.u0);
    expect(neg.v0).toBeGreaterThanOrEqual(cell.v0 - 1e-12);
  });
});

describe('wall mesh builder', () => {
  it('builds a closed room with 4 corner posts and walls exactly WALL_HEIGHT tall', () => {
    const m = buildWallMesh(room(), none, cells);
    expect(m.segments.length).toBe(8);
    expect(m.posts.length).toBe(4); // only the corners; straight joints get no post
    expect(m.slotCount).toBe(12);
    const [minX, minY, minZ, maxX, maxY, maxZ] = bbox(m.positions);
    const h = DIM.WALL_THICKNESS / 2;
    expect(minX).toBeCloseTo(2 - h);
    expect(maxX).toBeCloseTo(4 + h);
    expect(minZ).toBeCloseTo(2 - h);
    expect(maxZ).toBeCloseTo(4 + h);
    expect(minY).toBe(0);
    expect(maxY).toBeCloseTo(DIM.WALL_HEIGHT);
    expect(m.indices.length % 3).toBe(0);
    for (const i of m.indices) expect(i).toBeLessThan(m.vertexCount);
  });

  it('every triangle winds counter-clockwise around its stored normal', () => {
    const m = buildWallMesh(room(), (k) => (k === 'h:2:4' ? { kind: 'door', width: DIM.DOOR_WIDTH, bottom: 0, top: DIM.DOOR_HEIGHT } : null), cells);
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
      const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const sn = [m.normals[a * 3], m.normals[a * 3 + 1], m.normals[a * 3 + 2]];
      expect(n[0] * sn[0] + n[1] * sn[1] + n[2] * sn[2]).toBeGreaterThan(0);
    }
  });

  it('segments are trimmed by half a thickness only where a post exists', () => {
    const m = buildWallMesh(room(), none, cells);
    const h = DIM.WALL_THICKNESS / 2;
    const s = m.segments.find((x) => x.key === 'h:2:2')!;
    expect(s.s0).toBeCloseTo(2 + h); // corner post at (2,2)
    expect(s.s1).toBeCloseTo(3); // straight joint at (3,2)
  });

  it('post rules', () => {
    expect(vertexNeedsPost({ px: 0, nx: -1, pz: -1, nz: -1 })).toBe(true); // free end
    expect(vertexNeedsPost({ px: 0, nx: 1, pz: -1, nz: -1 })).toBe(false); // straight X joint
    expect(vertexNeedsPost({ px: -1, nx: -1, pz: 0, nz: 1 })).toBe(false); // straight Z joint
    expect(vertexNeedsPost({ px: 0, nx: -1, pz: 1, nz: -1 })).toBe(true); // L
    expect(vertexNeedsPost({ px: 0, nx: 1, pz: 2, nz: -1 })).toBe(true); // T
    expect(vertexNeedsPost({ px: 0, nx: 1, pz: 2, nz: 3 })).toBe(true); // X
    expect(vertexNeedsPost({ px: -1, nx: -1, pz: -1, nz: -1 })).toBe(false);
  });

  /** Does a ray (o + t·d, t ∈ [0, 20]) hit any triangle of the mesh positions? (Möller–Trumbore) */
  function rayHits(pos: Float32Array, idx: Uint32Array, o: number[], d: number[]): boolean {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
      const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const s = [o[0] - pos[a], o[1] - pos[a + 1], o[2] - pos[a + 2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
      if (tt >= 0 && tt <= 20) return true;
    }
    return false;
  }

  it('door cut leaves a walk-through gap up to the door height, solid above and beside', () => {
    const walls = { 'h:5:5': seg() };
    const cut: OpeningCut = { kind: 'door', width: DIM.DOOR_WIDTH, bottom: 0, top: DIM.DOOR_HEIGHT };
    const m = buildWallMesh(walls, () => cut, cells);
    const half = DIM.DOOR_WIDTH / 2;
    // rays along -Z through the wall plane (z = 5) from z = 6
    for (const x of [5.5 - half + 0.03, 5.5, 5.5 + half - 0.03])
      for (const y of [0.05, 1.0, DIM.DOOR_HEIGHT - 0.05]) expect(rayHits(m.positions, m.indices, [x, y, 6], [0, 0, -1])).toBe(false);
    expect(rayHits(m.positions, m.indices, [5.5, DIM.DOOR_HEIGHT + 0.1, 6], [0, 0, -1])).toBe(true); // header
    expect(rayHits(m.positions, m.indices, [5.04, 1.0, 6], [0, 0, -1])).toBe(true); // jamb
    expect(rayHits(m.positions, m.indices, [5.96, 1.0, 6], [0, 0, -1])).toBe(true);
  });

  it('window cut keeps a sill below and a lintel above; the pane area is open', () => {
    const walls = { 'v:5:5': seg() };
    const top = DIM.WINDOW_SILL + DIM.WINDOW_HEIGHT;
    const cut: OpeningCut = { kind: 'window', width: DIM.WINDOW_WIDTH, bottom: DIM.WINDOW_SILL, top };
    const m = buildWallMesh(walls, () => cut, cells);
    // rays along -X through the wall plane (x = 5) from x = 6
    expect(rayHits(m.positions, m.indices, [6, (DIM.WINDOW_SILL + top) / 2, 5.5], [-1, 0, 0])).toBe(false);
    expect(rayHits(m.positions, m.indices, [6, DIM.WINDOW_SILL + 0.05, 5.3], [-1, 0, 0])).toBe(false);
    expect(rayHits(m.positions, m.indices, [6, DIM.WINDOW_SILL - 0.1, 5.5], [-1, 0, 0])).toBe(true); // sill
    expect(rayHits(m.positions, m.indices, [6, top + 0.1, 5.5], [-1, 0, 0])).toBe(true); // lintel
    expect(rayHits(m.positions, m.indices, [6, 1.5, 5.02], [-1, 0, 0])).toBe(true); // jamb
  });

  it('when lowered, a window wall is a solid low strip and the door gap stays open', () => {
    const walls = { 'h:5:5': seg(), 'h:6:5': seg() };
    const m = buildWallMesh(
      walls,
      (k) => (k === 'h:5:5' ? { kind: 'door', width: DIM.DOOR_WIDTH, bottom: 0, top: DIM.DOOR_HEIGHT } : { kind: 'window', width: DIM.WINDOW_WIDTH, bottom: DIM.WINDOW_SILL, top: 2.05 }),
      cells,
    );
    const heights = new Float32Array(m.slotCount).fill(DIM.WALL_CUTAWAY_HEIGHT);
    updatePostHeights(m, heights);
    const pos = new Float32Array(m.positions);
    applyWallHeights(m, heights, pos, new Float32Array(m.uvs));
    expect(rayHits(pos, m.indices, [6.5, 0.1, 6], [0, 0, -1])).toBe(true); // window wall: low solid strip
    expect(rayHits(pos, m.indices, [6.5, 0.5, 6], [0, 0, -1])).toBe(false); // above the strip
    expect(rayHits(pos, m.indices, [5.5, 0.1, 6], [0, 0, -1])).toBe(false); // door gap still open
  });

  it('cutaway heights: lowered walls clip to the cutaway height and headers collapse', () => {
    const walls = { 'h:5:5': seg(), 'h:6:5': seg() };
    const m = buildWallMesh(walls, (k) => (k === 'h:5:5' ? { kind: 'door', width: DIM.DOOR_WIDTH, bottom: 0, top: DIM.DOOR_HEIGHT } : null), cells);
    const heights = new Float32Array(m.slotCount).fill(DIM.WALL_CUTAWAY_HEIGHT);
    updatePostHeights(m, heights);
    const pos = new Float32Array(m.positions);
    const uvs = new Float32Array(m.uvs);
    applyWallHeights(m, heights, pos, uvs);
    const [, , , , maxY] = bbox(pos);
    expect(maxY).toBeCloseTo(DIM.WALL_CUTAWAY_HEIGHT);
    // nothing floats over the door gap
    const g0 = 5.5 - DIM.DOOR_WIDTH / 2 + 0.02;
    const g1 = 5.5 + DIM.DOOR_WIDTH / 2 - 0.02;
    for (let i = 0; i < m.vertexCount; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1];
      if (x > g0 && x < g1 && y > 0.01) {
        // only collapsed header vertices (at their anchor on the header bottom) may be here — they are degenerate
        expect(m.pieceBottom[i]).toBeGreaterThan(0);
      }
    }
    // triangles of collapsed pieces have zero area
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
      if (m.pieceBottom[a] > 0) {
        expect(pos[a * 3]).toBe(pos[b * 3]);
        expect(pos[a * 3 + 1]).toBe(pos[c * 3 + 1]);
      }
    }
    // full height restores the original geometry exactly
    heights.fill(DIM.WALL_HEIGHT);
    applyWallHeights(m, heights, pos, uvs);
    for (let i = 0; i < pos.length; i++) expect(pos[i]).toBeCloseTo(m.positions[i], 6);
    for (let i = 0; i < uvs.length; i++) expect(uvs[i]).toBeCloseTo(m.uvs[i], 6);
  });

  it('posts follow their tallest arm', () => {
    const m = buildWallMesh(room(), none, cells);
    const heights = new Float32Array(m.slotCount).fill(DIM.WALL_CUTAWAY_HEIGHT);
    const front = m.segments.findIndex((s) => s.key === 'v:2:2');
    heights[front] = DIM.WALL_HEIGHT;
    updatePostHeights(m, heights);
    const p = m.posts.find((q) => q.x === 2 && q.z === 2)!;
    expect(heights[p.slot]).toBeCloseTo(DIM.WALL_HEIGHT, 5);
    const p2 = m.posts.find((q) => q.x === 4 && q.z === 4)!;
    expect(heights[p2.slot]).toBeCloseTo(DIM.WALL_CUTAWAY_HEIGHT, 5);
  });

  it('wallpaper UVs: side faces map world height linearly into the cell and stay in-cell (± gutter)', () => {
    const m = buildWallMesh(room(), none, cells);
    const gutterU = layout.gutter / layout.width + 1e-6;
    for (let i = 0; i < m.vertexCount; i++) {
      if (m.vScale[i] === 0) continue;
      const v = m.uvs[i * 2 + 1];
      expect(v).toBeCloseTo(m.vBase[i] + m.designY[i] * m.vScale[i], 6);
      const u = m.uvs[i * 2];
      const owner = cells.find((c) => u >= c.u0 - gutterU && u <= c.u1 + gutterU && v >= c.v0 - 1e-6 && v <= c.v1 + 1e-6);
      expect(owner).toBeDefined();
    }
  });

  it('mirroring keeps patterns readable from both sides', () => {
    expect(sideMirrored('h', 1)).toBe(false);
    expect(sideMirrored('h', 0)).toBe(true);
    expect(sideMirrored('v', 0)).toBe(false);
    expect(sideMirrored('v', 1)).toBe(true);
  });

  describe('adversarial', () => {
    it('ignores malformed keys and garbage segments; empty / null walls give an empty mesh', () => {
      const walls = {
        'h:1:1': seg(),
        bogus: seg(),
        'q:1:1': seg(),
        'h:2:1': { paint: 'not-an-array', openingId: null } as unknown as WallSegment,
        'h:3:1': null as unknown as WallSegment,
      };
      const m = buildWallMesh(walls, none, cells);
      expect(m.segments.map((s) => s.key)).toEqual(['h:1:1', 'h:2:1', 'h:3:1']);
      expect(buildWallMesh(null, none, cells).vertexCount).toBe(0);
      expect(buildWallMesh({}, none, cells).posts.length).toBe(0);
    });

    it('a throwing opening lookup yields a solid wall', () => {
      const m = buildWallMesh({ 'h:1:1': seg() }, () => {
        throw new Error('boom');
      }, cells);
      expect(m.segments[0].opening).toBeNull();
    });

    it('garbage cuts are sanitised into a valid gap', () => {
      const c = sanitizeCut({ kind: 'window', width: NaN, bottom: -5, top: 99 });
      expect(c.width).toBeGreaterThan(0.1);
      expect(c.bottom).toBeGreaterThanOrEqual(0);
      expect(c.top).toBeLessThan(DIM.WALL_HEIGHT);
      expect(c.top).toBeGreaterThan(c.bottom);
      const d = sanitizeCut({ kind: 'door', width: 5, bottom: 1, top: 0.1 });
      expect(d.bottom).toBe(0);
      expect(d.width).toBeLessThan(1);
      expect(d.top).toBeGreaterThan(0.1);
      const odd = sanitizeCut({ kind: 'portal' as 'door', width: 0.5, bottom: 0.5, top: 1.5 });
      expect(odd.kind).toBe('window');
    });

    it('all generated positions/uvs/normals are finite, even with unknown paints', () => {
      const m = buildWallMesh({ 'h:0:0': seg('???', '!!!'), 'v:0:0': seg(), 'v:1:0': seg() }, none, cells);
      for (const arr of [m.positions, m.uvs, m.normals]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
    });
  });
});

describe('wall ray picking (rayWalls)', () => {
  const door = (k: string): OpeningCut | null => (k === 'h:2:4' ? { kind: 'door', width: DIM.DOOR_WIDTH, bottom: 0, top: DIM.DOOR_HEIGHT } : null);
  const win = (k: string): OpeningCut | null => (k === 'h:3:4' ? { kind: 'window', width: 0.8, bottom: DIM.WINDOW_SILL, top: DIM.WINDOW_SILL + 1 } : null);
  const both = (k: string) => door(k) ?? win(k);
  const full = (n: number) => new Float32Array(n).fill(DIM.WALL_HEIGHT);
  // a street-side camera ray from +Z (side 1) that reaches the front wall line z = 4 at height y (t = 1)
  const aim = (x: number, y: number): [number, number, number, number, number, number] => [x, y + 3, 9, 0, -3, -5];

  it('hits the nearest wall and reports the side the ray comes from', () => {
    const m = buildWallMesh(room(), none, cells);
    const hit = rayWalls(m.segments, full(m.slotCount), ...aim(2.5, 1.0));
    expect(hit?.segment.key).toBe('h:2:4');
    expect(hit?.side).toBe(1);
    // from inside the room looking toward -Z hits the back wall from side 1 as well; from behind, side 0
    const back = rayWalls(m.segments, full(m.slotCount), 2.5, 1, 3.5, 0, 0, -1);
    expect(back).toMatchObject({ side: 1 });
    expect(back?.segment.key).toBe('h:2:2');
    const behind = rayWalls(m.segments, full(m.slotCount), 2.5, 1, -3, 0, 0, 1);
    expect(behind).toMatchObject({ side: 0 });
    expect(behind?.segment.key).toBe('h:2:2');
  });

  it('a ray through an open doorway passes into the room (and hits the far wall)', () => {
    const m = buildWallMesh(room(), both, cells);
    const hit = rayWalls(m.segments, full(m.slotCount), 2.5, 1.0, 9, 0, 0, -1);
    expect(hit?.segment.key).toBe('h:2:2');
    // beside the door leaf (outside the gap) the wall is solid
    const jamb = rayWalls(m.segments, full(m.slotCount), 2.03, 1.0, 9, 0, 0, -1);
    expect(jamb?.segment.key).toBe('h:2:4');
    // above the door: the header is solid
    const header = rayWalls(m.segments, full(m.slotCount), 2.5, DIM.DOOR_HEIGHT + 0.1, 9, 0, 0, -1);
    expect(header?.segment.key).toBe('h:2:4');
  });

  it('window panes let the ray through; the sill below and the lintel above do not', () => {
    const m = buildWallMesh(room(), both, cells);
    expect(rayWalls(m.segments, full(m.slotCount), 3.5, DIM.WINDOW_SILL + 0.5, 9, 0, 0, -1)?.segment.key).toBe('h:3:2');
    expect(rayWalls(m.segments, full(m.slotCount), 3.5, DIM.WINDOW_SILL - 0.2, 9, 0, 0, -1)?.segment.key).toBe('h:3:4');
    expect(rayWalls(m.segments, full(m.slotCount), 3.5, DIM.WINDOW_SILL + 1.1, 9, 0, 0, -1)?.segment.key).toBe('h:3:4');
  });

  it('lowered walls: rays over them miss, the door gap stays open from the top, lowered window walls are solid', () => {
    const m = buildWallMesh(room(), both, cells);
    const h = full(m.slotCount);
    for (const s of m.segments) if (s.key === 'h:2:4' || s.key === 'h:3:4') h[s.slot] = 0.35;
    // a steep ray from above entering the lowered door wall's top face inside the gap
    const doorTop = rayWalls(m.segments, h, 2.5, 6, 4.0 + 0.6, 0, -1, -0.1);
    expect(doorTop?.segment.key).not.toBe('h:2:4');
    // the lowered window wall's top face is solid
    const winTop = rayWalls(m.segments, h, 3.5, 6, 4.0 + 0.6, 0, -1, -0.1);
    expect(winTop?.segment.key).toBe('h:3:4');
    // a ray passing above the lowered wall continues to the back wall
    expect(rayWalls(m.segments, h, 3.5, 1.5, 9, 0, 0, -1)?.segment.key).toBe('h:3:2');
    // fully collapsed walls are ignored
    h.fill(0);
    expect(rayWalls(m.segments, h, 3.5, 1, 9, 0, 0, -1)).toBeNull();
  });

  it('adversarial: NaN rays, garbage segments / heights and empty walls never throw', () => {
    const m = buildWallMesh(room(), both, cells);
    expect(rayWalls(m.segments, full(m.slotCount), NaN, 1, 9, 0, 0, -1)).toBeNull();
    expect(rayWalls(m.segments, full(m.slotCount), 2.5, 1, 9, 0, 0, Infinity)).toBeNull();
    expect(rayWalls([], full(0), 2.5, 1, 9, 0, 0, -1)).toBeNull();
    expect(rayWalls(null as never, full(0), 2.5, 1, 9, 0, 0, -1)).toBeNull();
    const garbage = [null, { slot: 0 }, ...m.segments] as never[];
    const nanHeights = new Float32Array(m.slotCount).fill(NaN);
    expect(rayWalls(garbage, nanHeights, 2.5, 1, 9, 0, 0, -1)).toBeNull();
    expect(rayWalls(m.segments, full(m.slotCount), 2.5, 1, 9, 0, 0, -1, NaN)?.segment.key).toBe('h:2:2');
  });
});
