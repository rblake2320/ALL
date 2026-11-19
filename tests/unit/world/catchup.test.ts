/**
 * AC-5 — closed-form catch-up (W-025 S4, docs/DESIGN_WORLD_LEVELS.md §1.8, src/sim/engine/catchUp.ts):
 *  - pure property test, 200 random intervals per region kind (residential lot, community lot, street, path):
 *    catchUp(a→now) twice = once; catchUp(a→b) + (b→c) = catchUp(a→c), byte for byte; 0 elapsed changes nothing;
 *    1 tick and 1 year work; NaN / negative / fractional / before-the-watermark `now` and damaged watermarks are
 *    refused with no change;
 *  - the rules do what they say (fridge leftovers and meals spoil, surfaces under dirty items get grimy, street litter
 *    despawns, garden stages, absent residents' needs drift), and mirror the live constants;
 *  - on the REAL engine: a 30-game-day absence of a furnished neighbour lot (freeze → 30 days → thaw) gives exactly the
 *    closed form, equals 30 daily catch-ups, and thawing again at the same tick is a no-op; a zero-elapsed freeze →
 *    thaw gives the objects back byte for byte.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectState } from '../../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import type { RegionKind, RegionRecord, RegionSnapshot } from '../../../src/shared/world';
import { sortedJson } from '../../../src/shared/worldBudget';
import * as CU from '../../../src/sim/engine/catchUp';
import { LEFTOVER_SPOIL_MIN, MEAL_OUT_SPOIL_MIN } from '../../../src/sim/systems/home/food/leftovers';
import { SURFACE_DIRT_PER_ITEM_HOUR } from '../../../src/sim/systems/home/upkeep/mess';
import { freezeRegion, thawRegion, streamNotes } from '../../../src/sim/engine/streaming';
import { isRegionActive, withRegion } from '../../../src/sim/engine/regions';
import { N3 } from './s3Harness';
import { streamWorld } from './s4Harness';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function obj(id: string, defId: string, placement: ObjectState['placement'], data: ObjectState['data'] = {}, dirt = 0): ObjectState {
  return { id, defId, regionId: 'r', placement, value: 0, purchasedTick: 0, tint: null, condition: { broken: false, dirt, burning: false, burnMinutes: 0 }, data, reservedBy: {}, inUseBy: [], rev: 0 };
}

/** A random snapshot exercising every rule (fridges, meals on surfaces and on the floor, dishes, garden, residents). */
function randomRecord(r: () => number, from: number): RegionRecord {
  const objects: Record<string, ObjectState> = {};
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const t = `t${i}`;
    objects[t] = obj(t, 'table_wake', { kind: 'floor', x: i, z: 2, rot: 0 }, {}, Math.round(r() * 1000) / 1000);
    const items = Math.floor(r() * 3);
    for (let k = 0; k < items; k++) {
      const id = `m${i}_${k}`;
      const meal = r() < 0.6;
      objects[id] = obj(id, meal ? 'item_meal' : 'item_dish', { kind: 'loose', x: i + 0.5, z: 2.5, y: 0.8, parentId: t, surfaceIndex: 0, facing: 0 }, meal ? { ageMin: Math.round(r() * 2000 * 7) / 7, spoiled: r() < 0.1 } : r() < 0.5 ? { ageMin: r() * 3000 } : {});
    }
  }
  objects.floorMeal = obj('floorMeal', 'item_pizza', { kind: 'loose', x: 3, z: 3, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { ageMin: r() * 3000 });
  const left = Array.from({ length: Math.floor(r() * 4) }, () => ({ s: 1 + Math.floor(r() * 4), q: 1 + Math.floor(r() * 6), r: 'brainLoaf', a: Math.round(r() * 4000 * 100) / 100 }));
  objects.fridge = obj('fridge', r() < 0.5 ? 'fridge_humming' : 'fridge_cryo', { kind: 'floor', x: 9, z: 9, rot: 0 }, { leftovers: JSON.stringify(left) });
  objects.plant = obj('plant', 'plot_budget', { kind: 'floor', x: 5, z: 5, rot: 0 }, { growStartTick: Math.floor(r() * from), growTicksPerStage: 1 + Math.floor(r() * 3000), growMaxStage: 4 });
  const residents: Record<string, Record<string, number>> = {};
  for (let i = 0; i < 3; i++) residents[`a${i}`] = { hunger: r() * 100, energy: r() * 100, social: r() * 100, fun: r() * 100, hygiene: r() * 100, preservation: r() * 100 };
  const snapshot: RegionSnapshot = { savedTick: from, lot: { width: 30, depth: 30 }, objects, data: { residents, genHash: 1 } };
  return { id: 'r', snapshot, caughtUpTick: from, firstActiveTick: 0 };
}

const env = (kind: RegionKind) => ({ kind, seed: 1234, spoilMult: (d: string) => (d === 'fridge_cryo' ? 0.5 : 1) });
const KINDS: { name: string; kind: RegionKind }[] = [
  { name: 'residential lot', kind: 'lot' },
  { name: 'community lot', kind: 'lot' },
  { name: 'street', kind: 'street' },
  { name: 'path', kind: 'path' },
];
const YEAR = 365 * TICKS_PER_DAY;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const bytes = (v: unknown) => sortedJson(v);

describe('AC-5 catch-up: pure properties (200 random intervals per region kind)', () => {
  for (const [ki, k] of KINDS.entries()) {
    it(`${k.name}: idempotent, split-invariant, 0 elapsed is a no-op`, () => {
      const r = rng(1000 + ki);
      for (let i = 0; i < 200; i++) {
        const a = Math.floor(r() * 50 * TICKS_PER_DAY);
        // spans: 0, 1 tick, minutes, days, a year (and a year + a bit)
        const pick = () => [0, 1, 7, TICKS_PER_HOUR - 1, TICKS_PER_HOUR, 3 * TICKS_PER_DAY, YEAR, YEAR + 13][Math.floor(r() * 8)] + (r() < 0.5 ? Math.floor(r() * 5 * TICKS_PER_DAY) : 0);
        const b = a + pick();
        const c = b + pick();
        const base = randomRecord(r, a);
        // twice = once
        const once = clone(base);
        expect(CU.catchUpRecord(once, c, env(k.kind))).toBe(true);
        const twice = clone(once);
        expect(CU.catchUpRecord(twice, c, env(k.kind))).toBe(true);
        expect(bytes(twice)).toBe(bytes(once));
        // split = direct
        const split = clone(base);
        expect(CU.catchUpRecord(split, b, env(k.kind))).toBe(true);
        expect(CU.catchUpRecord(split, c, env(k.kind))).toBe(true);
        expect({ i, a, b, c, rec: bytes(split) }).toEqual({ i, a, b, c, rec: bytes(once) });
        // three-way split too
        const m = a + Math.floor((c - a) / 3);
        const three = clone(base);
        for (const t of [m, b > m ? b : m, c]) expect(CU.catchUpRecord(three, t, env(k.kind))).toBe(true);
        expect(bytes(three)).toBe(bytes(once));
        // 0 elapsed: byte for byte unchanged (no quantisation either)
        const zero = clone(base);
        expect(CU.catchUpRecord(zero, a, env(k.kind))).toBe(true);
        expect(bytes(zero)).toBe(bytes(base));
        expect(once.caughtUpTick).toBe(c);
      }
    });
  }

  it('refuses NaN / negative / fractional / earlier `now` and damaged watermarks, changing nothing', () => {
    const base = randomRecord(rng(5), 1000);
    for (const now of [NaN, -1, -Infinity, Infinity, 999, 1000.5, Number.MAX_SAFE_INTEGER + 2, '2000' as unknown as number, null as unknown as number]) {
      const rec = clone(base);
      expect(CU.catchUpRecord(rec, now, env('lot'))).toBe(false);
      expect(bytes(rec)).toBe(bytes(base));
    }
    for (const w of [NaN, -5, 3.5, null, undefined, '7']) {
      const rec: Omit<RegionRecord, 'caughtUpTick'> & { caughtUpTick: unknown } = clone(base);
      rec.caughtUpTick = w;
      const before = bytes(rec);
      expect(CU.catchUpRecord(rec as RegionRecord, 5000, env('lot'))).toBe(false);
      expect(bytes(rec)).toBe(before);
    }
    expect(CU.catchUpRecord(null as unknown as RegionRecord, 5, env('lot'))).toBe(false);
    // a record without a snapshot only moves its watermark
    const bare: RegionRecord = { id: 'x', snapshot: null, caughtUpTick: 10, firstActiveTick: null };
    expect(CU.catchUpRecord(bare, 20, env('lot'))).toBe(true);
    expect(bare).toEqual({ id: 'x', snapshot: null, caughtUpTick: 20, firstActiveTick: null });
  });

  it('the rules: spoilage, grime, despawn, garden, residents; constants mirror the live systems', () => {
    expect(CU.LEFTOVER_SPOIL_MIN).toBe(LEFTOVER_SPOIL_MIN);
    expect(CU.MEAL_OUT_SPOIL_MIN).toBe(MEAL_OUT_SPOIL_MIN);
    expect(CU.SURFACE_DIRT_PER_ITEM_HOUR).toBe(SURFACE_DIRT_PER_ITEM_HOUR);
    expect(Math.abs(CU.SURFACE_DIRT_Q - SURFACE_DIRT_PER_ITEM_HOUR)).toBeLessThan(CU.CATCH_UP_QUANT);
    const objects: Record<string, ObjectState> = {
      t: obj('t', 'table_wake', { kind: 'floor', x: 1, z: 1, rot: 0 }),
      d: obj('d', 'item_dish', { kind: 'loose', x: 1.5, z: 1.5, y: 0.8, parentId: 't', surfaceIndex: 0, facing: 0 }),
      m: obj('m', 'item_meal', { kind: 'loose', x: 5, z: 5, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { ageMin: 0 }),
      f: obj('f', 'fridge_cryo', { kind: 'floor', x: 9, z: 9, rot: 0 }, { leftovers: JSON.stringify([{ s: 2, q: 3, r: 'brainLoaf', a: 0 }]) }),
      g: obj('g', 'plot_budget', { kind: 'floor', x: 3, z: 3, rot: 0 }, { growStartTick: 0, growTicksPerStage: TICKS_PER_DAY, growMaxStage: 3 }),
    };
    const rec: RegionRecord = { id: 'r', snapshot: { savedTick: 0, lot: {}, objects, data: { residents: { a1: { hunger: 10, fun: 90, preservation: 40 } } } }, caughtUpTick: 0, firstActiveTick: 0 };
    expect(CU.catchUpRecord(rec, 2 * TICKS_PER_DAY, env('lot'))).toBe(true);
    const o = rec.snapshot!.objects as Record<string, ObjectState>;
    expect(o.m.data).toEqual({ ageMin: 2880, spoiled: true });
    expect(o.t.condition.dirt).toBe(1); // 48 h × ~0.05 under a dish, capped at 1
    expect(JSON.parse(o.f.data.leftovers as string)[0].a).toBe(1440); // cryo fridge: half speed
    expect(o.f.data.spoiledServings).toBe(0);
    expect(o.g.data.growStage).toBe(2);
    // 48 hour boundaries × 2 points toward 60 (capped there); preservation is not a resident-drift need
    expect(rec.snapshot!.data.residents).toEqual({ a1: { hunger: 60, fun: 60, preservation: 40 } });
    // on a street the same dish (aged) and the meal on the floor despawn after 48 h
    const st: RegionRecord = clone({ ...rec, snapshot: { savedTick: 0, lot: {}, objects: clone(objects), data: {} }, caughtUpTick: 0 });
    expect(CU.catchUpRecord(st, 2 * TICKS_PER_DAY, env('street'))).toBe(true);
    expect(Object.keys(st.snapshot!.objects as object).sort()).toEqual(['f', 'g', 't']);
  });
});

describe('catch-up on the real engine (freeze → absence → thaw)', () => {
  function furnished() {
    const { sim, eng } = streamWorld({ seed: 11 });
    sim.step(); // tick 0 evaluation: n3 (the furnished stand-in) comes live
    expect(isRegionActive(eng, N3)).toBe(true);
    const mine = Object.values(sim.state.objects).filter((o) => o.regionId === N3);
    const fridge = mine.find((o) => o.defId === 'fridge_humming')!;
    const table = mine.find((o) => o.defId === 'table_wake')!;
    expect(fridge && table).toBeTruthy();
    withRegion(eng, N3, () => {
      fridge.data.leftovers = JSON.stringify([{ s: 3, q: 4, r: 'brainLoaf', a: 100 }]);
      sim.state.objects.o_meal = { ...table, id: 'o_meal', defId: 'item_meal', placement: { kind: 'loose', x: 16.5, z: 16.5, y: 0.8, parentId: table.id, surfaceIndex: 0, facing: 0 }, data: { ageMin: 30 }, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, reservedBy: {}, inUseBy: [] };
    });
    return { sim, eng, fridge: fridge.id, table: table.id };
  }

  it('a 30-game-day absence: exactly the closed form, equal to 30 daily catch-ups, re-thaw is a no-op', () => {
    const { sim, eng, fridge, table } = furnished();
    const t0 = sim.state.tick;
    expect(freezeRegion(eng, N3)).toBe(true);
    const rec = sim.state.town!.regions[N3];
    expect(rec.snapshot!.savedTick).toBe(t0);
    expect(rec.caughtUpTick).toBe(t0);
    expect(Object.values(sim.state.objects).some((o) => o.regionId === N3)).toBe(false);
    // the reference: the same snapshot caught up in 30 daily steps through the pure function
    const daily = clone(rec);
    const e = { kind: 'lot' as const, seed: 0, spoilMult: () => 1 };
    for (let d = 1; d <= 30; d++) expect(CU.catchUpRecord(daily, t0 + d * TICKS_PER_DAY, e)).toBe(true);
    // 30 game days pass (the clock is moved for the test: stepping a month of an empty street is not the point)
    sim.state.tick = t0 + 30 * TICKS_PER_DAY;
    expect(thawRegion(eng, N3)).toBe(true);
    expect(rec.caughtUpTick).toBe(t0 + 30 * TICKS_PER_DAY);
    const live = sim.state.objects;
    expect(JSON.parse(live[fridge].data.leftovers as string)[0].a).toBe(100 + 30 * 24 * 60);
    expect(live[fridge].data.spoiledServings).toBe(3);
    expect(live.o_meal.data.spoiled).toBe(true);
    expect(live[table].condition.dirt).toBe(1);
    for (const id of Object.keys(daily.snapshot!.objects as object)) expect(sortedJson(live[id])).toBe(sortedJson((daily.snapshot!.objects as Record<string, ObjectState>)[id]));
    // thawing again (already active) is refused; catching the record up again at the same tick changes nothing
    const again = sortedJson(rec);
    expect(thawRegion(eng, N3)).toBe(false);
    expect(CU.catchUpRecord(rec, sim.state.tick, e)).toBe(true);
    expect(sortedJson(rec)).toBe(again);
    expect(streamNotes(eng)).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });

  it('zero elapsed: freeze and thaw on the same tick gives every object back byte for byte', () => {
    const { sim, eng } = furnished();
    const before = Object.values(sim.state.objects).filter((o) => o.regionId === N3).sort((a, b) => (a.id < b.id ? -1 : 1));
    const snap = sortedJson(before);
    expect(freezeRegion(eng, N3)).toBe(true);
    expect(thawRegion(eng, N3)).toBe(true);
    const after = Object.values(sim.state.objects).filter((o) => o.regionId === N3).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(sortedJson(after)).toBe(snap);
    expect(sim.state.town!.regions[N3].snapshot!.objects).toEqual({});
  });
});
