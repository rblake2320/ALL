/**
 * What the home service screens show and which click-menu rows open them (src/game/homeView.ts, src/game/homeMenu.ts),
 * on the real simulation: upgrade states (buy / poor / needs / cold / owned), home bonuses in force from sets and
 * wards, the Wardrobe cooldown, the respec day and the vault.
 */
import { describe, expect, it } from 'vitest';
import * as simModule from '../../../src/sim/index';
import type { Command, SimulationAPI } from '../../../src/sim/contracts';
import type { ObjectState } from '../../../src/sim/types';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { describeBonus, hearthView, respecView, vaultView, wardrobeView } from '../../../src/game/homeView';
import { HOME_ENTRY_PREFIX, homeMenuEntries, homeServiceOfEntry } from '../../../src/game/homeMenu';
import { BUILD_DATA_READY, HOME_DIALOG_SERVICES } from '../../../src/shared/homeServices';
import { SWAP_COOLDOWN_TICKS } from '../../../src/sim/systems/homeServices';

function newSim(): SimulationAPI {
  const m = simModule;
  const h = randomHousehold(3 * 7919, buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES), 2);
  return m.createSimulation(m.createNewWorld({ seed: 3, householdName: h.householdName, members: h.members, lotTemplate: 'empty', difficulty: 'normal' }));
}
let uid = 7000;
function put(s: SimulationAPI, defId: string): string {
  const id = `o${uid++}`;
  const o: ObjectState = { id, defId, placement: { kind: 'floor', x: 1 + (uid % 6), z: 1, rot: 0 }, value: 0, purchasedTick: 0, tint: null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: {}, reservedBy: {}, inUseBy: [], rev: 0 };
  s.state.objects[id] = o;
  return id;
}
const home = (s: SimulationAPI, c: Record<string, unknown>) => s.dispatch({ type: 'home', ...c } as Command);

describe('the Hearth screen', () => {
  it('lists every upgrade with its state: cold without power, poor without essence, then buyable, then owned', () => {
    const s = newSim();
    put(s, 'hearth_stone');
    s.state.household.utilitiesOn = false;
    s.state.homeServices!.hearth = { essence: 100, owned: [] };
    expect(hearthView(s.state).rows.every((r) => r.status === 'cold' || r.status === 'needs')).toBe(true);
    s.state.household.utilitiesOn = true;
    s.state.homeServices!.hearth = { essence: 10, owned: [] };
    expect(hearthView(s.state).rows.find((r) => r.id === 'wardRest')).toMatchObject({ status: 'poor' });
    s.state.homeServices!.hearth = { essence: 100, owned: [] };
    const v = hearthView(s.state);
    expect(v.placed).toBe(true);
    expect(v.rows.find((r) => r.id === 'wardRest')).toMatchObject({ status: 'buy', note: null });
    expect(v.rows.find((r) => r.id === 'perkSlot')).toMatchObject({ status: 'needs' });
    expect(home(s, { action: 'hearthBuy', upgradeId: 'wardRest' }).ok).toBe(true);
    expect(hearthView(s.state).rows.find((r) => r.id === 'wardRest')).toMatchObject({ status: 'owned', note: 'Active' });
  });

  it('shows the ward as a home bonus while powered and drops it while the power is cut', () => {
    const s = newSim();
    put(s, 'hearth_stone');
    s.state.household.utilitiesOn = true;
    s.state.homeServices!.hearth = { essence: 100, owned: ['wardRest'] };
    expect(hearthView(s.state).bonuses).toContain('Rest restores 5% faster');
    s.state.household.utilitiesOn = false;
    expect(hearthView(s.state).bonuses).not.toContain('Rest restores 5% faster');
    expect(hearthView(s.state).powered).toBe(false);
  });

  it('shows a furniture set bonus from the placed pieces, with progress to the next', () => {
    const s = newSim();
    s.state.homeBuild = { tier: 'starter', placedEver: 0, freePlacement: false };
    s.state.household.utilitiesOn = true;
    expect(hearthView(s.state).sets.find((x) => x.name === 'Mausoleum')).toBeUndefined();
    put(s, 'coffin_pine');
    put(s, 'lamp_skull');
    const v = hearthView(s.state);
    expect(v.sets).toContainEqual({ name: 'Mausoleum', pieces: 2, tier: 2, nextAt: 4 });
    expect(v.bonuses).toContain('Rest restores 10% faster');
  });

  it('says the Hearth is not placed before it is', () => {
    expect(hearthView(newSim().state).placed).toBe(false);
  });

  it('describes bonuses as life lines, never a fight stat', () => {
    const lines = describeBonus({ restRestorePct: 5, freshnessPerHourAsleep: 1, funGainPct: 5, skillGainPct: 5, gardenGrowthPct: 10, startOfDayFeeling: 'wellInterred' });
    expect(lines).toHaveLength(6);
    expect(lines.join(' ')).not.toMatch(/damage|health|armor|defen[cs]e|attack|crit|speed/i);
  });
});

describe('the Wardrobe, Embalming and vault screens', () => {
  it('shows saved builds, which one is on, and the swap cooldown counting down to zero', () => {
    const s = newSim();
    put(s, 'wardrobe_coffin');
    const id = s.state.household.memberIds[0];
    expect(wardrobeView(s.state, id)).toMatchObject({ slots: [], max: 4, swapReadyInTicks: 0 });
    home(s, { action: 'wardrobeSave', agentId: id, name: 'Day', payload: 1 });
    home(s, { action: 'wardrobeSave', agentId: id, name: 'Night', payload: 2 });
    const [a] = wardrobeView(s.state, id).slots;
    expect(home(s, { action: 'wardrobeSwap', agentId: id, recordId: a.id }).ok).toBe(true);
    const v = wardrobeView(s.state, id);
    expect(v.slots.map((x) => [x.name, x.active])).toEqual([['Day', true], ['Night', false]]);
    expect(v.swapReadyInTicks).toBe(SWAP_COOLDOWN_TICKS);
    for (let i = 0; i < SWAP_COOLDOWN_TICKS; i++) s.step();
    expect(wardrobeView(s.state, id).swapReadyInTicks).toBe(0);
  });

  it('shows the respec as used for the rest of the day', () => {
    const s = newSim();
    put(s, 'station_embalming');
    const id = s.state.household.memberIds[0];
    expect(respecView(s.state, id).ready).toBe(true);
    home(s, { action: 'respec', agentId: id });
    expect(respecView(s.state, id)).toMatchObject({ ready: false });
    expect(respecView(s.state, s.state.household.memberIds[1]).ready).toBe(true);
  });

  it('shows all seven materials with their caps', () => {
    const s = newSim();
    put(s, 'vault_crypt');
    home(s, { action: 'stashPut', material: 'bone', units: 12 });
    const rows = vaultView(s.state);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.id === 'bone')).toMatchObject({ count: 12, cap: 100 });
    expect(rows.find((r) => r.id === 'ecto')).toMatchObject({ count: 0, cap: 20 });
  });

  it('the screens know zombie builds are not in the game yet (one flag for whoever lands them)', () => {
    expect(BUILD_DATA_READY).toBe(false);
  });
});

describe('the click menu rows', () => {
  it('a Hearth, Wardrobe, Embalming Station and Vault each get one row that names its screen', () => {
    const s = newSim();
    for (const defId of ['hearth_stone', 'wardrobe_coffin', 'station_embalming', 'vault_crypt']) {
      const id = put(s, defId);
      const rows = homeMenuEntries(s.state, id);
      expect(rows, defId).toHaveLength(1);
      expect(rows[0].interactionId.startsWith(HOME_ENTRY_PREFIX)).toBe(true);
      expect(homeServiceOfEntry(rows[0])).toBe(rows[0].params.service);
      expect(HOME_DIALOG_SERVICES).toContain(rows[0].params.service);
    }
  });

  it('other objects, the Workbench and the Bone gate get none, and forged rows open nothing', () => {
    const s = newSim();
    for (const defId of ['chair_creaky', 'workbench_bone', 'gate_bone']) expect(homeMenuEntries(s.state, put(s, defId)), defId).toEqual([]);
    expect(homeMenuEntries(s.state, 'o_missing')).toEqual([]);
    const row = homeMenuEntries(s.state, put(s, 'hearth_stone'))[0];
    expect(homeServiceOfEntry({ ...row, params: { service: 'bank' } })).toBeNull();
    expect(homeServiceOfEntry({ ...row, interactionId: 'engine_goHere' })).toBeNull();
  });
});
