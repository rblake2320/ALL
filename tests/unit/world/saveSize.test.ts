/**
 * AC-12 size harness (W-025 S2; docs/DESIGN_WORLD_LEVELS.md §1.11): the world with Wormwood + the Old Graveyard fully
 * visited and FURNISHED stays ≤ 2 MB of canonical JSON, every region snapshot within its hard limit, and the 4 MB hard
 * cap is enforced deterministically (`capWorldSize`).
 *
 * The furnished snapshots are REAL lots: each is a shipped template on the real engine, then filled by the real
 * BuildService with every buyable floor object until no more fit (a far denser lot than any player builds). The
 * community lots (park, graveyard) have no template before S6 / S14, so the stand-in is the furnished starter lot,
 * held to the stricter community limit. The home is a world played for 2 game days by the AC-1 script.
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation, loadContent } from '../../../src/sim/index';
import type { RegionRecord, RegionSnapshot, TownStateV2 } from '../../../src/shared/world';
import type { WorldState } from '../../../src/sim/types';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { buildWorldMap, regionDef } from '../../../src/shared/mildewLane';
import { capWorldSize, jsonBytes, measureWorld, oversizedSnapshots, regionSnapshotLimit, SAVE_BUDGET, SNAPSHOT_MODIFIED_KEY } from '../../../src/shared/worldBudget';
import { ac1Options, runAc1 } from './ac1Harness';

const MAP = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 1 }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' });
const kindOf = (id: string) => regionDef(MAP, id)?.kind ?? 'lot';

function furnishedLot(template: 'starter' | 'derelict' | 'empty', seed: number): { snap: RegionSnapshot; placed: number } {
  const sim = createSimulation(createNewWorld(ac1Options(template, seed)));
  sim.dispatch({ type: 'cheat', code: 'motherlode' });
  for (let i = 0; i < 40; i++) sim.dispatch({ type: 'cheat', code: 'graverobber' });
  const defs = Object.values(loadContent().objects)
    .filter((d) => d.buyable && d.placement === 'floor')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  let placed = 0;
  const lot = sim.state.lot;
  for (const d of defs) {
    for (let z = lot.buildable.z0; z < lot.buildable.z1; z += 2) {
      for (let x = lot.buildable.x0; x < lot.buildable.x1; x += 2) {
        if (sim.build.apply({ type: 'buy', defId: d.id, x, z, rot: 0 }).ok) placed++;
      }
    }
  }
  sim.dispatch({ type: 'endBuildSession' });
  // a dormant region keeps only its lot, its objects and closed-form data (no agents: townies are schedules, §1.6)
  return { snap: { savedTick: 5760, lot: JSON.parse(JSON.stringify(lot)), objects: JSON.parse(JSON.stringify(sim.state.objects)), data: { dirt: 3, items: 2 } }, placed };
}

function streetSnapshot(id: string): RegionSnapshot {
  const def = regionDef(MAP, id)!;
  const { width, depth } = def.placement;
  // a street region snapshot exists only when it holds dropped items (§1.11 table): a few loose plates and limbs
  const objects: Record<string, unknown> = {};
  for (let i = 0; i < 6; i++)
    objects[`o${9000 + i}`] = {
      id: `o${9000 + i}`,
      defId: 'plate_dirty',
      regionId: id,
      placement: { kind: 'loose', x: 2.5 + i, z: 4.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 },
      value: 0,
      purchasedTick: 100,
      tint: null,
      condition: { broken: false, dirt: 0.5, burning: false, burnMinutes: 0 },
      data: { createdTick: 100 },
      reservedBy: {},
      inUseBy: [],
      rev: 1,
    };
  return {
    savedTick: 5760,
    lot: { width, depth, buildable: { x0: 0, z0: 0, x1: 0, z1: 0 }, sidewalkZ: 0, entryPoints: [], walls: {}, floors: new Array(width * depth).fill(null), version: 1, wallVersion: 1, floorVersion: 1 },
    objects,
    data: {},
  };
}

function record(id: string, snapshot: RegionSnapshot | null, firstActiveTick = 100): RegionRecord {
  return { id, snapshot, caughtUpTick: 5760, firstActiveTick };
}

describe('AC-12: save size', () => {
  it('Wormwood + Old Graveyard fully visited and furnished: ≤ 2 MB, every snapshot within its hard limit', async () => {
    const sim = createSimulation(createNewWorld(ac1Options('starter', 7)));
    await runAc1('size', sim, 2);
    const world = sim.serialize();
    const town = world.town as TownStateV2;
    const templates = ['starter', 'derelict', 'empty'] as const;
    const placedCounts: number[] = [];
    let n = 0;
    for (const r of MAP.regions) {
      if (r.kind === 'unfinished' || r.id === town.homeLotId) continue;
      if (r.kind === 'lot') {
        const { snap, placed } = furnishedLot(templates[n % 3], 100 + n);
        placedCounts.push(placed);
        town.regions[r.id] = record(r.id, snap);
      } else town.regions[r.id] = record(r.id, streetSnapshot(r.id));
      n++;
    }
    const lots = MAP.regions.filter((r) => r.kind === 'lot' && r.id !== town.homeLotId).length;
    const streets = MAP.regions.filter((r) => r.kind === 'street').length;
    expect(Object.keys(town.regions).length).toBe(1 + lots + streets); // 16 regions visited (the frontier never is)
    expect(Math.min(...placedCounts)).toBeGreaterThan(20); // the lots really are packed
    const rep = measureWorld(world as unknown as WorldState & Record<string, unknown>);
    // jsonBytes is byte-exact canonical JSON (what the SaveManager stores before gzip)
    expect(rep.total).toBe(new TextEncoder().encode(canonicalJson(world)).byteLength);
    const snaps = Object.entries(rep.snapshots).sort((a, b) => b[1] - a[1]);
    console.log(
      `[AC-12] world ${(rep.total / 1024).toFixed(1)} KB (town ${(rep.town! / 1024).toFixed(1)} KB), ${snaps.length} snapshots; largest ${snaps[0][0]} ${(snaps[0][1] / 1024).toFixed(1)} KB; objects placed per lot ${placedCounts.join('/')}`,
    );
    expect(rep.withinTarget).toBe(true);
    expect(rep.total).toBeLessThanOrEqual(SAVE_BUDGET.worldTarget);
    expect(oversizedSnapshots(town, kindOf)).toEqual([]);
    for (const [id, bytes] of snaps) expect(bytes, id).toBeLessThanOrEqual(regionSnapshotLimit(id, kindOf(id)));
    expect(regionSnapshotLimit('graveyard:old_graveyard', 'lot')).toBe(SAVE_BUDGET.lotCommunityMax);
    expect(regionSnapshotLimit('street:mildew:1', 'street')).toBe(SAVE_BUDGET.streetMax);
    // a world within the cap is never touched
    const before = canonicalJson(world);
    expect(capWorldSize(world as unknown as WorldState & Record<string, unknown>)).toEqual([]);
    expect(canonicalJson(world)).toBe(before);
  }, 240_000);

  it('the 4 MB hard cap: oldest never-modified neighbours go first, deterministically; home / owned / modified never', () => {
    const { snap } = furnishedLot('starter', 3);
    const each = jsonBytes(snap);
    const build = (order: 'asc' | 'desc'): WorldState & Record<string, unknown> => {
      const w = createNewWorld(ac1Options('empty', 4)) as WorldState & Record<string, unknown>;
      const t = w.town as TownStateV2;
      const ids = Array.from({ length: Math.ceil((5 * 1024 * 1024) / each) }, (_, i) => `wormwood:far_${String(i).padStart(3, '0')}`);
      if (order === 'desc') ids.reverse();
      for (const id of ids) {
        const i = Number(id.slice(-3));
        const s: RegionSnapshot = { ...JSON.parse(JSON.stringify(snap)), savedTick: 1000 + (i % 7) * 10 };
        if (i % 5 === 0) s.data = { ...s.data, [SNAPSHOT_MODIFIED_KEY]: 500 };
        t.regions[id] = record(id, s);
      }
      t.ownedLotIds = [...t.ownedLotIds, 'wormwood:far_001'];
      t.regions[t.homeLotId] = record(t.homeLotId, JSON.parse(JSON.stringify(snap)) as RegionSnapshot, 0);
      return w;
    };
    const a = build('asc');
    expect(measureWorld(a).withinHardCap).toBe(false);
    const dropped = capWorldSize(a);
    expect(measureWorld(a).total).toBeLessThanOrEqual(SAVE_BUDGET.worldHardCap);
    expect(dropped.length).toBeGreaterThan(0);
    const t = a.town as TownStateV2;
    expect(t.regions[t.homeLotId].snapshot).not.toBeNull();
    expect(t.regions['wormwood:far_001'].snapshot).not.toBeNull();
    for (const id of dropped) {
      expect(Number(id.slice(-3)) % 5).not.toBe(0); // modified regions are kept
      expect(t.regions[id].snapshot).toBeNull();
      expect(t.regions[id].caughtUpTick).toBe(5760); // the record (and its watermark) stays
    }
    // oldest first: every dropped snapshot is at least as old as every kept droppable one
    const keptDroppable = Object.values(t.regions).filter((r) => r.snapshot && r.id !== t.homeLotId && r.id !== 'wormwood:far_001' && !(SNAPSHOT_MODIFIED_KEY in r.snapshot.data));
    const build2 = build('asc');
    const savedTicks = new Map(Object.values((build2.town as TownStateV2).regions).map((r) => [r.id, r.snapshot?.savedTick ?? 0] as const));
    const maxDropped = Math.max(...dropped.map((id) => savedTicks.get(id)!));
    for (const r of keptDroppable) expect(r.snapshot!.savedTick).toBeGreaterThanOrEqual(maxDropped);
    // deterministic and independent of key order
    const b = build('desc');
    expect(capWorldSize(b)).toEqual(dropped);
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    // idempotent: a second pass drops nothing
    expect(capWorldSize(a)).toEqual([]);
  }, 120_000);
});
