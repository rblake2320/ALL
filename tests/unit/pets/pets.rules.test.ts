/**
 * The owner's pet rules (docs/contract-requests/living-things.md, pets part) on the REAL simulation: species cap for NEW
 * adoptions (older saves keep theirs), the benefit by care tier, and the seeded, capped encounters (rival chase-off, hunt
 * chase, windfall), over many seeds, with NEGATIVE CONTROLS in both directions (an uncapped table makes the cap tests
 * fail; low care and wrong species never fire). Determinism (D-003): same seed, same script, same events.
 */
import { describe, expect, it, vi } from 'vitest';

// Each seed builds and steps a whole world; on slower worlds (the batch-1112 lead world) the multi-seed tests need room.
vi.setConfig({ testTimeout: 240_000 });
import type { Command } from '../../../src/sim/contracts';
import type { PetSpecies, PetState, PetsState, StrayState } from '../../../src/sim/types';
import { TICK_MINUTES } from '../../../src/sim/types';
import { MOOD } from '../../../src/sim/content/home/ids';
import { allSystems } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { PET_ADOPT_TRUST } from '../../../src/sim/systems/pets';
import { CHASE_OFF_MAX_TRUST, PET_ENCOUNTERS, SIGHT_RANGE, petBenefitWeight, petCare } from '../../../src/sim/systems/pets/encounters';
import { SLOT_TICKS } from '../../../src/sim/systems/pets/motion';
import { ambientWildlife } from '../../../src/sim/systems/wildlife';
import { PET_CAPS } from '../../../src/shared/livingThings';
import { validateWorld } from '../../../src/persistence/validation';
import { timeInfo } from '../../../src/sim/time';
import { jsonClone, newWorld, opts, simOf } from '../quests/helpers';

const world = (seed = 44): EngineSimulation => {
  const sys = allSystems();
  return simOf(newWorld(opts(seed, 2), sys), sys);
};
const pets = (sim: EngineSimulation): PetsState => sim.state.pets!;
const FAR = 1e9;

function addStray(sim: EngineSimulation, species: PetSpecies, x: number, z: number, name = 'Ash'): StrayState {
  const ps = pets(sim);
  const n = ps.nextId++;
  const s: StrayState = { id: `s${n}`, species, name: `${name}${n}`, trait: 'lazy', place: 'street', trust: 30, calmTick: 0, chaseCoolTick: 0, arrivedTick: sim.state.tick, pos: { x, z }, facing: 0, anim: 'idle', goal: null, slot: -1, busyUntil: FAR };
  ps.strays.push(s);
  return s;
}
function addPet(sim: EngineSimulation, species: PetSpecies, care: number, x: number, z: number): PetState {
  const ps = pets(sim);
  const n = ps.nextId++;
  const p: PetState = {
    id: `p${n}`,
    species,
    name: `Pet${n}`,
    trait: 'lazy',
    adoptedTick: sim.state.tick,
    needs: { appetite: care, fun: care, hygiene: care, affection: care },
    neglectMin: 0,
    guardUntil: 0,
    variant: 'normal',
    pos: { x, z },
    facing: 0,
    anim: 'idle',
    goal: null,
    slot: -1,
    busyUntil: FAR,
  };
  ps.pets.push(p);
  return p;
}
/** Keep the animals where they are and the pets looked after (their needs decay while the world steps). */
const hold = (sim: EngineSimulation, care?: number) => {
  for (const p of pets(sim).pets) {
    p.busyUntil = FAR;
    if (p.anim === 'run') p.anim = 'idle';
    if (care !== undefined) for (const k of ['appetite', 'fun', 'hygiene', 'affection'] as const) p.needs[k] = care;
  }
  for (const s of pets(sim).strays) if (s.leaveTick === undefined) s.busyUntil = FAR;
};
/** Step to the next 15-minute slot boundary (the encounter rolls happen on that tick). */
function stepToSlot(sim: EngineSimulation): void {
  do sim.step();
  while (sim.state.tick % SLOT_TICKS !== 0);
}
const stepMin = (sim: EngineSimulation, min: number) => {
  for (let i = 0, n = Math.round(min / TICK_MINUTES); i < n; i++) sim.step();
};
const titles = (sim: EngineSimulation) => sim.state.notifications.map((n) => n.title);
const chasedOff = (sim: EngineSimulation) => pets(sim).strays.filter((s) => s.leaveTick !== undefined).length + pets(sim).away.filter((a) => a.trust !== undefined).length;

/** Temporarily change table rows (restored by the returned function): the way a uncapped table is simulated. */
function patchRows(ids: string[], patch: { chance?: number; maxPerDay?: number }): () => void {
  const rows = PET_ENCOUNTERS.filter((r) => ids.includes(r.id)) as unknown as { id: string; chance: number; maxPerDay: number }[];
  const saved = rows.map((r) => ({ id: r.id, chance: r.chance, maxPerDay: r.maxPerDay }));
  for (const r of rows) Object.assign(r, patch);
  return () => {
    for (const s of saved) Object.assign(rows.find((r) => r.id === s.id)!, s);
  };
}

describe('caps hold for new adoptions, and old saves keep what they have', () => {
  const adopt = (sim: EngineSimulation, species: PetSpecies): boolean => {
    const stray = addStray(sim, species, 6, 6);
    stray.trust = PET_ADOPT_TRUST + 10;
    const agentId = sim.state.household.memberIds[0];
    sim.state.agents[agentId].pos = { ...stray.pos };
    return sim.dispatch({ type: 'pet', action: 'adopt', agentId, strayId: stray.id } as Command).ok;
  };

  it('3 pets in all and 2 of one species: the third dog and the fourth pet are refused with a reason', () => {
    const sim = world();
    pets(sim).strays.length = 0;
    expect(adopt(sim, 'dog')).toBe(true);
    expect(adopt(sim, 'dog')).toBe(true);
    const stray = addStray(sim, 'dog', 6, 6);
    stray.trust = 90;
    const agentId = sim.state.household.memberIds[0];
    sim.state.agents[agentId].pos = { ...stray.pos };
    const third = sim.dispatch({ type: 'pet', action: 'adopt', agentId, strayId: stray.id } as Command);
    expect(third.ok).toBe(false);
    expect(third.reason).toMatch(/2 dogs/);
    expect(pets(sim).pets).toHaveLength(2);
    expect(adopt(sim, 'cat')).toBe(true);
    expect(pets(sim).pets).toHaveLength(PET_CAPS.household);
    const fourth = addStray(sim, 'crow', 6, 6);
    fourth.trust = 90;
    const r = sim.dispatch({ type: 'pet', action: 'adopt', agentId, strayId: fourth.id } as Command);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/as many pets/);
    expect(pets(sim).pets).toHaveLength(3);
  });

  it('an older save with 5 pets (4 dogs) loads and keeps all of them, and simply cannot adopt another', () => {
    const sim = world(7);
    pets(sim).strays.length = 0;
    for (const sp of ['dog', 'dog', 'dog', 'dog', 'cat'] as PetSpecies[]) addPet(sim, sp, 80, 5, 5);
    const v = validateWorld(jsonClone(sim.state));
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.world.pets!.pets.map((p) => p.species)).toEqual(['dog', 'dog', 'dog', 'dog', 'cat']);
    const sys = allSystems();
    const loaded = simOf(v.world, sys);
    for (let i = 0; i < 400; i++) loaded.step();
    expect(pets(loaded).pets).toHaveLength(5);
    expect(adopt(loaded, 'raccoon')).toBe(false);
  });

  it('after a pet leaves, the household can adopt again (the cap counts the pets it has)', () => {
    const sim = world(9);
    pets(sim).strays.length = 0;
    for (let i = 0; i < 3; i++) expect(adopt(sim, (['dog', 'cat', 'crow'] as PetSpecies[])[i])).toBe(true);
    pets(sim).pets.pop();
    expect(adopt(sim, 'raccoon')).toBe(true);
  });
});

describe('the benefit follows the care tier', () => {
  const company = (sim: EngineSimulation) => {
    const m = sim.state.agents[sim.state.household.memberIds[0]].moodlets.map((x) => x.id);
    return m.includes(MOOD.petCompanyFull) ? 'full' : m.includes(MOOD.petCompanyHalf) ? 'half' : 'none';
  };
  const afterHour = (sim: EngineSimulation, care: number) => {
    hold(sim, care);
    stepMin(sim, 61);
    return company(sim);
  };

  it('full care gives Good Company, half care Some Company, and neglect nothing; both directions', () => {
    const sim = world(11);
    pets(sim).strays.length = 0;
    addPet(sim, 'cat', 90, 5, 5);
    expect(afterHour(sim, 90)).toBe('full');
    expect(afterHour(sim, 40)).toBe('half');
    expect(afterHour(sim, 10)).toBe('none');
    expect(afterHour(sim, 90)).toBe('full');
  });

  it('the weight is the sum of the tier weights, capped at 1: two half pets are as good as one full pet', () => {
    expect(petBenefitWeight([{ needs: { appetite: 40, fun: 40, hygiene: 40, affection: 40 } }])).toBe(0.5);
    expect(petBenefitWeight([{ needs: { appetite: 40, fun: 40, hygiene: 40, affection: 40 } }, { needs: { appetite: 30, fun: 30, hygiene: 30, affection: 30 } }])).toBe(1);
    expect(petBenefitWeight([{ needs: { appetite: 90, fun: 90, hygiene: 90, affection: 90 } }, { needs: { appetite: 90, fun: 90, hygiene: 90, affection: 90 } }])).toBe(1);
    expect(petBenefitWeight([])).toBe(0);
    expect(petCare({ needs: { appetite: 100, fun: 0, hygiene: 100, affection: 0 } })).toBe(50);
  });

  it('neglect never kills the pet or deletes it for good: it only withholds the benefit (and runs away, returning later, as before)', () => {
    const sim = world(13);
    pets(sim).strays.length = 0;
    const p = addPet(sim, 'dog', 5, 5, 5);
    p.busyUntil = 0;
    stepMin(sim, 60 * 30);
    expect(pets(sim).pets.length + pets(sim).away.length).toBe(1);
  });
});

describe('rival chase-off (a dog or cat sees a stray dog or cat)', () => {
  /** One slot with a pet and strays in sight; returns how many strays were chased off. */
  function scenario(seed: number, o: { pet?: PetSpecies; care?: number; strays?: PetSpecies[] } = {}) {
    const sim = world(seed);
    pets(sim).strays.length = 0;
    const pet = addPet(sim, o.pet ?? 'dog', o.care ?? 90, 5, 5);
    (o.strays ?? ['dog']).forEach((sp, i) => addStray(sim, sp, 6 + i * 0.3, 5));
    hold(sim, o.care ?? 90);
    stepToSlot(sim);
    return { sim, pet };
  }

  it('about 25 % of sightings over 120 seeds, and never more than the cap', () => {
    let fired = 0;
    const n = 120;
    for (let seed = 1; seed <= n; seed++) fired += chasedOff(scenario(seed).sim);
    expect(fired / n).toBeGreaterThan(0.14);
    expect(fired / n).toBeLessThan(0.38);
  });

  it('a chased-off stray runs, leaves the lot, and comes back after 2 to 4 days keeping its trust and place', () => {
    let seed = 1;
    let r = scenario(seed);
    while (chasedOff(r.sim) === 0 && seed < 80) r = scenario(++seed);
    expect(chasedOff(r.sim)).toBe(1);
    const sim = r.sim;
    const fleeing = pets(sim).strays.find((s) => s.leaveTick !== undefined)!;
    expect(fleeing.anim).toBe('flee');
    expect(['run', 'play']).toContain(r.pet.anim); // it runs at the stray and stops where it can
    expect(r.pet.busyUntil).toBeGreaterThan(sim.state.tick);
    expect(titles(sim).some((t) => /saw off/.test(t))).toBe(true);
    const id = fleeing.id;
    const trust = fleeing.trust;
    hold(sim, 90);
    stepMin(sim, 10);
    expect(pets(sim).strays.find((s) => s.id === id)).toBeUndefined();
    const away = pets(sim).away.find((a) => a.id === id)!;
    expect(away).toMatchObject({ trust, place: 'street' });
    const days = (away.returnTick - sim.state.tick) * TICK_MINUTES / (24 * 60);
    expect(days).toBeGreaterThan(1.9);
    expect(days).toBeLessThan(4.1);
    // it comes back, with its trust
    sim.state.tick = away.returnTick - 2;
    hold(sim, 90);
    stepMin(sim, 5);
    const back = pets(sim).strays.find((s) => s.name === away.name)!;
    expect(back).toBeDefined();
    expect(back.trust).toBe(trust);
  });

  it('a stray the household has befriended (trust >= 40) is never chased off, even with a near-certain roll; NEGATIVE CONTROL: at trust 39 it is', () => {
    const restore = patchRows(['rivalChase'], { chance: 0.999 });
    try {
      let friendly = 0;
      let wary = 0;
      for (let seed = 1; seed <= 30; seed++) {
        for (const trust of [95, CHASE_OFF_MAX_TRUST, CHASE_OFF_MAX_TRUST - 1]) {
          const sim = world(seed);
          pets(sim).strays.length = 0;
          addPet(sim, 'dog', 90, 5, 5);
          const s = addStray(sim, 'dog', 6, 5);
          s.trust = trust;
          hold(sim, 90);
          stepToSlot(sim);
          if (trust < CHASE_OFF_MAX_TRUST) wary += chasedOff(sim);
          else friendly += chasedOff(sim);
        }
      }
      expect(friendly).toBe(0);
      expect(wary).toBeGreaterThanOrEqual(25); // the control: a 99.9 % row does chase a wary stray
    } finally {
      restore();
    }
  });

  it('a cat and a dog meet the same rule; other species never act, and a crow stray is never chased off', () => {
    let cat = 0;
    let crowPet = 0;
    let crowStray = 0;
    for (let seed = 1; seed <= 60; seed++) {
      cat += chasedOff(scenario(seed, { pet: 'cat', strays: ['cat'] }).sim);
      crowPet += chasedOff(scenario(seed, { pet: 'crow', strays: ['dog'] }).sim);
      crowStray += chasedOff(scenario(seed, { pet: 'dog', strays: ['crow'] }).sim);
    }
    expect(cat).toBeGreaterThan(3);
    expect(crowPet).toBe(0);
    expect(crowStray).toBe(0);
  });

  it('NEGATIVE CONTROL: a pet whose care is low never chases anything off, over many seeds', () => {
    let fired = 0;
    for (let seed = 1; seed <= 100; seed++) fired += chasedOff(scenario(seed, { care: 20 }).sim);
    expect(fired).toBe(0);
  });

  it('a stray out of sight is not chased (beyond the sight range)', () => {
    let fired = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const sim = world(seed);
      pets(sim).strays.length = 0;
      addPet(sim, 'dog', 90, 5, 5);
      addStray(sim, 'dog', 5 + SIGHT_RANGE + 2, 5);
      hold(sim, 90);
      stepToSlot(sim);
      fired += chasedOff(sim);
    }
    expect(fired).toBe(0);
  });

  it('at most once per game day per pet, even with strays in sight at every slot of the day; the next day is a new chance', () => {
    const restore = patchRows(['rivalChase'], { chance: 0.99 });
    try {
      const sim = world(21);
      pets(sim).strays.length = 0;
      const pet = addPet(sim, 'dog', 90, 5, 5);
      for (let i = 0; i < 4; i++) addStray(sim, 'dog', 6 + i * 0.2, 5, 'S');
      const firedOnDay = new Map<number, number>();
      for (let slot = 0; slot < 96 * 3; slot++) {
        hold(sim, 90);
        // keep four strays standing in sight (new ones arrive when others leave)
        while (pets(sim).strays.filter((s) => s.leaveTick === undefined).length < 4) addStray(sim, 'dog', 6.5, 5, 'S');
        const before = chasedOffTotal(sim);
        stepToSlot(sim);
        const day = timeInfo(sim.state.tick).day;
        firedOnDay.set(day, (firedOnDay.get(day) ?? 0) + chasedOffTotal(sim) - before);
        expect(pet.enc!.n.rivalChase ?? 0).toBeLessThanOrEqual(1);
      }
      expect([...firedOnDay.values()].every((v) => v <= 1)).toBe(true);
      expect(firedOnDay.size).toBeGreaterThanOrEqual(3);
      expect([...firedOnDay.values()].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2);
    } finally {
      restore();
    }
  });

  it('NEGATIVE CONTROL: with an uncapped table the same scenario fires several times in a day, so the cap test above would fail', () => {
    const restore = patchRows(['rivalChase'], { chance: 0.99, maxPerDay: 99 });
    try {
      const sim = world(21);
      pets(sim).strays.length = 0;
      addPet(sim, 'dog', 90, 5, 5);
      for (let i = 0; i < 4; i++) addStray(sim, 'dog', 6 + i * 0.2, 5, 'S');
      hold(sim, 90);
      stepToSlot(sim);
      expect(chasedOffTotal(sim)).toBeGreaterThan(1);
    } finally {
      restore();
    }
  });
});

function chasedOffTotal(sim: EngineSimulation): number {
  return pets(sim).strays.filter((s) => s.leaveTick !== undefined).length + pets(sim).away.filter((a) => a.trust !== undefined).length;
}

describe('hunt chase (a cat after a songbird or pigeon, a dog after a squirrel): comic, always escapes, at most twice a day', () => {
  /** A slot boundary tick (in the first game day) where a critter of `species` is on the lot, with where it is. */
  function critterAt(seed: number, species: string[], fromTick: number): { tick: number; x: number; z: number } | null {
    const layout = { width: 30, depth: 30 };
    for (let t = fromTick; t < fromTick + 96 * SLOT_TICKS; t += SLOT_TICKS) {
      const c = ambientWildlife(seed, 'home', t, layout).find((k) => species.includes(k.species) && k.pos.y < 3 && k.pos.x > 1 && k.pos.x < 28 && k.pos.z > 1 && k.pos.z < 28);
      if (c) return { tick: t, x: c.pos.x, z: c.pos.z };
    }
    return null;
  }
  /** Run the day's slots; at each slot where a matching critter is on the lot, put the pet next to it. Returns the number of hunts. */
  function huntDay(seed: number, pet: PetSpecies, prey: string[], care = 90) {
    const sim = world(seed);
    pets(sim).strays.length = 0;
    const p = addPet(sim, pet, care, 5, 5);
    const day0 = Math.ceil((sim.state.tick + 1) / SLOT_TICKS) * SLOT_TICKS;
    let hunts = 0;
    const funBefore = [];
    for (let k = 0; k < 40; k++) {
      const tickAt = day0 + k * 2 * SLOT_TICKS;
      const c = critterAt(sim.state.seed, prey, tickAt);
      if (!c || timeInfo(c.tick).day !== timeInfo(day0).day) continue;
      sim.state.tick = c.tick - 1;
      hold(sim, care);
      p.pos = { x: c.x, z: c.z };
      p.needs.fun = 50;
      const before = titles(sim).filter((t) => /chased a/.test(t)).length;
      sim.step();
      const after = titles(sim).filter((t) => /chased a/.test(t)).length;
      if (after > before) {
        hunts += after - before;
        funBefore.push(p.needs.fun);
      }
    }
    return { sim, p, hunts, funBefore };
  }

  it('fires over several seeds, gives the pet some fun, never touches the critter, and stays at or below twice a day', () => {
    const restore = patchRows(['huntChaseCat', 'huntChaseDog'], { chance: 0.99 });
    try {
      let total = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const r = huntDay(seed, seed % 2 ? 'dog' : 'cat', seed % 2 ? ['squirrel'] : ['songbird', 'pigeon']);
        expect(r.hunts, `seed ${seed}`).toBeLessThanOrEqual(2);
        for (const f of r.funBefore) expect(f).toBeGreaterThan(50);
        total += r.hunts;
        const day = timeInfo(r.sim.state.tick).day;
        expect(r.p.enc ? (r.p.enc.day === day ? r.p.enc.n.huntChase ?? 0 : 0) : 0).toBeLessThanOrEqual(2);
      }
      expect(total).toBeGreaterThan(3);
    } finally {
      restore();
    }
  });

  it('NEGATIVE CONTROL: uncapped, the same day produces more than two hunts, so the cap test would fail', () => {
    const restore = patchRows(['huntChaseCat', 'huntChaseDog'], { chance: 0.99, maxPerDay: 99 });
    try {
      let most = 0;
      for (let seed = 1; seed <= 12; seed++) most = Math.max(most, huntDay(seed, seed % 2 ? 'dog' : 'cat', seed % 2 ? ['squirrel'] : ['songbird', 'pigeon']).hunts);
      expect(most).toBeGreaterThan(2);
    } finally {
      restore();
    }
  });

  it('a neglected pet does not hunt, and a cat never hunts a squirrel (nor a dog a songbird)', () => {
    const restore = patchRows(['huntChaseCat', 'huntChaseDog'], { chance: 0.99 });
    try {
      let low = 0;
      const species = { cat: new Set<string>(), dog: new Set<string>() };
      for (let seed = 1; seed <= 12; seed++) {
        low += huntDay(seed, 'cat', ['songbird', 'pigeon'], 15).hunts;
        for (const who of ['cat', 'dog'] as const) {
          const r = huntDay(seed, who, ['squirrel', 'songbird', 'pigeon']);
          for (const t of titles(r.sim)) {
            const m = /chased a (\w+)/.exec(t);
            if (m) species[who].add(m[1]);
          }
        }
      }
      expect(low).toBe(0);
      expect([...species.cat].every((x) => x === 'songbird' || x === 'pigeon')).toBe(true);
      expect([...species.dog].every((x) => x === 'squirrel')).toBe(true);
      expect(species.cat.size + species.dog.size).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('is comic: the chase notice says the critter was never in danger, and the wildlife is unchanged by it', () => {
    const restore = patchRows(['huntChaseCat', 'huntChaseDog'], { chance: 0.99 });
    try {
      for (let seed = 1; seed <= 12; seed++) {
        const r = huntDay(seed, 'dog', ['squirrel']);
        if (r.hunts === 0) continue;
        const note = r.sim.state.notifications.find((n) => /chased a/.test(n.title))!;
        expect(note.text).toMatch(/never in any danger and got away/);
        expect(note.text).not.toMatch(/(blood|kill|killed|dead|eat|ate|eaten|gore)/i);
        const critters = ambientWildlife(r.sim.state.seed, 'home', r.sim.state.tick, { width: 30, depth: 30 });
        expect(critters).toEqual(ambientWildlife(r.sim.state.seed, 'home', r.sim.state.tick, { width: 30, depth: 30 }));
        return;
      }
      throw new Error('no hunt happened in 12 seeds');
    } finally {
      restore();
    }
  });
});

describe('windfall (a well-cared pet occasionally brings a small find)', () => {
  function day(seed: number, care: number, chance?: number) {
    const restore = chance !== undefined ? patchRows(['windfall'], { chance }) : () => undefined;
    try {
      const sim = world(seed);
      pets(sim).strays.length = 0;
      addPet(sim, 'cat', care, 5, 5);
      const t0 = sim.state.tick;
      let fires = 0;
      let jump = 0;
      let slots = 0;
      while (slots < 96) {
        hold(sim, care);
        const f = sim.state.household.funds;
        stepToSlot(sim);
        if (timeInfo(sim.state.tick).day !== timeInfo(t0).day) break; // only the one game day counts
        slots++;
        if (sim.state.household.funds > f) {
          fires++;
          jump = sim.state.household.funds - f;
        }
      }
      return { fires, gained: jump, sim };
    } finally {
      restore();
    }
  }

  it('pays a few dollars at most once a day, only at full care', () => {
    let total = 0;
    const SEEDS = 5; // each seed is a whole simulated day; the outcome is per seed, so five give the same guarantee as ten here
    for (let seed = 1; seed <= SEEDS; seed++) {
      const full = day(seed, 90, 0.999);
      expect(full.fires, `seed ${seed}`).toBeLessThanOrEqual(1);
      total += full.fires;
      if (full.fires === 1) {
        expect(full.gained).toBeGreaterThanOrEqual(3);
        expect(full.gained).toBeLessThanOrEqual(12); // the find itself: $3 to $12
        expect(titles(full.sim).some((t) => /brought something home/.test(t))).toBe(true);
      }
      if (seed <= 2) {
        expect(day(seed, 40, 0.999).fires, `half care, seed ${seed}`).toBe(0);
        expect(day(seed, 10, 0.999).fires, `no care, seed ${seed}`).toBe(0);
      }
    }
    expect(total).toBeGreaterThanOrEqual(SEEDS - 1); // a 99.9 % row fires on nearly every seed
  });
});

describe('windfall cap, with its negative control', () => {
  function fires(seed: number, patch?: { maxPerDay?: number }): number {
    const restore = patchRows(['windfall'], { chance: 0.999, ...patch });
    try {
      const sim = world(seed);
      pets(sim).strays.length = 0;
      addPet(sim, 'cat', 90, 5, 5);
      const day0 = timeInfo(sim.state.tick).day;
      let n = 0;
      for (let slots = 0; slots < 90; slots++) {
        hold(sim, 90);
        stepToSlot(sim);
        if (timeInfo(sim.state.tick).day !== day0) break;
        // count the EVENTS (the notice per find): the earn id is also once-a-day, a second defence that would hide an uncapped row
        n = titles(sim).filter((t) => /brought something home/.test(t)).length;
      }
      return n;
    } finally {
      restore();
    }
  }
  it('once a day with the real table; the same 99.9 % row UNCAPPED fires over and over (so the cap test can fail)', () => {
    let capped = 0;
    let uncapped = 0;
    for (let seed = 1; seed <= 3; seed++) {
      capped = Math.max(capped, fires(seed));
      uncapped = Math.max(uncapped, fires(seed, { maxPerDay: 99 }));
    }
    expect(capped).toBeLessThanOrEqual(1);
    expect(uncapped).toBeGreaterThanOrEqual(5);
  });
});

describe('a malformed optional field never deletes an owned pet, stray or runaway (review #109 P2)', () => {
  type Raw = ReturnType<typeof jsonClone<EngineSimulation['state']>>;
  const clean = (): { raw: Raw; ids: { pet: string; stray: string; away: string } } => {
    const sim = world(9);
    pets(sim).strays.length = 0;
    const pet = addPet(sim, 'dog', 80, 5, 5);
    const stray = addStray(sim, 'cat', 20, 20);
    pets(sim).away.push({ id: 'p88', species: 'dog', name: 'Gone', trait: 'lazy', returnTick: sim.state.tick + 500, trust: 50, place: 'street' });
    return { raw: jsonClone(sim.state), ids: { pet: pet.id, stray: stray.id, away: 'p88' } };
  };
  const load = (raw: Raw) => {
    const v = validateWorld(raw);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return v;
  };

  it.each<[string, unknown]>([['null', null], ['a number', 5], ['an array', []], ['a string', 'x'], ['a bad object', { day: 'x', n: 7 }]])('a pet with enc = %s is kept (counter dropped or repaired)', (_n, bad) => {
    const { raw, ids } = clean();
    (raw.pets!.pets.find((p) => p.id === ids.pet) as { enc?: unknown }).enc = bad;
    const v = load(raw);
    expect(v.world.pets!.pets.find((p) => p.id === ids.pet), 'the pet survives').toBeDefined();
    expect(v.world.pets!.pets).toHaveLength(1);
    expect(v.world.pets!.strays).toHaveLength(1);
    expect(v.world.pets!.away).toHaveLength(1);
    expect(JSON.stringify(v.world)).not.toContain('undefined');
  });

  it.each<[string, Record<string, unknown>]>([
    ['trust = null', { trust: null }],
    ['trust = "x"', { trust: 'x' }],
    ['place = 7', { place: 7 }],
    ['place = "moon"', { place: 'moon' }],
    ['both broken', { trust: [], place: {} }],
  ])('a runaway with %s is kept', (_n, bad) => {
    const { raw, ids } = clean();
    Object.assign(raw.pets!.away.find((a) => a.id === ids.away)!, bad);
    const v = load(raw);
    expect(v.world.pets!.away.map((a) => a.id)).toEqual([ids.away]);
    expect(v.world.pets!.pets).toHaveLength(1);
  });

  it.each<[string, Record<string, unknown>]>([
    ['leaveTick = null', { leaveTick: null }],
    ['leaveTick = "soon"', { leaveTick: 'soon' }],
    ['leaveTick = -4', { leaveTick: -4 }],
    ['leaveDays = null', { leaveDays: null }],
    ['leaveDays = "x"', { leaveDays: 'x' }],
  ])('a stray with %s is kept', (_n, bad) => {
    const { raw, ids } = clean();
    Object.assign(raw.pets!.strays.find((s) => s.id === ids.stray)!, bad);
    const v = load(raw);
    expect(v.world.pets!.strays.map((s) => s.id)).toEqual([ids.stray]);
    expect(v.world.pets!.pets).toHaveLength(1);
  });

  it('the repaired world plays on and the pet is still there', () => {
    const { raw, ids } = clean();
    (raw.pets!.pets[0] as { enc?: unknown }).enc = 5;
    Object.assign(raw.pets!.away[0], { trust: 'x' });
    const v = load(raw);
    const loaded = simOf(v.world, allSystems());
    for (let i = 0; i < 400; i++) loaded.step();
    expect(pets(loaded).pets.map((p) => p.id)).toContain(ids.pet);
  });
});

describe('determinism (D-003) and saves', () => {
  const script = (seed: number) => {
    const sim = world(seed);
    pets(sim).strays.length = 0;
    addPet(sim, 'dog', 90, 5, 5);
    addPet(sim, 'cat', 90, 5.5, 5);
    for (const sp of ['dog', 'cat', 'dog'] as PetSpecies[]) addStray(sim, sp, 6.5, 5);
    const restore = patchRows(['rivalChase', 'windfall'], { chance: 0.6 });
    try {
      for (let slot = 0; slot < 96 * 2; slot++) {
        hold(sim, 90);
        for (const s of pets(sim).strays) if (s.leaveTick === undefined) s.busyUntil = FAR;
        stepToSlot(sim);
      }
    } finally {
      restore();
    }
    return sim;
  };

  it('the same seed and script give identical worlds, events and counters', () => {
    const a = script(5);
    const b = script(5);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(titles(a)).toEqual(titles(b));
    expect(titles(a).some((t) => /saw off|brought something/.test(t))).toBe(true);
    expect(JSON.stringify(script(6).state)).not.toBe(JSON.stringify(a.state));
  });

  it('a save with chase-off, counters and a runaway stray round-trips through the validator unchanged', () => {
    const a = script(5);
    expect(pets(a).pets.some((p) => p.enc)).toBe(true);
    const v = validateWorld(jsonClone(a.state));
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.issues.filter((i) => /pets/.test(i.path))).toEqual([]);
    expect(v.world.pets).toEqual(a.state.pets);
  });

  it('a save written before these rules (no counters, no leave fields, plain runaways) loads with no issue and plays on', () => {
    const sim = world(3);
    addPet(sim, 'dog', 90, 5, 5);
    const old = jsonClone(sim.state);
    for (const p of old.pets!.pets) delete (p as { enc?: unknown }).enc;
    old.pets!.away.push({ id: 'p77', species: 'cat', name: 'Old', trait: 'lazy', returnTick: old.tick + 50 });
    const v = validateWorld(old);
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.issues.filter((i) => /pets/.test(i.path))).toEqual([]);
    const sys = allSystems();
    const loaded = simOf(v.world, sys);
    for (let i = 0; i < 600; i++) loaded.step();
    expect(pets(loaded).strays.some((s) => s.name === 'Old')).toBe(true);
  });
});
