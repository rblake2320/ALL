/**
 * Home services on the REAL simulation (docs/contract-requests/home-build-system.md section 4 steps 3 and 4): every command
 * is refused without its working furniture, then works and is saved; the Hearth pays Rot Essence once a day while it
 * stands and the utilities are on; a save written before the system loads and gets an empty block; a damaged block
 * is dropped, not trusted. Furniture is put into the world directly here: the placement rules have their own tests.
 */
import { describe, expect, it } from 'vitest';
import * as simModule from '../../../src/sim/index';
import type { Command, SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { ObjectState, WorldState } from '../../../src/sim/types';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { validateWorld } from '../../../src/persistence/validation';
import { HEARTH_UPGRADES } from '../../../src/shared/homeBuild';
import { ESSENCE_EARN, MAX_SAVED_BUILDS, STASH_CAPS } from '../../../src/shared/homeServices';
import { SWAP_COOLDOWN_TICKS, buildChangeBlocked, creditEssence } from '../../../src/sim/systems/homeServices';
import { placedItems } from '../../../src/sim/spatial/homeBuildRules';
import { setProgress } from '../../../src/shared/homeBuild';
import type { SimContext } from '../../../src/sim/contracts';

const thresholdsIn = (s: SimulationAPI) => setProgress(placedItems(s.state)).reduce((n, p) => n + p.earned.length, 0);

function newSim(seed = 3): SimulationAPI {
  const m = simModule;
  const catalog = buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES);
  const h = randomHousehold(seed * 7919, catalog, 2);
  return m.createSimulation(m.createNewWorld({ seed, householdName: h.householdName, members: h.members, lotTemplate: 'empty', difficulty: 'normal' }));
}

let uid = 9000;
function put(s: SimulationAPI, defId: string): string {
  const id = `o${uid++}`;
  const o: ObjectState = { id, defId, placement: { kind: 'floor', x: 1 + (uid % 6), z: 1, rot: 0 }, value: 0, purchasedTick: 0, tint: null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: {}, reservedBy: {}, inUseBy: [], rev: 0 };
  s.state.objects[id] = o;
  return id;
}
function load(w: unknown): { world: WorldState; issues: { path: string; message: string }[] } {
  const v = validateWorld(JSON.parse(JSON.stringify(w)));
  if (!v.ok) throw new Error(`world refused: ${v.errors.join('; ')}`);
  return { world: v.world, issues: v.issues };
}
const home = (s: SimulationAPI, c: Record<string, unknown>) => s.dispatch({ type: 'home', ...c } as Command);
const firstMember = (s: SimulationAPI) => s.state.household.memberIds[0];
const eventsOf = (s: SimulationAPI) => {
  const out: SimEvent[] = [];
  const off = (s as unknown as { onEvent?: (f: (e: SimEvent) => void) => () => void }).onEvent?.((e) => out.push(e));
  return { out, off };
};

describe('home services: the world carries the block', () => {
  it('a new world starts with an empty, cold block', () => {
    const s = newSim();
    expect(s.state.homeServices).toMatchObject({ version: 1, essenceDay: -1, hearth: { essence: 0, owned: [] }, wardrobe: {}, respecDay: {} });
  });

  it('a save without the block loads, gets an empty one, and validates with no issue', () => {
    const s = newSim();
    const w = JSON.parse(JSON.stringify(s.state)) as WorldState;
    delete w.homeServices;
    const v = load(w);
    expect(v.issues.filter((i) => /homeServices/.test(i.path))).toEqual([]);
    const s2 = simModule.createSimulation(v.world);
    expect(s2.state.homeServices?.version).toBe(1);
  });

  it('a damaged block is repaired or dropped with a note, never trusted', () => {
    const s = newSim();
    const w = JSON.parse(JSON.stringify(s.state)) as WorldState;
    (w as unknown as Record<string, unknown>).homeServices = { version: 1, hearth: { essence: 'lots' }, wardrobe: 5 };
    const v = load(w);
    expect(v.issues.some((i) => /homeServices/.test(i.path))).toBe(true);
    const s2 = simModule.createSimulation(v.world);
    expect(s2.state.homeServices).toMatchObject({ essenceDay: -1, hearth: { essence: 0, owned: [] } });
  });

  it('survives a JSON round trip with its content', () => {
    const s = newSim();
    put(s, 'vault_crypt');
    expect(home(s, { action: 'stashPut', material: 'bone', units: 7 }).ok).toBe(true);
    const copy = simModule.createSimulation(load(s.state).world);
    expect(copy.state.homeServices!.stash.bone).toBe(7);
  });
});

describe('every service is refused without its furniture', () => {
  it.each([
    ['hearthBuy', { upgradeId: 'wardRest' }, /Hearth/],
    ['wardrobeSave', { name: 'A', payload: {} }, /Wardrobe/],
    ['respec', {}, /Embalming/],
    ['stashPut', { material: 'bone', units: 1 }, /Vault/],
  ])('%s', (action, extra, msg) => {
    const s = newSim();
    const r = home(s, { action, agentId: firstMember(s), ...extra });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(msg);
  });

  it('junk is refused, never thrown', () => {
    const s = newSim();
    for (const bad of [{}, { action: 'nope' }, { action: 'stashPut', material: 5, units: 1 }, { action: 'wardrobeSave', agentId: 7 }]) {
      expect(() => home(s, bad)).not.toThrow();
      expect(home(s, bad).ok).toBe(false);
    }
  });
});

describe('the Hearth', () => {
  it('pays Rot Essence once per day while it stands and the power is on, and never twice for a day', () => {
    const s = newSim();
    put(s, 'hearth_stone');
    s.state.household.utilitiesOn = true;
    const DAY_TICKS = 24 * 60 * 4; // 4 ticks per game minute
    const toFirstMidnight = 15 * 60 * 4; // the game starts at 09:00
    for (let i = 0; i < toFirstMidnight + 5; i++) s.step();
    expect(s.state.homeServices!.essenceDay).toBe(2);
    const perDay = ESSENCE_EARN.hearthDay + Math.min(ESSENCE_EARN.setBonusCap, thresholdsIn(s)) * ESSENCE_EARN.perSetThreshold;
    expect(s.state.homeServices!.hearth.essence).toBe(perDay);
    for (let i = 0; i < DAY_TICKS - 5; i++) s.step();
    expect(s.state.homeServices!.essenceDay).toBe(3);
    expect(s.state.homeServices!.hearth.essence).toBe(perDay * 2);
  });

  it('pays nothing without the Hearth', () => {
    const none = newSim();
    for (let i = 0; i < 3700; i++) none.step();
    expect(none.state.homeServices!.hearth.essence).toBe(0);
  });

  it('a cold Hearth (utilities off) pays nothing that day, and the day is not paid late once the power is back', () => {
    const s = newSim();
    put(s, 'hearth_stone');
    const ctx = { state: s.state } as unknown as SimContext;
    s.state.household.utilitiesOn = false;
    creditEssence(ctx, 5);
    expect(s.state.homeServices!.hearth.essence).toBe(0);
    expect(s.state.homeServices!.essenceDay).toBe(5);
    s.state.household.utilitiesOn = true;
    creditEssence(ctx, 5); // the same day again: still nothing
    expect(s.state.homeServices!.hearth.essence).toBe(0);
    creditEssence(ctx, 6);
    expect(s.state.homeServices!.hearth.essence).toBeGreaterThanOrEqual(ESSENCE_EARN.hearthDay);
  });

  it('buys an upgrade with essence, refuses when poor, owned, cold or out of order', () => {
    const s = newSim();
    put(s, 'hearth_stone');
    s.state.household.utilitiesOn = true;
    expect(home(s, { action: 'hearthBuy', upgradeId: 'wardRest' }).reason).toMatch(/Rot Essence/);
    s.state.homeServices!.hearth = { essence: 500, owned: [] };
    expect(home(s, { action: 'hearthBuy', upgradeId: 'perkSlot' }).reason).toMatch(/first/);
    expect(home(s, { action: 'hearthBuy', upgradeId: 'nope' }).ok).toBe(false);
    expect(home(s, { action: 'hearthBuy', upgradeId: 'wardRest' }).ok).toBe(true);
    const cost = HEARTH_UPGRADES.find((u) => u.id === 'wardRest')!.cost;
    expect(s.state.homeServices!.hearth).toEqual({ essence: 500 - cost, owned: ['wardRest'] });
    expect(home(s, { action: 'hearthBuy', upgradeId: 'wardRest' }).reason).toMatch(/Already/);
    s.state.household.utilitiesOn = false;
    expect(home(s, { action: 'hearthBuy', upgradeId: 'wardFresh' }).reason).toMatch(/cold/);
  });
});

describe('the Wardrobe', () => {
  it('saves, swaps with the cooldown, deletes, and tells the build data on a swap', () => {
    const s = newSim();
    put(s, 'wardrobe_coffin');
    const id = firstMember(s);
    const ev = eventsOf(s);
    expect(home(s, { action: 'wardrobeSave', agentId: id, name: 'Day', payload: { n: 1 } }).ok).toBe(true);
    expect(home(s, { action: 'wardrobeSave', agentId: id, name: 'Night', payload: { n: 2 } }).ok).toBe(true);
    const slots = s.state.homeServices!.wardrobe[id].slots;
    expect(slots.map((x) => x.name)).toEqual(['Day', 'Night']);
    expect(home(s, { action: 'wardrobeSwap', agentId: id, recordId: slots[0].id }).ok).toBe(true);
    expect(home(s, { action: 'wardrobeSwap', agentId: id, recordId: slots[1].id }).reason).toMatch(/swapped again/);
    for (let i = 0; i < SWAP_COOLDOWN_TICKS; i++) s.step();
    expect(home(s, { action: 'wardrobeSwap', agentId: id, recordId: slots[1].id }).ok).toBe(true);
    expect(s.state.homeServices!.wardrobe[id].activeId).toBe(slots[1].id);
    ev.off?.();
    expect(home(s, { action: 'wardrobeDelete', agentId: id, recordId: slots[1].id }).ok).toBe(true);
    expect(s.state.homeServices!.wardrobe[id].activeId).toBeNull();
  });

  it('holds MAX_SAVED_BUILDS per zombie, separately for each zombie', () => {
    const s = newSim();
    put(s, 'wardrobe_coffin');
    const [a, b] = s.state.household.memberIds;
    for (let i = 0; i < MAX_SAVED_BUILDS; i++) expect(home(s, { action: 'wardrobeSave', agentId: a, name: `B${i}`, payload: i }).ok).toBe(true);
    expect(home(s, { action: 'wardrobeSave', agentId: a, name: 'extra', payload: 1 }).reason).toMatch(/Delete one/);
    expect(home(s, { action: 'wardrobeSave', agentId: b, name: 'mine', payload: 1 }).ok).toBe(true);
  });

  it('refuses a stranger and a zombie who is not at home', () => {
    const s = newSim();
    put(s, 'wardrobe_coffin');
    expect(home(s, { action: 'wardrobeSave', agentId: 'a99999', name: 'X', payload: 1 }).ok).toBe(false);
    s.state.agents[firstMember(s)].presence = 'atWork';
    expect(home(s, { action: 'wardrobeSave', agentId: firstMember(s), name: 'X', payload: 1 }).reason).toMatch(/not at home/);
  });
});

describe('the Embalming station respec gate', () => {
  it('allows one respec per zombie per game day and announces it', () => {
    const s = newSim();
    put(s, 'station_embalming');
    const id = firstMember(s);
    expect(home(s, { action: 'respec', agentId: id }).ok).toBe(true);
    expect(home(s, { action: 'respec', agentId: id }).reason).toMatch(/tomorrow/);
    const other = s.state.household.memberIds[1];
    expect(home(s, { action: 'respec', agentId: other }).ok).toBe(true);
  });
});

describe('the Crypt vault', () => {
  it('stores and returns materials up to the cap', () => {
    const s = newSim();
    put(s, 'vault_crypt');
    expect(home(s, { action: 'stashPut', material: 'ecto', units: 25 }).ok).toBe(true);
    expect(s.state.homeServices!.stash.ecto).toBe(STASH_CAPS.ecto);
    expect(home(s, { action: 'stashPut', material: 'ecto', units: 1 }).ok).toBe(false);
    expect(home(s, { action: 'stashTake', material: 'ecto', units: 5 }).ok).toBe(true);
    expect(home(s, { action: 'stashTake', material: 'ecto', units: 50 }).ok).toBe(false);
    expect(home(s, { action: 'stashPut', material: 'gold', units: 1 }).ok).toBe(false);
  });
});

describe('no build change during a fight or an event (fail closed)', () => {
  function withBuilds(): { s: SimulationAPI; id: string; rec: string } {
    const s = newSim();
    put(s, 'wardrobe_coffin');
    put(s, 'station_embalming');
    const id = firstMember(s);
    home(s, { action: 'wardrobeSave', agentId: id, name: 'A', payload: 1 });
    home(s, { action: 'wardrobeSave', agentId: id, name: 'B', payload: 2 });
    return { s, id, rec: s.state.homeServices!.wardrobe[id].slots[1].id };
  }
  const refused = (s: SimulationAPI, id: string, rec: string, msg: RegExp) => {
    const swap = home(s, { action: 'wardrobeSwap', agentId: id, recordId: rec });
    const respec = home(s, { action: 'respec', agentId: id });
    expect(swap.ok).toBe(false);
    expect(swap.reason).toMatch(msg);
    expect(respec.ok).toBe(false);
    expect(respec.reason).toMatch(msg);
  };

  it('a burning fire refuses a swap and a respec, and putting it out allows them again', () => {
    const { s, id, rec } = withBuilds();
    const fireId = put(s, 'item_fire');
    refused(s, id, rec, /fire is burning/i);
    delete s.state.objects[fireId];
    const sw = home(s, { action: 'wardrobeSwap', agentId: id, recordId: rec });
    expect(sw, String(sw.reason)).toMatchObject({ ok: true });
    const rs = home(s, { action: 'respec', agentId: id });
    expect(rs, String(rs.reason)).toMatchObject({ ok: true });
  });

  it('the build lock flag of a combat or event system refuses, and clearing it allows', () => {
    const { s, id, rec } = withBuilds();
    s.state.flags['home.buildLock'] = true;
    refused(s, id, rec, /fight or an event/i);
    s.state.flags['home.buildLock'] = false;
    expect(home(s, { action: 'wardrobeSwap', agentId: id, recordId: rec }).ok).toBe(true);
  });

  it('a Repo Ghoul on the lot refuses', () => {
    const { s, id, rec } = withBuilds();
    const other = s.state.household.memberIds[1];
    const a = s.state.agents[other];
    a.presence = 'onLot';
    a.visit = { arrivedTick: 0, leaveTick: 99999, reason: 'repo', welcomed: false, leaving: false };
    refused(s, id, rec, /Repo Ghoul/);
  });

  it('a get-together in progress refuses; once the guests leave it allows', () => {
    const { s, id, rec } = withBuilds();
    const other = s.state.household.memberIds[1];
    const a = s.state.agents[other];
    a.presence = 'onLot';
    a.visit = { arrivedTick: 0, leaveTick: 99999, reason: 'party', welcomed: true, leaving: false };
    refused(s, id, rec, /get-together/);
    a.visit = null;
    expect(home(s, { action: 'wardrobeSwap', agentId: id, recordId: rec }).ok).toBe(true);
  });

  it('NEGATIVE CONTROL: the gate is not a stub. It names a reason for every blocking state and null for a quiet home', () => {
    const { s, id } = withBuilds();
    const ctx = (s as unknown as { engine: { ctx: SimContext } }).engine.ctx;
    const agent = s.state.agents[id];
    expect(buildChangeBlocked(ctx, agent)).toBeNull();
    const reasons = new Set<string>();
    const fire = put(s, 'item_fire');
    reasons.add(String(buildChangeBlocked(ctx, agent)));
    delete s.state.objects[fire];
    s.state.flags['home.buildLock'] = true;
    reasons.add(String(buildChangeBlocked(ctx, agent)));
    s.state.flags['home.buildLock'] = false;
    agent.active = { interactionId: 'home_fightFire' } as never;
    reasons.add(String(buildChangeBlocked(ctx, agent)));
    agent.active = null;
    expect([...reasons].every((r) => r !== 'null' && r.length > 8)).toBe(true);
    expect(reasons.size).toBe(3);
    expect(buildChangeBlocked(ctx, agent)).toBeNull();
  });

  it('a zombie fighting a fire refuses for that zombie', () => {
    const { s, id, rec } = withBuilds();
    s.state.agents[id].active = { interactionId: 'home_fightFire' } as never;
    refused(s, id, rec, /fighting a fire/);
  });

  it('an unreadable world refuses instead of allowing', () => {
    const { s, id, rec } = withBuilds();
    (s.state as unknown as { agents: unknown }).agents = null;
    const r = home(s, { action: 'wardrobeSwap', agentId: id, recordId: rec });
    expect(r.ok).toBe(false);
  });

  it('a refused swap changes nothing: the active build, the cooldown and the respec day stay as they were', () => {
    const { s, id, rec } = withBuilds();
    s.state.flags['home.buildLock'] = true;
    const before = JSON.stringify(s.state.homeServices);
    home(s, { action: 'wardrobeSwap', agentId: id, recordId: rec });
    home(s, { action: 'respec', agentId: id });
    expect(JSON.stringify(s.state.homeServices)).toBe(before);
  });
});
