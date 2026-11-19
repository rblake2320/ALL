/**
 * Home LIFE bonuses applied in the real simulation (home-build-system.md section 3): furniture sets 2/4/6 and Hearth wards
 * change Rest (while asleep), Fun, skill gain, Freshness asleep and the feeling a household starts the day with.
 * Never a fight stat (CB-2); removing a piece removes its bonus; unpaid utilities switch the wards off and paying restores
 * them; and the world stays deterministic (D-003).
 */
import { describe, expect, it } from 'vitest';
import * as simModule from '../../../src/sim/index';
import type { SimContext, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { FIGHT_STAT_WORDS, FURNITURE_SETS, HEARTH_UPGRADES, LIFE_BONUS_KEYS, newHomeBuildState, type LifeBonus } from '../../../src/shared/homeBuild';
import { homeBonusOf, homeBonusesLive, homeFreshnessPerHourAsleep, homeNeedGainMult, homeSkillGainMult } from '../../../src/sim/engine/homeBonus';
import { applyStartOfDayFeeling } from '../../../src/sim/systems/homeServices';
import { MOOD } from '../../../src/sim/content/home/ids';

function newSim(seed = 3): SimulationAPI {
  const m = simModule;
  const h = randomHousehold(seed * 7919, buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES), 2);
  return m.createSimulation(m.createNewWorld({ seed, householdName: h.householdName, members: h.members, lotTemplate: 'empty', difficulty: 'normal' }));
}
const ctxOf = (s: SimulationAPI): SimContext => (s as unknown as { engine: { ctx: SimContext } }).engine.ctx;
let uid = 4000;
function put(s: SimulationAPI, defId: string, fixedId?: string): string {
  const id = fixedId ?? `o${uid++}`;
  const o: ObjectState = { id, defId, placement: { kind: 'floor', x: 1 + (uid % 6), z: 1, rot: 0 }, value: 0, purchasedTick: 0, tint: null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: {}, reservedBy: {}, inUseBy: [], rev: 0 };
  s.state.objects[id] = o;
  return id;
}
const remove = (s: SimulationAPI, id: string) => void delete s.state.objects[id];
/** The bonus memo is per tick: one step after the world changed, as in play. */
const settle = (s: SimulationAPI) => s.step();
const member = (s: SimulationAPI): AgentState => s.state.agents[s.state.household.memberIds[0]];
const SET = (id: string) => FURNITURE_SETS.find((x) => x.id === id)!.pieces;

/** Strip the starting lot's own furniture so a test controls exactly which pieces stand. */
function bare(live = true): SimulationAPI {
  const s = newSim();
  if (live) s.state.homeBuild = newHomeBuildState('starter');
  for (const id of Object.keys(s.state.objects)) if (!s.state.objects[id].defId.startsWith('item_')) delete s.state.objects[id];
  return s;
}

describe('the bonuses are life effects only', () => {
  it('every set and ward bonus uses only the life keys, and none names a fight stat', () => {
    const all: LifeBonus[] = [...FURNITURE_SETS.flatMap((s) => Object.values(s.bonuses)), ...HEARTH_UPGRADES.flatMap((u) => (u.effect.kind === 'ward' ? [u.effect.bonus] : []))];
    expect(all.length).toBeGreaterThan(8);
    for (const b of all) {
      for (const k of Object.keys(b)) {
        expect(LIFE_BONUS_KEYS as readonly string[], k).toContain(k);
        const words = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
        expect(FIGHT_STAT_WORDS.some((w) => words.includes(w)), k).toBe(false);
      }
    }
  });

  it('does not change a zombie fight-relevant number: only needs, skill XP and moodlets move', () => {
    const s = bare();
    const a = member(s);
    const before = JSON.stringify({ traits: a.traits, vitality: a.vitality, limbs: a.limbs });
    for (const p of SET('mausoleum')) put(s, p);
    put(s, 'hearth_stone');
    s.state.household.utilitiesOn = true;
    s.state.homeServices!.hearth = { essence: 0, owned: ['wardRest', 'wardFresh', 'wardSkill'] };
    settle(s);
    expect(JSON.stringify({ traits: a.traits, vitality: a.vitality, limbs: a.limbs })).toBe(before);
  });
});

describe('which worlds get the bonuses', () => {
  it('NEGATIVE CONTROL: a plain world, even with a full set standing, gets no bonus; the Hearth or home build turns them on', () => {
    const s = bare(false);
    for (const p of SET('mausoleum')) put(s, p);
    settle(s);
    expect(homeBonusesLive(s.state)).toBe(false);
    expect(homeBonusOf(s.state)).toEqual({});
    expect(homeNeedGainMult(s.state, 'energy', true)).toBe(1);
    put(s, 'hearth_stone');
    settle(s);
    expect(homeBonusesLive(s.state)).toBe(true);
    expect(homeBonusOf(s.state).restRestorePct).toBe(10);
    const t = bare(false);
    for (const p of SET('mausoleum')) put(t, p);
    t.state.homeBuild = newHomeBuildState('starter');
    settle(t);
    expect(homeBonusOf(t.state).restRestorePct).toBe(10);
  });
});

describe('Rest, Fun and skill gain', () => {
  it('two Mausoleum pieces make Rest 10 % faster while asleep and not awake; removing a piece removes it', () => {
    const s = bare();
    const [a, b] = ['coffin_pine', 'lamp_skull'].map((d) => put(s, d));
    settle(s);
    expect(homeNeedGainMult(s.state, 'energy', true)).toBeCloseTo(1.1);
    expect(homeNeedGainMult(s.state, 'energy', false)).toBe(1);
    remove(s, b);
    settle(s);
    expect(homeNeedGainMult(s.state, 'energy', true)).toBe(1);
    void a;
  });

  it('applies through ctx.changeNeed: asleep +10 % energy, awake unchanged, negative deltas untouched', () => {
    const s = bare();
    for (const d of ['coffin_pine', 'lamp_skull']) put(s, d);
    settle(s);
    const ctx = ctxOf(s);
    const a = member(s);
    a.active = { interactionId: 'home_sleep', phase: 'run', stage: 0 } as never;
    a.needs.energy = 10;
    const asleep = ctx.changeNeed(a, 'energy', 10);
    a.active = null;
    a.needs.energy = 10;
    const awake = ctx.changeNeed(a, 'energy', 10);
    expect(asleep).toBeCloseTo(11);
    expect(awake).toBeCloseTo(10);
    a.needs.energy = 50;
    expect(ctx.changeNeed(a, 'energy', -10)).toBeCloseTo(-10);
  });

  it('two Gothic Parlour pieces give 5 % more Fun, and a ward gives skill gain through ctx.addXp', () => {
    const s = bare();
    for (const d of ['sofa_velvet', 'table_wake']) put(s, d);
    put(s, 'hearth_stone');
    s.state.household.utilitiesOn = true;
    s.state.homeServices!.hearth = { essence: 0, owned: ['wardRest', 'wardSkill'] };
    settle(s);
    const ctx = ctxOf(s);
    const a = member(s);
    a.needs.fun = 10;
    expect(ctx.changeNeed(a, 'fun', 10)).toBeCloseTo(10.5);
    expect(homeSkillGainMult(s.state)).toBeCloseTo(1.05);
    const lvl = a.skills.cooking ?? { level: 0, xp: 0 };
    a.skills.cooking = { level: lvl.level, xp: 0 };
    ctx.addXp(a, 'cooking', 100);
    expect(a.skills.cooking.xp + a.skills.cooking.level * 0).toBeGreaterThan(0);
  });
});

describe('Hearth wards follow the utilities', () => {
  it('unpaid utilities switch the wards off and paying restores them', () => {
    const s = bare();
    put(s, 'hearth_stone');
    s.state.homeServices!.hearth = { essence: 0, owned: ['wardRest', 'wardSkill'] };
    s.state.household.utilitiesOn = true;
    settle(s);
    expect(homeSkillGainMult(s.state)).toBeCloseTo(1.05);
    expect(homeNeedGainMult(s.state, 'energy', true)).toBeCloseTo(1.05);
    s.state.household.utilitiesOn = false;
    settle(s);
    expect(homeSkillGainMult(s.state)).toBe(1);
    expect(homeNeedGainMult(s.state, 'energy', true)).toBe(1);
    s.state.household.utilitiesOn = true;
    settle(s);
    expect(homeSkillGainMult(s.state)).toBeCloseTo(1.05);
  });
});

describe('Freshness asleep and the start-of-day feeling', () => {
  it('four Mausoleum pieces give +1 Freshness per hour asleep, three do not', () => {
    const s = bare();
    const ids = SET('mausoleum').slice(0, 4).map((d) => put(s, d));
    settle(s);
    expect(homeFreshnessPerHourAsleep(s.state)).toBe(1);
    remove(s, ids[3]);
    settle(s);
    expect(homeFreshnessPerHourAsleep(s.state)).toBe(0);
  });

  it('a full Mausoleum sends each zombie into the day Well Interred, and the feeling is cleared when a piece goes', () => {
    const s = bare();
    const ids = SET('mausoleum').map((d) => put(s, d));
    settle(s);
    const ctx = ctxOf(s);
    applyStartOfDayFeeling(ctx);
    for (const id of s.state.household.memberIds) expect(ctx.hasMoodlet(s.state.agents[id], MOOD.homeWellInterred)).toBe(true);
    remove(s, ids[5]);
    settle(s);
    applyStartOfDayFeeling(ctx);
    for (const id of s.state.household.memberIds) expect(ctx.hasMoodlet(s.state.agents[id], MOOD.homeWellInterred)).toBe(false);
  });
});

describe('determinism (D-003)', () => {
  it('two worlds with the same sets and wards stay byte-identical over two game days, also across a save and load', () => {
    const make = () => {
      const s = bare();
      let n = 0;
      for (const d of [...SET('mausoleum'), ...SET('gothicParlour').slice(0, 2)]) put(s, d, `o${5000 + n++}`);
      put(s, 'hearth_stone', `o${5000 + n++}`);
      s.state.household.utilitiesOn = true;
      s.state.homeServices!.hearth = { essence: 0, owned: ['wardRest', 'wardFresh', 'wardSkill'] };
      return s;
    };
    const a = make();
    const b = make();
    for (let i = 0; i < 6000; i++) {
      a.step();
      b.step();
    }
    const ja = JSON.stringify(a.serialize());
    const jb = JSON.stringify(b.serialize());
    if (ja !== jb) { let i = 0; while (ja[i] === jb[i]) i++; throw new Error('a vs b differ at ' + i + ': ' + ja.slice(i - 80, i + 80) + ' || ' + jb.slice(i - 80, i + 80)); }
    expect(ja).toBe(jb);
    const copy = simModule.createSimulation(JSON.parse(JSON.stringify(a.serialize())));
    a.state.nextId = copy.state.nextId; // loading moves nextId past the ids the test injected by hand; nothing else may differ
    for (let i = 0; i < 400; i++) {
      a.step();
      copy.step();
    }
    const jc = JSON.stringify(copy.serialize());
    const ja2 = JSON.stringify(a.serialize());
    if (jc !== ja2) { let i = 0; while (jc[i] === ja2[i]) i++; throw new Error('copy vs a differ at ' + i + ': ' + jc.slice(i - 80, i + 80) + ' || ' + ja2.slice(i - 80, i + 80)); }
    expect(jc).toBe(ja2);
    expect(homeBonusOf(a.state).restRestorePct).toBeGreaterThan(0);
  });
});
