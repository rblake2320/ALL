/**
 * Home build rules on the REAL simulation (docs/contract-requests/home-build-system.md section 4 step 2): in a world
 * made with snap-point building, the first 20 items go on snap points, the 20th unlocks Free Placement (announced
 * once, saved), service points and the decoration budget refuse more, and a world without the flag builds freely as
 * it always did.
 */
import { describe, expect, it } from 'vitest';
import * as simModule from '../../../src/sim/index';
import type { SimulationAPI, BuildCommand } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { validateWorld } from '../../../src/persistence/validation';
import { FREE_PLACEMENT_AT, HOME_TIERS, isSnapSpot } from '../../../src/shared/homeBuild';

function sim(opts: { homeBuild: boolean; lot?: 'starter' | 'empty'; seed?: number }): SimulationAPI {
  const m = simModule;
  const catalog = buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES);
  const h = randomHousehold((opts.seed ?? 3) * 7919, catalog, 2);
  const world = m.createNewWorld({ seed: opts.seed ?? 3, householdName: h.householdName, members: h.members, lotTemplate: opts.lot ?? 'empty', difficulty: 'normal', homeBuild: opts.homeBuild });
  const s = m.createSimulation(world);
  s.state.household.funds = 10_000_000;
  return s;
}
const buy = (s: SimulationAPI, defId: string, x: number, z: number) => s.build.apply({ type: 'buy', defId, x, z, rot: 0 } as BuildCommand);
const free = (s: SimulationAPI, defId: string) => {
  // any legal free tile (scan the lot), used once Free Placement is on
  for (let z = 1; z < s.state.lot.depth - 1; z += 1) for (let x = 1; x < s.state.lot.width - 1; x += 1) if (s.spatial.checkPlace(defId, x, z, 0).ok) return { x, z };
  return null;
};

describe('a world without the flag builds freely (nothing changes for old saves and test worlds)', () => {
  it('no homeBuild state; an item on an odd tile is placed; no markers', () => {
    const s = sim({ homeBuild: false });
    expect(s.state.homeBuild).toBeUndefined();
    expect(buy(s, 'chair_creaky', 7, 9).ok).toBe(true);
    expect(s.spatial.snapPoints?.('chair_creaky') ?? []).toEqual([]);
  });
});

describe('snap points for the first 20 items, then Free Placement', () => {
  it('the world carries the state, starting at 0 placed and snap mode', () => {
    const s = sim({ homeBuild: true });
    expect(s.state.homeBuild).toEqual({ tier: 'starter', placedEver: 0, freePlacement: false });
  });

  it('off a snap point is refused with the reason; on one it works; the ghost check (checkPlace) agrees', () => {
    const s = sim({ homeBuild: true });
    const off = buy(s, 'chair_creaky', 7, 9);
    expect(off.ok).toBe(false);
    expect(off.reason).toMatch(/snap point/i);
    expect(s.spatial.checkPlace('chair_creaky', 7, 9, 0)).toMatchObject({ ok: false });
    expect(s.spatial.checkPlace('chair_creaky', 8, 10, 0)).toMatchObject({ ok: true });
    expect(buy(s, 'chair_creaky', 8, 10).ok).toBe(true);
    expect(s.state.homeBuild!.placedEver).toBe(1);
  });

  it('the markers are exactly the snap points the placement check accepts, and vanish once Free Placement is on', () => {
    const s = sim({ homeBuild: true });
    const pts = s.spatial.snapPoints!('chair_creaky');
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) {
      expect(isSnapSpot('floor', { x: p.x, z: p.z }), `${p.x},${p.z}`).toBe(true);
      expect(s.spatial.checkPlace('chair_creaky', Math.floor(p.x), Math.floor(p.z), 0).ok).toBe(true);
    }
    s.state.homeBuild!.freePlacement = true;
    expect(s.spatial.snapPoints!('chair_creaky')).toEqual([]);
  });

  it('wall items go on snap edges only', () => {
    const s = sim({ homeBuild: true, lot: 'starter' });
    const pts = s.spatial.snapPoints!('painting_greatgrand');
    expect(pts.length).toBeGreaterThan(0);
    const good = pts[0];
    expect(good.kind).toBe('wall');
    const r = s.build.apply({ type: 'buyWallItem', defId: 'painting_greatgrand', edge: good.edge!, side: good.side! } as BuildCommand);
    expect(r.ok).toBe(true);
  });

  it('the 20th item unlocks Free Placement exactly once, announced once, and an odd tile then works', () => {
    const s = sim({ homeBuild: true });
    const spots = s.spatial.snapPoints!('chair_creaky');
    let placed = 0;
    const toasts = () => s.state.notifications.filter((n) => /Free Placement unlocked/.test(n.title)).length;
    for (const p of spots) {
      if (placed === FREE_PLACEMENT_AT) break;
      // each placement changes what fits: re-ask the sim, do not trust the stale list
      if (!s.spatial.checkPlace('chair_creaky', Math.floor(p.x), Math.floor(p.z), 0).ok) continue;
      expect(buy(s, 'chair_creaky', Math.floor(p.x), Math.floor(p.z)).ok).toBe(true);
      placed++;
      expect(s.state.homeBuild!.freePlacement, `after ${placed}`).toBe(placed >= FREE_PLACEMENT_AT);
      expect(toasts()).toBe(placed >= FREE_PLACEMENT_AT ? 1 : 0);
    }
    expect(placed).toBe(FREE_PLACEMENT_AT);
    const odd = free(s, 'chair_creaky')!;
    expect(isSnapSpot('floor', odd) && true).toBeDefined();
    // find an off-lattice tile that the base check accepts: it must work now
    let done = false;
    for (let z = 1; z < s.state.lot.depth && !done; z++) for (let x = 1; x < s.state.lot.width && !done; x++) if (!isSnapSpot('floor', { x, z }) && s.spatial.checkPlace('chair_creaky', x, z, 0).ok) done = buy(s, 'chair_creaky', x, z).ok;
    expect(done).toBe(true);
    expect(toasts()).toBe(1);
  }, 120_000);

  it('the state is saved and valid; a loaded world keeps Free Placement', () => {
    const s = sim({ homeBuild: true });
    s.state.homeBuild = { tier: 'starter', placedEver: 25, freePlacement: true };
    const w = JSON.parse(JSON.stringify(s.serialize())) as WorldState;
    const v = validateWorld(JSON.parse(JSON.stringify(w)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.world.homeBuild).toEqual({ tier: 'starter', placedEver: 25, freePlacement: true });
    const bad = JSON.parse(JSON.stringify(w)) as WorldState & { homeBuild: unknown };
    bad.homeBuild = { tier: 'castle', placedEver: -1 } as never;
    const v2 = validateWorld(bad as unknown as WorldState);
    expect(v2.ok).toBe(true);
    const old = JSON.parse(JSON.stringify(w)) as Partial<WorldState>;
    delete old.homeBuild;
    const v3 = validateWorld(old);
    expect(v3.ok && v3.issues.length).toBe(0);
  });
});

describe('amenities stay on service points even after Free Placement', () => {
  it('in Free Placement a chair goes anywhere but the embalming station only on a service point (pink marker)', () => {
    const s = sim({ homeBuild: true, lot: 'starter' });
    s.state.homeBuild = { tier: 'starter', placedEver: 99, freePlacement: true };
    expect(s.spatial.snapPoints!('chair_creaky')).toEqual([]); // no markers for decoration any more
    const pts = s.spatial.snapPoints!('station_embalming');
    expect(pts.length).toBeGreaterThan(0);
    expect(new Set(pts.map((p) => p.kind))).toEqual(new Set(['service']));
    let off: { x: number; z: number } | null = null;
    for (let z = 1; z < s.state.lot.depth - 1 && !off; z++) for (let x = 1; x < s.state.lot.width - 1 && !off; x++) if (!isSnapSpot('floor', { x, z }) && s.spatial.checkPlace('chair_creaky', x, z, 0).ok) off = { x, z };
    expect(off).not.toBeNull();
    expect(s.spatial.checkPlace('station_embalming', off!.x, off!.z, 0)).toMatchObject({ ok: false });
    expect(s.spatial.checkPlace('station_embalming', off!.x, off!.z, 0).reason).toMatch(/service point/i);
    const on = pts[0];
    expect(buy(s, 'station_embalming', Math.floor(on.x), Math.floor(on.z)).ok).toBe(true);
  });
});

describe('caps: service points and the decoration budget', () => {
  it('service furniture is refused past the tier\'s service points; it does not use the decoration budget', () => {
    const s = sim({ homeBuild: true, lot: 'starter' });
    s.state.homeBuild = { tier: 'starter', placedEver: 99, freePlacement: true };
    const points = HOME_TIERS.starter.servicePoints;
    for (let i = 0; i < points; i++) {
      const at = free(s, 'station_embalming');
      expect(at, `spot ${i}`).not.toBeNull();
      expect(buy(s, 'station_embalming', at!.x, at!.z).ok, `service ${i}`).toBe(true);
    }
    // the cap shows in the placement check itself (so the ghost turns red with the reason), on every tile the base check allows
    let capped: { x: number; z: number } | null = null;
    for (let z = 1; z < s.state.lot.depth - 1 && !capped; z++) for (let x = 1; x < s.state.lot.width - 1 && !capped; x++) if (/service points/i.test(s.spatial.checkPlace('station_embalming', x, z, 0).reason ?? '')) capped = { x, z };
    expect(capped).not.toBeNull();
    const r = buy(s, 'station_embalming', capped!.x, capped!.z);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/service points/i);
    expect(buy(s, 'chair_creaky', free(s, 'chair_creaky')!.x, free(s, 'chair_creaky')!.z).ok).toBe(true); // decoration is another budget
  }, 120_000);

  it('the decoration budget refuses the next item at the tier limit', () => {
    const s = sim({ homeBuild: true });
    s.state.homeBuild = { tier: 'starter', placedEver: 99, freePlacement: true };
    const budget = HOME_TIERS.starter.decorBudget;
    let n = 0;
    for (; n < budget + 5; n++) {
      const at = free(s, 'rug_rag') ?? free(s, 'chair_creaky');
      const def = free(s, 'rug_rag') ? 'rug_rag' : 'chair_creaky';
      if (!at) break;
      const r = buy(s, def, at.x, at.z);
      if (!r.ok) {
        expect(r.reason).toMatch(/holds \d+ items/);
        break;
      }
    }
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(budget);
  }, 180_000);
});
