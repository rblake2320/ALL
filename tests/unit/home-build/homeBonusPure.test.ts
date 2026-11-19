/**
 * The home bonus is a PURE function of the world (D-003), PR #105 review P1: the same serialized state gives the same bonus
 * whatever was read before and whether or not a tick passed after a build action. These controls fail on the earlier code,
 * which cached the answer by tick + utilities + owned wards and so stayed stale after a same-tick add, removal or undo.
 * Astra's reproduction (zsm-team/astra/pr105-homebonus-probe.cjs) is the first two tests.
 */
import { describe, expect, it } from 'vitest';
import * as simModule from '../../../src/sim/index';
import type { BuildCommand, SimulationAPI } from '../../../src/sim/contracts';
import type { ObjectState, WorldState } from '../../../src/sim/types';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { validateWorld } from '../../../src/persistence/validation';
import { homeLifeBonus, newHomeBuildState } from '../../../src/shared/homeBuild';
import { homeBonusOf } from '../../../src/sim/engine/homeBonus';
import { placedItems } from '../../../src/sim/spatial/homeBuildRules';

const obj = (id: string, defId: string): ObjectState => ({ id, defId, placement: { kind: 'floor', x: 1, z: 1, rot: 0 }, value: 0, purchasedTick: 0, tint: null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: {}, reservedBy: {}, inUseBy: [], rev: 0 });
/** A minimal world: just what the bonus reads (tick, home build, objects, utilities, Hearth). */
function mini(): WorldState {
  return { tick: 123, homeBuild: newHomeBuildState('starter'), objects: {}, household: { utilitiesOn: true }, homeServices: { version: 1, hearth: { essence: 0, owned: [] }, essenceDay: -1, wardrobe: {}, respecDay: {}, stash: {} } } as unknown as WorldState;
}
const fresh = (w: WorldState) => homeBonusOf(structuredClone(w));
const pure = (w: WorldState) => homeLifeBonus(placedItems(w), w.homeServices!.hearth, w.household.utilitiesOn === true);

describe('the bonus never depends on what was read before (Astra probe)', () => {
  it('adding a two-piece set at the same tick shows the bonus at once, equal to a fresh clone and to the pure rule', () => {
    const w = mini();
    expect(homeBonusOf(w)).toEqual({});
    w.objects.a = obj('a', 'coffin_pine');
    w.objects.b = obj('b', 'lamp_skull');
    expect(homeBonusOf(w)).toEqual({ restRestorePct: 10 });
    expect(homeBonusOf(w)).toEqual(fresh(w));
    expect(homeBonusOf(w)).toEqual(pure(w));
  });

  it('removing a piece after the bonus was read removes it at once, equal to a fresh clone', () => {
    const w = mini();
    w.objects.a = obj('a', 'coffin_pine');
    w.objects.b = obj('b', 'lamp_skull');
    expect(homeBonusOf(w).restRestorePct).toBe(10);
    delete w.objects.b;
    expect(homeBonusOf(w)).toEqual({});
    expect(homeBonusOf(w)).toEqual(fresh(w));
  });

  it('utilities off and on, and a Hearth ward bought, take effect at once', () => {
    const w = mini();
    w.homeServices!.hearth = { essence: 0, owned: ['wardRest'] };
    w.objects.h = obj('h', 'hearth_stone');
    expect(homeBonusOf(w).restRestorePct).toBe(5);
    w.household.utilitiesOn = false;
    expect(homeBonusOf(w).restRestorePct ?? 0).toBe(0);
    w.household.utilitiesOn = true;
    expect(homeBonusOf(w).restRestorePct).toBe(5);
    w.homeServices!.hearth = { essence: 0, owned: ['wardRest', 'wardFresh'] };
    expect(homeBonusOf(w).freshnessPerHourAsleep).toBe(1);
  });
});

describe('random edits at one fixed tick: the answer always equals a fresh clone and the pure rule', () => {
  it('600 random add, remove, ward and utilities edits, reading after every edit (every operation really happens)', () => {
    const pieces = ['coffin_pine', 'lamp_skull', 'pew_salvaged', 'candelabra_drippy', 'sofa_velvet', 'table_wake', 'tv_seance', 'arcade_tombstone', 'hearth_stone', 'chair_creaky'];
    const wards = ['wardRest', 'wardFresh', 'wardGarden', 'wardSkill'];
    // xorshift32 on integers: a sound generator (the earlier float multiply + low-bit modulo collapsed to adds only)
    let state = 0x2545f491;
    const rnd = (n: number) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % n;
    };
    const w = mini();
    let n = 0;
    const counts = { add: 0, remove: 0, ward: 0, utilities: 0 };
    for (let i = 0; i < 600; i++) {
      const op = i % 4 === 3 ? rnd(4) : rnd(4);
      if (op === 0) {
        w.objects[`o${n}`] = obj(`o${n}`, pieces[rnd(pieces.length)]);
        n++;
        counts.add++;
      } else if (op === 1) {
        const ids = Object.keys(w.objects);
        if (ids.length) {
          delete w.objects[ids[rnd(ids.length)]];
          counts.remove++;
        }
      } else if (op === 2) {
        w.homeServices!.hearth = { essence: 0, owned: wards.filter(() => rnd(2) === 0) };
        counts.ward++;
      } else {
        w.household.utilitiesOn = !w.household.utilitiesOn;
        counts.utilities++;
      }
      expect(homeBonusOf(w), `edit ${i}`).toEqual(fresh(w));
      expect(homeBonusOf(w), `edit ${i}`).toEqual(pure(w));
    }
    // the sequence must exercise every operation, not just adds (P3 of the PR #105 review)
    for (const [name, c] of Object.entries(counts)) expect(c, name).toBeGreaterThan(60);
  });
});

describe('on the real simulation: build commands and undo at one tick, and a save clone', () => {
  const newSim = (): SimulationAPI => {
    const m = simModule;
    const h = randomHousehold(3 * 7919, buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES), 2);
    const s = m.createSimulation(m.createNewWorld({ seed: 3, householdName: h.householdName, members: h.members, lotTemplate: 'empty', difficulty: 'normal', homeBuild: true }));
    for (const id of Object.keys(s.state.objects)) if (!s.state.objects[id].defId.startsWith('item_')) delete s.state.objects[id];
    s.state.household.funds = 1e7;
    s.state.homeBuild!.freePlacement = true;
    return s;
  };
  const buy = (s: SimulationAPI, defId: string) => {
    for (let z = 1; z < s.state.lot.depth - 1; z++) for (let x = 1; x < s.state.lot.width - 1; x++) if (s.spatial.checkPlace(defId, x, z, 0).ok) return s.build.apply({ type: 'buy', defId, x, z, rot: 0 } as BuildCommand).ok;
    return false;
  };

  it('buy two Mausoleum pieces, then undo one: every read equals a fresh clone, with no tick in between', () => {
    const s = newSim();
    const t = s.state.tick;
    expect(homeBonusOf(s.state)).toEqual({});
    expect(buy(s, 'coffin_pine')).toBe(true);
    expect(buy(s, 'lamp_skull')).toBe(true);
    expect(s.state.tick).toBe(t);
    expect(homeBonusOf(s.state)).toEqual({ restRestorePct: 10 });
    expect(homeBonusOf(s.state)).toEqual(fresh(s.state));
    expect(s.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(s.state.tick).toBe(t);
    expect(homeBonusOf(s.state)).toEqual({});
    expect(homeBonusOf(s.state)).toEqual(fresh(s.state));
    expect(s.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(homeBonusOf(s.state)).toEqual({ restRestorePct: 10 });
  });

  it('a save clone of the world (validated JSON round trip) returns the same bonus as the live world, read first or last', () => {
    const s = newSim();
    buy(s, 'coffin_pine');
    buy(s, 'lamp_skull');
    const clone = (): WorldState => {
      const v = validateWorld(JSON.parse(JSON.stringify(s.state)));
      if (!v.ok) throw new Error(v.errors.join('; '));
      return v.world;
    };
    const first = homeBonusOf(clone());
    expect(homeBonusOf(s.state)).toEqual(first);
    expect(homeBonusOf(clone())).toEqual(homeBonusOf(s.state));
  });
});
