import { describe, expect, it } from 'vitest';
import {
  MAX_RECT,
  MAX_RUN,
  edgeKey,
  edgeSideTile,
  floorOrigin,
  gridPoint,
  nearestVertex,
  normalizeRot,
  parseEdge,
  rectArea,
  rectTiles,
  slotMarkerTiles,
  tileRect,
  wallRun,
} from '../../../src/game/input/grid';
import { buildLabel, formatMoney } from '../../../src/game/input/format';
import { PHYSICAL_BY_ID } from '../../../src/shared/catalog';
import { edgeDirection, keyPanDirection, normalizeWheel, wheelZoomUnits } from '../../../src/game/input/camera';

describe('edges', () => {
  it('parse/format round trip and reject junk', () => {
    expect(parseEdge(edgeKey('h', 3, 7))).toEqual({ dir: 'h', x: 3, z: 7 });
    expect(parseEdge('v:-1:12')).toEqual({ dir: 'v', x: -1, z: 12 });
    for (const bad of ['x:1:2', 'h:1', 'h:a:b', 'h:1:2:3', '', 42, null, 'h:1.5:2', 'h:9999999:1']) expect(parseEdge(bad)).toBeNull();
  });

  it('side tiles follow the WorldState convention', () => {
    // 'h:x:z' lies on line z: side 0 = -Z tile, side 1 = +Z tile
    expect(edgeSideTile({ dir: 'h', x: 4, z: 6 }, 0)).toEqual({ x: 4, z: 5 });
    expect(edgeSideTile({ dir: 'h', x: 4, z: 6 }, 1)).toEqual({ x: 4, z: 6 });
    // 'v:x:z' lies on line x: side 0 = -X tile, side 1 = +X tile
    expect(edgeSideTile({ dir: 'v', x: 4, z: 6 }, 0)).toEqual({ x: 3, z: 6 });
    expect(edgeSideTile({ dir: 'v', x: 4, z: 6 }, 1)).toEqual({ x: 4, z: 6 });
  });
});

describe('wallRun — drag snapping to straight runs', () => {
  it('horizontal run along the start line', () => {
    expect(wallRun({ x: 2, z: 5 }, { x: 5, z: 6 })).toEqual(['h:2:5', 'h:3:5', 'h:4:5']);
  });
  it('vertical run when the drag is mostly along Z', () => {
    expect(wallRun({ x: 2, z: 5 }, { x: 3, z: 2 })).toEqual(['v:2:2', 'v:2:3', 'v:2:4']);
  });
  it('reverse direction gives the same segments', () => {
    expect(wallRun({ x: 5, z: 5 }, { x: 2, z: 5 })).toEqual(wallRun({ x: 2, z: 5 }, { x: 5, z: 5 }));
  });
  it('zero-length and NaN drags produce nothing; huge drags are bounded', () => {
    expect(wallRun({ x: 1, z: 1 }, { x: 1, z: 1 })).toEqual([]);
    expect(wallRun({ x: NaN, z: 1 }, { x: 3, z: 1 })).toEqual([]);
    expect(wallRun({ x: 0, z: 0 }, { x: 1e9, z: 0 }).length).toBe(MAX_RUN);
  });
  it('ties (exact diagonal) prefer horizontal', () => {
    expect(wallRun({ x: 0, z: 0 }, { x: 2, z: 2 })).toEqual(['h:0:0', 'h:1:0']);
  });
});

describe('rectangles', () => {
  it('inclusive tile drag in any direction', () => {
    expect(tileRect({ x: 5, z: 2 }, { x: 3, z: 4 })).toEqual({ x0: 3, z0: 2, x1: 6, z1: 5 });
    expect(rectArea(tileRect({ x: 1, z: 1 }, { x: 1, z: 1 }))).toBe(1);
    expect(rectTiles({ x0: 0, z0: 0, x1: 2, z1: 2 })).toEqual([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]);
    const huge = tileRect({ x: 0, z: 0 }, { x: 10_000, z: 10_000 });
    expect(huge.x1 - huge.x0).toBe(MAX_RECT);
  });
});

describe('gridPoint — absolute fx/fz (render contract)', () => {
  it('absolute world coordinates pass through', () => {
    expect(gridPoint({ x: 7, z: 3, fx: 7.25, fz: 3.9 })).toEqual({ x: 7.25, z: 3.9 });
  });
  it('float error at tile borders is clamped into the reported tile (never a whole-tile jump)', () => {
    expect(gridPoint({ x: 1, z: 1, fx: 0.99999, fz: 2.00001 })).toEqual({ x: 1, z: 2 });
    expect(gridPoint({ x: 7, z: 3, fx: 0.25, fz: 0.9 })).toEqual({ x: 7, z: 3 });
  });
  it('garbage falls back to the tile centre', () => {
    expect(gridPoint({ x: 7, z: 3, fx: NaN, fz: Infinity })).toEqual({ x: 7.5, z: 3.5 });
  });
  it('nearestVertex rounds', () => {
    expect(nearestVertex({ x: 2.49, z: 2.51 })).toEqual({ x: 2, z: 3 });
  });
});

describe('floor placement + blocked slot markers', () => {
  it('centres the rotated footprint on the cursor', () => {
    expect(floorOrigin({ w: 1, d: 1 }, 0, { x: 5.7, z: 5.2 })).toEqual({ x: 5, z: 5 });
    expect(floorOrigin({ w: 2, d: 1 }, 0, { x: 5.2, z: 5.5 })).toEqual({ x: 4, z: 5 });
    expect(floorOrigin({ w: 2, d: 1 }, 1, { x: 5.5, z: 5.2 })).toEqual({ x: 5, z: 4 });
    expect(floorOrigin({ w: 3, d: 2 }, 0, { x: 10.5, z: 10 })).toEqual({ x: 9, z: 9 });
    expect(floorOrigin({ w: 0, d: NaN as never }, 0, { x: 3.5, z: 3.5 })).toEqual({ x: 3, z: 3 });
  });

  it('marks the approach tile in front of a 1×1 object for every rotation', () => {
    const spec = { footprint: { w: 1, d: 1 }, slots: [{ id: 's', kind: 'stand' as const, approach: [{ x: 0, z: 1 }] }] };
    expect(slotMarkerTiles(spec, 5, 5, 0, [0])).toEqual([{ x: 5, z: 6 }]);
    expect(slotMarkerTiles(spec, 5, 5, 1, [0])).toEqual([{ x: 4, z: 5 }]);
    expect(slotMarkerTiles(spec, 5, 5, 2, [0])).toEqual([{ x: 5, z: 4 }]);
    expect(slotMarkerTiles(spec, 5, 5, 3, [0])).toEqual([{ x: 6, z: 5 }]);
  });

  it('ignores invalid slot indices and de-duplicates', () => {
    const sofa = PHYSICAL_BY_ID.sofa_moldy;
    const all = sofa.slots.map((_, i) => i);
    const tiles = slotMarkerTiles(sofa, 3, 3, 0, [...all, ...all, 99, -1, 1.5]);
    expect(new Set(tiles.map((t) => `${t.x},${t.z}`)).size).toBe(tiles.length);
  });

  it('normalizeRot wraps', () => {
    expect([normalizeRot(-1), normalizeRot(4), normalizeRot(5), normalizeRot(NaN), normalizeRot(2.4)]).toEqual([3, 0, 1, 0, 2]);
  });
});

describe('labels', () => {
  it('formatMoney is signed (refunds negative)', () => {
    expect(formatMoney(45)).toBe('$45');
    expect(formatMoney(-30)).toBe('+$30');
    expect(formatMoney(0)).toBe('Free');
    expect(formatMoney(NaN)).toBe('Free');
    expect(formatMoney(12345)).toBe('$12,345');
  });
  it('build labels', () => {
    expect(buildLabel({ type: 'addWalls', edges: ['h:1:1', 'h:2:1', 'h:3:1'] }, { ok: true, cost: 45 })).toBe('$45 · 3 walls');
    expect(buildLabel({ type: 'removeWalls', edges: ['h:1:1'] }, { ok: true, cost: -10 })).toBe('+$10 · 1 wall removed');
    expect(buildLabel({ type: 'room', x0: 0, z0: 0, x1: 4, z1: 5 }, { ok: true, cost: 300 })).toBe('$300 · 4×5 room');
    expect(buildLabel({ type: 'floor', x0: 0, z0: 0, x1: 2, z1: 4, styleId: 'x' }, { ok: true, cost: 40 })).toBe('$40 · 8 tiles');
    expect(buildLabel({ type: 'floor', x0: 0, z0: 0, x1: 1, z1: 1, styleId: null }, { ok: true, cost: 0 })).toBe('Free · remove 1 floor tile');
    expect(buildLabel({ type: 'addWalls', edges: [] }, { ok: false, reason: 'Not enough money', cost: 0 })).toBe('Not enough money');
    expect(buildLabel({ type: 'addWalls', edges: [] }, { ok: false, cost: 0 })).toBe("Can't build here");
    expect(buildLabel({ type: 'addWalls', edges: [] }, null)).toBeNull();
  });
});

describe('camera input math', () => {
  it('wheel normalisation across delta modes', () => {
    expect(normalizeWheel(100, 0)).toBe(100);
    expect(normalizeWheel(3, 1)).toBe(48);
    expect(normalizeWheel(1, 2, 700)).toBe(700);
    expect(normalizeWheel(NaN, 0)).toBe(0);
    expect(normalizeWheel(1e9, 0)).toBe(1000);
  });
  it('wheel zoom: up = closer, invertZoom flips, bounded', () => {
    expect(wheelZoomUnits(-100, 0, false)).toBe(1);
    expect(wheelZoomUnits(-100, 0, true)).toBe(-1);
    expect(wheelZoomUnits(-1e9, 0, false)).toBe(3);
  });
  it('edge scroll only near borders and only inside the viewport', () => {
    expect(edgeDirection(5, 300, 1280, 720)).toEqual({ dx: -1, dz: 0 });
    expect(edgeDirection(1275, 715, 1280, 720)).toEqual({ dx: 1, dz: 1 });
    expect(edgeDirection(640, 360, 1280, 720)).toEqual({ dx: 0, dz: 0 });
    expect(edgeDirection(-5, 300, 1280, 720)).toEqual({ dx: 0, dz: 0 });
    expect(edgeDirection(5, 5, 20, 20)).toEqual({ dx: 0, dz: 0 });
  });
  it('held-key pan direction is diagonal-normalised', () => {
    const d = keyPanDirection(new Set(['panUp', 'panRight']));
    expect(Math.hypot(d.dx, d.dz)).toBeCloseTo(1, 10);
    expect(keyPanDirection(new Set(['panLeft', 'panRight']))).toEqual({ dx: 0, dz: 0 });
  });
});
