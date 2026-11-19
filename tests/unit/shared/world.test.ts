/**
 * W-025 / D-068 world contract helpers (src/shared/world.ts): lot ↔ world transforms, cell ids, seed normalisation,
 * the frozen hash and the deterministic start pick. Adversarial inputs (NaN, ±Infinity, out-of-range, malformed
 * placements and specs) must return null / NaN, never throw and never produce a value that looks valid.
 */
import { describe, expect, it } from 'vitest';
import {
  CELL_TILES,
  WORLD_MAX_CELLS,
  WORLD_MAX_TILE,
  WORLD_MIN_TILE,
  LIVE_LOT_BUDGET,
  LIVE_LOT_WORST_CASE,
  LIVE_STREET_BUDGET,
  classifyPointerGesture,
  evaluateStartDiversity,
  selectLiveRegions,
  signatureDistance,
  startGeometrySignature,
  type PointerSample,
  type StartGeometry,
  type StartSignaturePart,
  cellIdOfWorldTile,
  hash32,
  isValidPlacement,
  lotFacingToWorld,
  lotTileToWorldTile,
  lotToWorld,
  mix32,
  normalizeSeed,
  pickStart,
  placementWorldRect,
  worldFacingToLot,
  worldTileToLotTile,
  worldToLot,
  type LotPlacement,
  type LotRot,
  type StartGenSpec,
} from '../../../src/shared/world';

const ROTS: LotRot[] = [0, 1, 2, 3];
const place = (rot: LotRot, originX = 40, originZ = 20, width = 30, depth = 30): LotPlacement => ({ regionId: 'wormwood:t', originX, originZ, rot, width, depth });

/** Small deterministic PRNG for property loops (test-local; independent of the code under test). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SPEC: StartGenSpec = {
  genVersion: 1,
  pool: [
    { templateId: 'derelict', weight: 3 },
    { templateId: 'derelict_lean', weight: 1 },
  ],
  slots: ['mildew_n1', 'mildew_n2', 'mildew_n3', 'mildew_n4', 'mildew_s1', 'mildew_s2', 'mildew_s3', 'mildew_s4'],
  variation: { buildableInsetMax: 2, shellVariants: 3, terrainVariants: 4, neighbourPool: ['starter'] },
  constraints: { requiredReachableTags: ['mailbox'], startingFunds: 2500, maxGraveyardWalkTiles: 140, maxAttempts: 8 },
  fallback: { templateId: 'derelict', slotId: 'mildew_n2' },
};

describe('placements', () => {
  it('accepts well-formed placements and reports the world rectangle (spans swap for rot 1/3)', () => {
    expect(placementWorldRect(place(0, 40, 20, 30, 20))).toEqual({ x0: 40, z0: 20, x1: 70, z1: 40 });
    expect(placementWorldRect(place(2, 40, 20, 30, 20))).toEqual({ x0: 40, z0: 20, x1: 70, z1: 40 });
    expect(placementWorldRect(place(1, 40, 20, 30, 20))).toEqual({ x0: 40, z0: 20, x1: 60, z1: 50 });
    expect(placementWorldRect(place(3, 40, 20, 30, 20))).toEqual({ x0: 40, z0: 20, x1: 60, z1: 50 });
    expect(isValidPlacement(place(0, 0, 0, 1, 1))).toBe(true);
    expect(isValidPlacement(place(0, WORLD_MAX_TILE - 30, WORLD_MAX_TILE - 30))).toBe(true);
    expect(isValidPlacement(place(0, WORLD_MIN_TILE, WORLD_MIN_TILE))).toBe(true);
    // Sol's repro on PR #57: north / west of the original layout must be placeable (signed coordinates)
    expect(isValidPlacement(place(0, 40, -10))).toBe(true);
    expect(isValidPlacement(place(0, -10, 30))).toBe(true);
    expect(placementWorldRect(place(1, -40, -35, 30, 20))).toEqual({ x0: -40, z0: -35, x1: -20, z1: -5 });
    // the legacy home placement stays valid under the signed rule
    expect(isValidPlacement(place(0, 70, 0))).toBe(true);
  });

  it('rejects malformed placements', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'lot',
      {},
      { ...place(0), originX: NaN },
      { ...place(0), originZ: Infinity },
      { ...place(0), originX: 1.5 },
      { ...place(0), originX: -1.5 },
      { ...place(0), rot: 4 },
      { ...place(0), rot: -1 },
      { ...place(0), rot: 0.5 },
      { ...place(0), rot: '0' },
      { ...place(0), width: 0 },
      { ...place(0), depth: -30 },
      { ...place(0), width: 257 },
      { ...place(0), width: 30.5 },
      place(0, WORLD_MAX_TILE - 29, 0), // footprint pokes out of the world
      place(1, 0, WORLD_MAX_TILE - 29, 30, 10), // rotated span (width along Z) pokes out
      place(0, WORLD_MIN_TILE - 1, 0), // below the signed minimum
      place(2, 0, WORLD_MIN_TILE - 1),
    ];
    for (const p of bad) {
      expect(isValidPlacement(p as LotPlacement), JSON.stringify(p)).toBe(false);
      expect(placementWorldRect(p as LotPlacement)).toBeNull();
      expect(lotToWorld(p as LotPlacement, 1, 1)).toBeNull();
      expect(worldToLot(p as LotPlacement, 41, 21)).toBeNull();
      expect(lotTileToWorldTile(p as LotPlacement, 1, 1)).toBeNull();
      expect(worldTileToLotTile(p as LotPlacement, 41, 21)).toBeNull();
      expect(lotFacingToWorld(p as LotPlacement, 0)).toBeNaN();
      expect(worldFacingToLot(p as LotPlacement, 0)).toBeNaN();
    }
  });
});

describe('lotToWorld / worldToLot', () => {
  it('maps the lot corners onto the placement rectangle for every rotation', () => {
    for (const rot of ROTS) {
      const p = place(rot, 40, 20, 30, 20);
      const r = placementWorldRect(p)!;
      const corners = [[0, 0], [30, 0], [0, 20], [30, 20]].map(([x, z]) => lotToWorld(p, x, z)!);
      const xs = corners.map((c) => c.x);
      const zs = corners.map((c) => c.z);
      expect(Math.min(...xs)).toBe(r.x0);
      expect(Math.max(...xs)).toBe(r.x1);
      expect(Math.min(...zs)).toBe(r.z0);
      expect(Math.max(...zs)).toBe(r.z1);
    }
  });

  it('turns the lot front (+Z) to the documented world direction', () => {
    const want: Record<LotRot, [number, number]> = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };
    for (const rot of ROTS) {
      const p = place(rot);
      const a = lotToWorld(p, 15, 10)!;
      const b = lotToWorld(p, 15, 11)!;
      expect([b.x - a.x, b.z - a.z]).toEqual(want[rot]);
      // facing 0 (= +Z local) becomes the same world direction: atan2(dx, dz)
      expect(lotFacingToWorld(p, 0)).toBeCloseTo(Math.atan2(want[rot][0], want[rot][1]), 12);
    }
  });

  it('round-trips exactly for integer and half-integer points, and within 1e-9 for arbitrary floats', () => {
    const rnd = lcg(2025);
    for (const rot of ROTS) {
      const p = place(rot, 130, 60, 30, 24);
      for (let i = 0; i < 400; i++) {
        const hx = Math.round(rnd() * 64 - 2) / 2 + 0; // includes points just outside the lot (+0: no -0 inputs)
        const hz = Math.round(rnd() * 52 - 2) / 2 + 0;
        const w = lotToWorld(p, hx, hz)!;
        expect(worldToLot(p, w.x, w.z)).toEqual({ x: hx, z: hz });
        const fx = rnd() * 30;
        const fz = rnd() * 24;
        const wf = lotToWorld(p, fx, fz)!;
        const back = worldToLot(p, wf.x, wf.z)!;
        expect(Math.abs(back.x - fx)).toBeLessThan(1e-9);
        expect(Math.abs(back.z - fz)).toBeLessThan(1e-9);
      }
    }
  });

  it('is deterministic and never yields -0', () => {
    for (const rot of ROTS) {
      const p = place(rot, 0, 0, 30, 30);
      for (const [x, z] of [[0, 0], [30, 30], [30, 0], [0, 30], [-0, -0]]) {
        const a = lotToWorld(p, x, z)!;
        expect(Object.is(a.x, -0) || Object.is(a.z, -0)).toBe(false);
        expect(lotToWorld(p, x, z)).toEqual(a);
        const b = worldToLot(p, a.x, a.z)!;
        expect(Object.is(b.x, -0) || Object.is(b.z, -0)).toBe(false);
      }
    }
  });

  it('returns null for non-finite coordinates', () => {
    const p = place(1);
    for (const [x, z] of [[NaN, 1], [1, NaN], [Infinity, 1], [1, -Infinity]]) {
      expect(lotToWorld(p, x, z)).toBeNull();
      expect(worldToLot(p, x, z)).toBeNull();
    }
    expect(lotToWorld(p, '3' as unknown as number, 1)).toBeNull();
  });
});

describe('tile transforms', () => {
  it('is a bijection between the lot grid and the placement rectangle, for every rotation', () => {
    for (const rot of ROTS) {
      const p = place(rot, 70, 10, 30, 20);
      const r = placementWorldRect(p)!;
      const seen = new Set<string>();
      for (let tz = 0; tz < 20; tz++)
        for (let tx = 0; tx < 30; tx++) {
          const w = lotTileToWorldTile(p, tx, tz)!;
          expect(w.x >= r.x0 && w.x < r.x1 && w.z >= r.z0 && w.z < r.z1).toBe(true);
          seen.add(`${w.x},${w.z}`);
          expect(worldTileToLotTile(p, w.x, w.z)).toEqual({ x: tx, z: tz });
        }
      expect(seen.size).toBe(600);
    }
  });

  it('rejects out-of-range, fractional and non-finite tiles', () => {
    const p = place(2, 40, 40);
    for (const [x, z] of [[-1, 0], [0, -1], [30, 0], [0, 30], [1.5, 2], [NaN, 0], [0, Infinity]]) expect(lotTileToWorldTile(p, x, z)).toBeNull();
    for (const [x, z] of [[39, 45], [70, 45], [45, 39], [45, 70], [45.5, 45], [NaN, 45]]) expect(worldTileToLotTile(p, x, z)).toBeNull();
  });

  it('joins neighbouring lots sidewalk-to-sidewalk and puts the far side of the street 10 tiles across (Mildew Lane layout)', () => {
    // north row (rot 0) slots n1/n2 side by side, street cells z 30..40, south row (rot 2) facing back across it.
    const n1 = place(0, 40, 0);
    const n2 = place(0, 70, 0);
    const s1 = place(2, 40, 40);
    const eastEnd = lotToWorld(n1, 29.5, 28.5)!; // n1's east sidewalk entry
    const westEnd = lotToWorld(n2, 0.5, 28.5)!; // n2's west sidewalk entry
    expect(westEnd.x - eastEnd.x).toBe(1);
    expect(westEnd.z).toBe(eastEnd.z);
    const southWalk = lotToWorld(s1, 15.5, 28.5)!; // s1's sidewalk row, seen from the world
    expect(southWalk.z).toBe(41.5);
    expect(southWalk.z - lotToWorld(n1, 15.5, 28.5)!.z).toBe(13);
    // each lot's street-facing edge (local z = 30) lands on the street band boundary
    expect(lotToWorld(n1, 0, 30)!.z).toBe(30);
    expect(lotToWorld(s1, 0, 30)!.z).toBe(40);
  });
});

describe('facing', () => {
  it('round-trips and stays in (-π, π]', () => {
    const rnd = lcg(7);
    for (const rot of ROTS) {
      const p = place(rot);
      for (let i = 0; i < 200; i++) {
        const f = (rnd() * 2 - 1) * Math.PI;
        const w = lotFacingToWorld(p, f);
        expect(w).toBeGreaterThan(-Math.PI - 1e-12);
        expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
        const back = worldFacingToLot(p, w);
        const d = Math.abs(Math.atan2(Math.sin(back - f), Math.cos(back - f)));
        expect(d).toBeLessThan(1e-9);
      }
      expect(lotFacingToWorld(p, NaN)).toBeNaN();
      expect(worldFacingToLot(p, Infinity)).toBeNaN();
    }
  });
});

describe('cellIdOfWorldTile', () => {
  it('packs signed cells row-major and rejects anything outside the world', () => {
    const H = WORLD_MAX_CELLS / 2;
    const id = (cx: number, cz: number) => (cz + H) * WORLD_MAX_CELLS + (cx + H);
    expect(cellIdOfWorldTile(0, 0)).toBe(id(0, 0));
    expect(cellIdOfWorldTile(CELL_TILES - 1, CELL_TILES - 1)).toBe(id(0, 0));
    expect(cellIdOfWorldTile(CELL_TILES, 0)).toBe(id(1, 0));
    expect(cellIdOfWorldTile(0, CELL_TILES)).toBe(id(0, 1));
    expect(cellIdOfWorldTile(-1, 0)).toBe(id(-1, 0)); // floor, not truncation: tile −1 is in cell −1
    expect(cellIdOfWorldTile(-CELL_TILES, -CELL_TILES)).toBe(id(-1, -1));
    expect(cellIdOfWorldTile(-CELL_TILES - 1, 0)).toBe(id(-2, 0));
    expect(cellIdOfWorldTile(WORLD_MIN_TILE, WORLD_MIN_TILE)).toBe(0);
    expect(cellIdOfWorldTile(WORLD_MAX_TILE - 1, WORLD_MAX_TILE - 1)).toBe(WORLD_MAX_CELLS * WORLD_MAX_CELLS - 1);
    for (const [x, z] of [[WORLD_MIN_TILE - 1, 0], [0, WORLD_MIN_TILE - 1], [WORLD_MAX_TILE, 0], [0, WORLD_MAX_TILE], [1.5, 0], [-0.5, 0], [NaN, 0], [0, Infinity], [0, -Infinity]])
      expect(cellIdOfWorldTile(x, z)).toBeNull();
  });

  it("Sol's repro: tiles north / west of the origin have cell ids, distinct from their neighbours", () => {
    const a = cellIdOfWorldTile(45, -5);
    const b = cellIdOfWorldTile(-5, 35);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(cellIdOfWorldTile(45, 5));
    expect(b).not.toBe(cellIdOfWorldTile(5, 35));
    expect(a).toBe(cellIdOfWorldTile(40, -10)); // same cell (cx 4, cz −1)
    expect(b).toBe(cellIdOfWorldTile(-10, 30)); // same cell (cx −1, cz 3)
    // every cell id in a 6 × 6 block straddling the origin is unique
    const seen = new Set<number>();
    for (let cz = -3; cz < 3; cz++) for (let cx = -3; cx < 3; cx++) seen.add(cellIdOfWorldTile(cx * CELL_TILES, cz * CELL_TILES)!);
    expect(seen.size).toBe(36);
  });

  it('a standard 30 × 30 lot on a cell-aligned origin covers exactly 3 × 3 cells', () => {
    const p = place(0, 40, 0);
    const cells = new Set<number>();
    for (let tz = 0; tz < 30; tz++) for (let tx = 0; tx < 30; tx++) {
      const w = lotTileToWorldTile(p, tx, tz)!;
      cells.add(cellIdOfWorldTile(w.x, w.z)!);
    }
    expect(cells.size).toBe(9);
  });
});

describe('seed + hash', () => {
  it('normalizeSeed: uint32 for every finite number, null otherwise', () => {
    expect(normalizeSeed(42)).toBe(42);
    expect(normalizeSeed(1.9)).toBe(1);
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(2 ** 32)).toBe(0);
    expect(normalizeSeed(2 ** 32 + 5)).toBe(5);
    expect(normalizeSeed(-0)).toBe(0);
    expect(normalizeSeed(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER >>> 0);
    expect(normalizeSeed(1e300)).toBe(1e300 >>> 0);
    for (const s of [NaN, Infinity, -Infinity, '42' as unknown as number, null as unknown as number]) expect(normalizeSeed(s)).toBeNull();
  });

  it('mix32 / hash32 are frozen (saved worlds depend on these exact values)', () => {
    expect([0, 1, 42, 0xffffffff].map(mix32)).toEqual([2462723854, 2527132011, 939911724, 920564995]);
    expect(hash32(1, 2, 3)).toBe(1490637961);
    expect(hash32(3, 2, 1)).toBe(3364452482);
    for (let i = 0; i < 100; i++) {
      const h = mix32(i * 7919);
      expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    }
  });
});

describe('pickStart', () => {
  it('is pinned for a reference seed (golden)', () => {
    expect(pickStart(42, SPEC)).toEqual({ genVersion: 1, templateId: 'derelict', slotId: 'mildew_s2', variantSeed: 593518040, neighbourSeed: 1864182063, attempt: 0 });
    expect(pickStart(7, SPEC, 1)).toEqual({ genVersion: 1, templateId: 'derelict', slotId: 'mildew_s1', variantSeed: 874080888, neighbourSeed: 2047027183, attempt: 1 });
  });

  it('is deterministic: same seed + spec + attempt → identical pick; seeds that normalise equal pick equal', () => {
    for (let s = 0; s < 500; s++) expect(pickStart(s * 104729, SPEC)).toEqual(pickStart(s * 104729, structuredClone(SPEC)));
    expect(pickStart(1.7, SPEC)).toEqual(pickStart(1, SPEC));
    expect(pickStart(-1, SPEC)).toEqual(pickStart(0xffffffff, SPEC));
    expect(pickStart(2 ** 32 + 9, SPEC)).toEqual(pickStart(9, SPEC));
  });

  it('50 seeded starts: every one is a valid pick, and the set is varied (different slots, templates, variants)', () => {
    const picks = Array.from({ length: 50 }, (_, i) => pickStart(1000 + i, SPEC)!);
    for (const p of picks) {
      expect(SPEC.slots).toContain(p.slotId);
      expect(SPEC.pool.map((o) => o.templateId)).toContain(p.templateId);
      expect(Number.isInteger(p.variantSeed) && p.variantSeed >= 0 && p.variantSeed <= 0xffffffff).toBe(true);
    }
    expect(new Set(picks.map((p) => p.slotId)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(picks.map((p) => p.templateId)).size).toBe(2);
    expect(new Set(picks.map((p) => p.variantSeed)).size).toBe(50);
  });

  it('weights are honoured (3:1 → ~75 %) and every slot is reachable', () => {
    let derelict = 0;
    const slots = new Set<string>();
    for (let s = 0; s < 4000; s++) {
      const p = pickStart(s, SPEC)!;
      if (p.templateId === 'derelict') derelict++;
      slots.add(p.slotId);
    }
    expect(derelict / 4000).toBeGreaterThan(0.71);
    expect(derelict / 4000).toBeLessThan(0.79);
    expect(slots.size).toBe(SPEC.slots.length);
  });

  it('a retry (attempt + 1) and a new generator version give different draws', () => {
    const a0 = pickStart(99, SPEC)!;
    const a1 = pickStart(99, SPEC, 1)!;
    expect(a1.attempt).toBe(1);
    expect(a1.variantSeed).not.toBe(a0.variantSeed);
    const v2 = pickStart(99, { ...SPEC, genVersion: 2 })!;
    expect(v2.genVersion).toBe(2);
    expect(v2.variantSeed).not.toBe(a0.variantSeed);
  });

  it('rejects bad seeds, attempts and specs; ignores unusable pool entries; never mutates the spec', () => {
    for (const s of [NaN, Infinity, -Infinity]) expect(pickStart(s, SPEC)).toBeNull();
    for (const a of [-1, 1.5, NaN, Infinity]) expect(pickStart(1, SPEC, a)).toBeNull();
    expect(pickStart(1, null)).toBeNull();
    expect(pickStart(1, undefined)).toBeNull();
    expect(pickStart(1, { ...SPEC, genVersion: 0 })).toBeNull();
    expect(pickStart(1, { ...SPEC, genVersion: 1.5 })).toBeNull();
    expect(pickStart(1, { ...SPEC, pool: [] })).toBeNull();
    expect(pickStart(1, { ...SPEC, slots: [] })).toBeNull();
    expect(pickStart(1, { ...SPEC, slots: ['', 3 as unknown as string] })).toBeNull();
    expect(pickStart(1, { ...SPEC, pool: [{ templateId: 'x', weight: 0 }, { templateId: 'y', weight: NaN }, { templateId: '', weight: 5 }, { templateId: 'z', weight: 1001 }] })).toBeNull();
    const onlyGood = { ...SPEC, pool: [{ templateId: 'bad', weight: -3 }, { templateId: 'good', weight: 2 }, null as never, { templateId: 'frac', weight: 0.5 }] };
    for (let s = 0; s < 50; s++) expect(pickStart(s, onlyGood)!.templateId).toBe('good');
    const frozen = structuredClone(SPEC);
    pickStart(5, SPEC, 3);
    expect(SPEC).toEqual(frozen);
  });
});

describe('signed coordinates (review fix, Sol)', () => {
  it('round-trips points and tiles for negative and mixed-sign origins, every rotation', () => {
    const rnd = lcg(99);
    const origins: [number, number][] = [[-40, -35], [-10, 30], [40, -10], [WORLD_MIN_TILE, WORLD_MIN_TILE], [-1, 0], [0, -1]];
    for (const [ox, oz] of origins)
      for (const rot of ROTS) {
        const p = place(rot, ox, oz, 30, 20);
        expect(isValidPlacement(p)).toBe(true);
        const r = placementWorldRect(p)!;
        for (let i = 0; i < 100; i++) {
          const hx = Math.round(rnd() * 60) / 2 + 0;
          const hz = Math.round(rnd() * 40) / 2 + 0;
          const w = lotToWorld(p, hx, hz)!;
          expect(worldToLot(p, w.x, w.z)).toEqual({ x: hx, z: hz });
        }
        const seen = new Set<string>();
        for (let tz = 0; tz < 20; tz++)
          for (let tx = 0; tx < 30; tx++) {
            const w = lotTileToWorldTile(p, tx, tz)!;
            expect(w.x >= r.x0 && w.x < r.x1 && w.z >= r.z0 && w.z < r.z1).toBe(true);
            expect(worldTileToLotTile(p, w.x, w.z)).toEqual({ x: tx, z: tz });
            expect(cellIdOfWorldTile(w.x, w.z)).not.toBeNull();
            seen.add(`${w.x},${w.z}`);
          }
        expect(seen.size).toBe(600);
      }
  });

  it('a lot north of Mildew Lane (z < 0) meets the north row back-to-back with no gap or overlap', () => {
    const north = place(2, 40, -30); // faces −Z, its street lies further north
    const n1 = place(0, 40, 0);
    expect(placementWorldRect(north)).toEqual({ x0: 40, z0: -30, x1: 70, z1: 0 });
    expect(worldTileToLotTile(north, 45, -1)).not.toBeNull();
    expect(worldTileToLotTile(n1, 45, -1)).toBeNull();
    expect(worldTileToLotTile(n1, 45, 0)).not.toBeNull();
    expect(worldTileToLotTile(north, 45, 0)).toBeNull();
  });
});

describe('selectLiveRegions (household split rule, review fix)', () => {
  const lotsAround = (n: number) => Array.from({ length: n }, (_, i) => ({ regionId: `wormwood:c${String(i).padStart(2, '0')}`, kind: 'lot' as const, distance: i }));
  const streets = (n: number) => Array.from({ length: n }, (_, i) => ({ regionId: `street:mildew:${i}`, kind: 'street' as const, distance: i }));

  it('household together: ≤ LIVE_LOT_BUDGET lots, nearest first, ≤ LIVE_STREET_BUDGET streets', () => {
    const r = selectLiveRegions({ homeRegionId: 'wormwood:mildew_n2', memberRegions: [{ regionId: 'wormwood:mildew_n2', kind: 'lot' }], candidates: [...lotsAround(12), ...streets(12)] })!;
    expect(r.lotCount).toBe(LIVE_LOT_BUDGET);
    expect(r.live).toContain('wormwood:c00');
    expect(r.live).toContain('wormwood:c04');
    expect(r.live).not.toContain('wormwood:c05');
    expect(r.live.filter((id) => id.startsWith('street:')).length).toBe(LIVE_STREET_BUDGET);
    expect(r.live).toEqual([...r.live].sort());
  });

  it('worst case: 8 members in 8 different lots → all 8 + home live (9 lots), no surroundings, nobody frozen', () => {
    const members = Array.from({ length: 8 }, (_, i) => ({ regionId: `wormwood:m${i}`, kind: 'lot' as const }));
    const r = selectLiveRegions({ homeRegionId: 'wormwood:home', memberRegions: members, candidates: lotsAround(20) })!;
    expect(r.lotCount).toBe(LIVE_LOT_WORST_CASE);
    expect(LIVE_LOT_WORST_CASE).toBe(9);
    for (const m of members) expect(r.live).toContain(m.regionId);
    expect(r.live).toContain('wormwood:home');
    expect(r.live.some((id) => id.startsWith('wormwood:c'))).toBe(false);
    expect(r.required).toHaveLength(9);
  });

  it('a partial split shrinks the surroundings, never the member regions', () => {
    const members = [{ regionId: 'graveyard:old_graveyard', kind: 'lot' as const }, { regionId: 'wormwood:mildew_s3', kind: 'lot' as const }, { regionId: 'street:mildew:5', kind: 'street' as const }];
    const r = selectLiveRegions({ homeRegionId: 'wormwood:mildew_n2', memberRegions: members, candidates: [...lotsAround(10), ...streets(10)] })!;
    expect(r.required).toEqual(['graveyard:old_graveyard', 'wormwood:mildew_n2', 'wormwood:mildew_s3']);
    expect(r.lotCount).toBe(LIVE_LOT_BUDGET);
    expect(r.live).toContain('street:mildew:5');
  });

  it('more than 8 member entries are capped at the household size; property: lotCount ≤ 9 for any input', () => {
    const rnd = lcg(5);
    for (let k = 0; k < 300; k++) {
      const members = Array.from({ length: Math.floor(rnd() * 12) }, () => ({ regionId: `wormwood:m${Math.floor(rnd() * 20)}`, kind: (rnd() < 0.8 ? 'lot' : 'street') as 'lot' | 'street' }));
      const cands = Array.from({ length: Math.floor(rnd() * 30) }, () => ({ regionId: `wormwood:m${Math.floor(rnd() * 30)}`, kind: (rnd() < 0.5 ? 'lot' : 'street') as 'lot' | 'street', distance: rnd() * 60 }));
      const r = selectLiveRegions({ homeRegionId: 'wormwood:home', memberRegions: members, candidates: cands })!;
      expect(r.lotCount).toBeLessThanOrEqual(LIVE_LOT_WORST_CASE);
      for (const m of members.slice(0, 8)) expect(r.live).toContain(m.regionId);
      expect(selectLiveRegions({ homeRegionId: 'wormwood:home', memberRegions: members, candidates: [...cands].reverse() })).toEqual(r);
    }
  });

  it('ignores garbage: unfinished regions, NaN / negative distances, empty ids; null input → null', () => {
    const r = selectLiveRegions({
      homeRegionId: 'h',
      memberRegions: [null as never, { regionId: '', kind: 'lot' }],
      candidates: [{ regionId: 'u', kind: 'unfinished', distance: 1 }, { regionId: 'a', kind: 'lot', distance: NaN }, { regionId: 'b', kind: 'lot', distance: -1 }, { regionId: 'c', kind: 'lot', distance: 3 }],
    })!;
    expect(r.live).toEqual(['c', 'h']);
    expect(selectLiveRegions(null)).toBeNull();
    expect(selectLiveRegions({ homeRegionId: '', memberRegions: [], candidates: [] })).toBeNull();
  });
});

describe('classifyPointerGesture (S11: no accidental walk)', () => {
  const seq = (pts: [number, number, number, PointerSample['type'], number?][]): PointerSample[] => pts.map(([t, x, y, type, id]) => ({ id: id ?? 1, t, x, y, type }));

  it('a short still press is the only gesture classified as tap', () => {
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down'], [120, 103, 101, 'up']]))).toBe('tap');
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down'], [60, 104, 104, 'move'], [200, 106, 105, 'up']]))).toBe('tap');
  });

  it('pan, pinch, long press, cancel and post-pinch lifts never become taps', () => {
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down'], [50, 130, 100, 'move'], [90, 131, 100, 'up']]))).toBe('pan');
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down', 1], [10, 200, 200, 'down', 2], [80, 101, 100, 'up', 1], [90, 200, 200, 'up', 2]]))).toBe('pinch');
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down'], [600, 100, 100, 'up']]))).toBe('longPress');
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down'], [420, 100, 100, 'up']]))).toBe('none'); // too slow for a tap, too short for long press
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down'], [50, 100, 100, 'cancel']]))).toBe('none');
    expect(classifyPointerGesture(seq([[1000, 100, 100, 'down'], [1080, 100, 100, 'up']]), 900)).toBe('none'); // finger lifting after a pinch
    expect(classifyPointerGesture(seq([[1000, 100, 100, 'down'], [1080, 100, 100, 'up']]), 600)).toBe('tap');
  });

  it('garbage input is never a tap', () => {
    expect(classifyPointerGesture(null)).toBe('none');
    expect(classifyPointerGesture([])).toBe('none');
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down']]))).toBe('none');
    expect(classifyPointerGesture(seq([[0, NaN, 100, 'down'], [50, 100, 100, 'up']]))).toBe('none');
    expect(classifyPointerGesture(seq([[50, 100, 100, 'down'], [10, 100, 100, 'up']]))).toBe('none'); // time goes backwards
    expect(classifyPointerGesture(seq([[0, 100, 100, 'move'], [50, 100, 100, 'up']]))).toBe('none');
    expect(classifyPointerGesture(seq([[0, 100, 100, 'down'], [20, 100, 100, 'down'], [50, 100, 100, 'up']]))).toBe('none');
  });
});

describe('start diversity signature (AC-6 gate, review fix)', () => {
  const geom = (over: Partial<StartGeometry> = {}): StartGeometry => ({
    slotId: 'mildew_n2',
    rot: 0,
    buildable: { x0: 1, z0: 1, x1: 29, z1: 27 },
    shellEdges: ['h:11:13', 'h:12:13', 'v:11:13', 'v:19:13', 'h:11:19'],
    openings: ['door_splintered@h:13:19', 'window_grimy@v:11:16'],
    terrain: Array.from({ length: 900 }, (_, i) => (i % 97 === 0 ? 'dirt' : null)),
    neighbours: ['mildew_n1=starter', 'mildew_n3=wormwood_bungalow~m', 'mildew_s1=empty'],
    fallback: false,
    ...over,
  });

  it('is computed from geometry, stable under edge/opening order and save/reload (JSON round trip)', () => {
    const a = startGeometrySignature(geom())!;
    const b = startGeometrySignature(geom({ shellEdges: [...geom().shellEdges].reverse(), openings: [...geom().openings].reverse() }))!;
    expect(b.key).toBe(a.key);
    expect(startGeometrySignature(JSON.parse(JSON.stringify(geom())))!.key).toBe(a.key);
    expect(startGeometrySignature(geom())).toEqual(a); // same seed → same layout → identical signature
  });

  it('every part reacts to its own geometry and the distance counts differing parts', () => {
    const a = startGeometrySignature(geom())!;
    const t = [...geom().terrain];
    t[5] = 'mud';
    const variants: [Partial<StartGeometry>, StartSignaturePart][] = [
      [{ slotId: 'mildew_s3' }, 'slot'],
      [{ rot: 2 }, 'rot'],
      [{ buildable: { x0: 2, z0: 1, x1: 29, z1: 27 } }, 'footprint'],
      [{ shellEdges: ['h:11:13', 'h:12:13', 'v:11:13', 'v:19:13', 'h:12:19'] }, 'shell'],
      [{ openings: ['door_splintered@h:14:19', 'window_grimy@v:11:16'] }, 'shell'],
      [{ terrain: t }, 'terrain'],
      [{ neighbours: ['mildew_n1=starter', 'mildew_n3=wormwood_bungalow', 'mildew_s1=empty'] }, 'neighbours'],
    ];
    for (const [over, part] of variants) {
      const b = startGeometrySignature(geom(over))!;
      expect(b.parts[part], part).not.toBe(a.parts[part]);
      expect(signatureDistance(a, b), part).toBe(1);
    }
    expect(signatureDistance(a, startGeometrySignature(geom({ slotId: 'mildew_s3', rot: 2, neighbours: [] }))!)).toBe(3);
  });

  it('rejects malformed geometry', () => {
    const bad: unknown[] = [null, {}, geom({ slotId: '' }), geom({ rot: 4 as never }), geom({ buildable: { x0: 5, z0: 1, x1: 5, z1: 27 } }), geom({ buildable: { x0: NaN, z0: 1, x1: 29, z1: 27 } }), geom({ shellEdges: [1 as never] }), geom({ terrain: [3 as never] }), geom({ neighbours: 'x' as never })];
    for (const g of bad) expect(startGeometrySignature(g as StartGeometry)).toBeNull();
  });

  it('the gate: 50 varied starts pass; all-fallback, too many fallbacks, duplicates or near-twins fail; counts are reported', () => {
    const varied = Array.from({ length: 50 }, (_, i) =>
      startGeometrySignature(geom({ slotId: `mildew_n${(i % 4) + 1}`, buildable: { x0: 1 + (i % 3), z0: 1, x1: 29 - (Math.floor(i / 3) % 3), z1: 27 }, shellEdges: [`h:${10 + (i % 7)}:${12 + (i % 4)}`, `v:${i}:13`], neighbours: [`n=${i}`] })),
    );
    const ok = evaluateStartDiversity(varied);
    expect(ok).toEqual({ seeds: 50, distinct: 50, fallbacks: 0, minPairwiseDistance: 2, pass: true });

    const canonical = startGeometrySignature(geom({ fallback: true }))!;
    const allFallback = evaluateStartDiversity(Array.from({ length: 50 }, () => canonical));
    expect(allFallback).toMatchObject({ distinct: 1, fallbacks: 50, pass: false }); // reachability alone can no longer pass AC-6

    const threeFallbacks = evaluateStartDiversity([...varied.slice(0, 47), canonical, canonical, canonical]);
    expect(threeFallbacks).toMatchObject({ fallbacks: 3, pass: false });
    const twoFallbacks = evaluateStartDiversity([...varied.slice(0, 48), canonical, startGeometrySignature(geom({ fallback: true, slotId: 'mildew_s1' }))]);
    expect(twoFallbacks).toMatchObject({ fallbacks: 2, distinct: 50, pass: true });

    const dupes = evaluateStartDiversity([...varied.slice(0, 47), varied[0], varied[1], varied[2]]);
    expect(dupes).toMatchObject({ distinct: 47, pass: false });

    const twin = startGeometrySignature(geom({ ...JSON.parse(JSON.stringify(geom({ slotId: 'mildew_n1', buildable: { x0: 1, z0: 1, x1: 29, z1: 27 }, shellEdges: ['h:10:12', 'v:0:13'], neighbours: ['n=0'] }))), slotId: 'mildew_s4' }))!;
    const nearTwins = evaluateStartDiversity([...varied.slice(0, 49), twin]);
    expect(nearTwins.minPairwiseDistance).toBe(1);
    expect(nearTwins.pass).toBe(false);

    expect(evaluateStartDiversity([...varied.slice(0, 49), null]).pass).toBe(false);
    expect(evaluateStartDiversity(varied.slice(0, 49)).pass).toBe(false); // fewer than 50 seeds
    expect(evaluateStartDiversity(null as never).pass).toBe(false);
  });
});
