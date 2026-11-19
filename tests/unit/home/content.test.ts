/**
 * Content contract: every catalog spec has a gameplay def with the right bands, every id referenced by home content
 * is registered (engine validator), recipes match GDD §5, traits referenced exist, and ids don't collide.
 */
import { describe, expect, it } from 'vitest';
import { PHYSICAL_SPECS } from '../../../src/shared/catalog';
import { engineContent, loadContentFrom, validateContent } from '../../../src/sim/engine';
import { homeContent, HOME_INTERACTIONS, HOME_MOODLETS, HOME_OBJECTS, HOME_RECIPES, IX, MOOD } from '../../../src/sim/content/home';
import { OBJECTS_WITHOUT_EXTRAS } from '../../../src/sim/content/home/objects';
import { MOODLET as PEOPLE_MOODLETS } from '../../../src/sim/content/people/ids';
import { TRAITS } from '../../../src/sim/content/people/traits';
import { homeSystems } from '../../../src/sim/systems/home';
import { TEST_TRAITS } from './fakeCtx';

const byId = Object.fromEntries(HOME_OBJECTS.map((d) => [d.id, d]));
const ixById = Object.fromEntries(HOME_INTERACTIONS.map((d) => [d.id, d]));

describe('home object defs', () => {
  it('covers every physical spec exactly once, spreading the spec unchanged', () => {
    expect(OBJECTS_WITHOUT_EXTRAS).toEqual([]);
    expect(HOME_OBJECTS.length).toBe(PHYSICAL_SPECS.length);
    for (const spec of PHYSICAL_SPECS) {
      const d = byId[spec.id];
      expect(d, spec.id).toBeTruthy();
      expect(d.footprint).toEqual(spec.footprint);
      expect(d.slots).toEqual(spec.slots);
      expect(d.tags).toEqual(spec.tags);
      expect(d.price).toBe(spec.price);
    }
  });

  it('gives every object at least one interaction that exists', () => {
    for (const d of HOME_OBJECTS) {
      expect(d.interactions.length, d.id).toBeGreaterThan(0);
      for (const ix of d.interactions) expect(ixById[ix], `${d.id} -> ${ix}`).toBeTruthy();
    }
  });

  it('uses the environment bands from the brief', () => {
    const items: Record<string, number> = {
      item_dish: -1,
      item_ash: -3,
      item_fire: -5,
      item_limb_arm: -2,
      item_limb_leg: -2,
      item_bonepile: -3,
      item_urn: 3,
      item_painting: 3,
    };
    for (const [id, env] of Object.entries(items)) expect(byId[id].env, id).toBe(env);
    expect(byId.painting_greatgrand.env).toBe(4);
    expect(byId.sofa_velvet.env).toBe(5);
    expect(byId.sarcophagus_cryo.env).toBe(6);
    for (const d of HOME_OBJECTS) {
      expect(d.env, d.id).toBeGreaterThanOrEqual(-5);
      expect(d.env, d.id).toBeLessThanOrEqual(10);
      if (d.tags.includes('rug')) expect(d.env).toBeGreaterThanOrEqual(2);
      if (d.tags.includes('rug')) expect(d.env).toBeLessThanOrEqual(4);
      if (d.tags.includes('fancy') && d.category !== 'item') {
        expect(d.env, d.id).toBeGreaterThanOrEqual(4);
        expect(d.env, d.id).toBeLessThanOrEqual(6);
      }
      if (d.price > 0 && d.price <= 100 && !d.tags.includes('rug') && !d.tags.includes('light')) expect(d.env, d.id).toBeLessThanOrEqual(1);
    }
  });

  it('depreciates 0.15 (doors/windows 0.1), sells everything but items', () => {
    for (const d of HOME_OBJECTS) {
      const opening = d.placement === 'door' || d.placement === 'window';
      expect(d.depreciation, d.id).toBe(opening ? 0.1 : 0.15);
      expect(d.sellable, d.id).toBe(d.category !== 'item');
    }
  });

  it('only appliances can break; fancy appliances break at most half as often', () => {
    for (const d of HOME_OBJECTS) {
      const appliance = d.tags.includes('appliance') || d.tags.includes('electronic') || (!!d.needsPower && !d.tags.includes('light') && !d.tags.includes('flyZapper'));
      if (!appliance) expect(d.breakChance, d.id).toBe(0);
      else {
        expect(d.breakChance, d.id).toBeGreaterThan(0);
        expect(d.breakChance, d.id).toBeLessThanOrEqual(d.tags.includes('fancy') ? 0.015 : 0.03);
      }
    }
    expect(byId.fridge_cryo.breakChance).toBe(byId.fridge_humming.breakChance / 2);
    expect(byId.stove_necrochef.breakChance).toBe(byId.stove_greasefire.breakChance / 2);
  });

  it('carries the bed / tv / stove / fridge params the systems read', () => {
    expect(byId.coffin_pine.params).toMatchObject({ energyPerHour: 12, preservationPerHour: 0, sleepDecayMult: 0 });
    expect(byId.coffin_chillrest.params).toMatchObject({ energyPerHour: 12, preservationPerHour: 4, sleepDecayMult: 0 });
    expect(byId.sarcophagus_cryo.params).toMatchObject({ energyPerHour: 13, preservationPerHour: 5, vitalityPerSleep: 2 });
    expect(byId.bed_normal.params).toMatchObject({ energyPerHour: 9, sleepDecayMult: 0.5 });
    expect(byId.plot_budget.params).toMatchObject({ energyPerHour: 10, hygienePerHour: -3, preservationPerHour: 1 });
    for (const bed of HOME_OBJECTS.filter((d) => d.tags.includes('bed'))) {
      // the sleep stage scales energy/hygiene by these — a missing key would mean ×1
      expect(typeof bed.params.energyPerHour, bed.id).toBe('number');
      expect(typeof bed.params.hygienePerHour, bed.id).toBe('number');
    }
    expect(byId.tv_crt.params.tvFun).toBe(1.0);
    expect(byId.tv_seance.params.tvFun).toBe(1.3);
    expect(byId.stove_greasefire.params).toMatchObject({ fireMult: 1.25, qualityBonus: 0 });
    expect(byId.stove_necrochef.params).toMatchObject({ fireMult: 0.5, qualityBonus: 1 });
    expect(byId.fridge_humming.params.spoilMult).toBe(1);
    expect(byId.fridge_cryo.params.spoilMult).toBe(0.5);
  });
});

describe('home interactions', () => {
  const registry = loadContentFrom([engineContent, homeContent, TEST_TRAITS]);

  it('pass the engine content validator with the home systems registered', () => {
    expect(validateContent(registry, homeSystems)).toEqual([]);
  });

  it('are all home_-prefixed, unique and reachable from an object, an agent menu or a system', () => {
    const ids = HOME_INTERACTIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const fromObjects = new Set(HOME_OBJECTS.flatMap((d) => d.interactions));
    for (const d of HOME_INTERACTIONS) {
      expect(d.id.startsWith('home_')).toBe(true);
      const reachable = fromObjects.has(d.id) || d.targetKind === 'agent' || d.hidden;
      expect(reachable, d.id).toBe(true);
    }
    expect(Object.values(IX).sort()).toEqual(ids.slice().sort());
  });

  it('only reference real trait ids in traitAd', () => {
    const traits = new Set(TRAITS.map((t) => t.id));
    for (const d of HOME_INTERACTIONS) for (const t of Object.keys(d.traitAd ?? {})) expect(traits.has(t), `${d.id}: ${t}`).toBe(true);
  });

  it('let visitors use the social-safe ones', () => {
    for (const id of [IX.sit, IX.watchTv, IX.playChess, IX.dance, IX.haveServing, IX.admirePortrait, IX.admirePainting, IX.admireRug, IX.listenMusic]) {
      expect(ixById[id].visitorAllowed, id).toBe(true);
    }
    for (const id of [IX.cook, IX.sleep, IX.selfEmbalm, IX.payBills, IX.sellPainting]) expect(ixById[id].visitorAllowed ?? false, id).toBe(false);
  });

  it('give open-ended stages a stopWhen or a behaviour that ends them', () => {
    for (const d of HOME_INTERACTIONS) {
      for (const st of registry.stagesOf(d.id)) {
        if (st.duration >= 1e8) expect(!!st.stopWhen || !!d.hidden, d.id).toBe(true);
      }
    }
  });

  it('wire the required flows from the brief', () => {
    expect(registry.stagesOf(IX.cook).map((s) => s.target)).toEqual([{ kind: 'target', slots: ['front'] }, { kind: 'nearestTag', tag: 'stove', slots: ['front'] }]);
    expect(registry.stagesOf(IX.cookAtStove)[0].target).toEqual({ kind: 'nearestTag', tag: 'fridge', slots: ['front'] });
    expect(ixById[IX.grabJerky].cost).toBe(5);
    expect(ixById[IX.grabSpray].cost).toBe(15);
    expect(ixById[IX.selfEmbalm].cost).toBe(30); // balance pass (was $40, GDD §4)
    expect(ixById[IX.embalmOther].pair).toEqual({ partnerInteraction: IX.beEmbalmed, partnerTarget: 'sameObject' });
    expect(registry.stagesOf(IX.embalmOther)[0].target).toEqual({ kind: 'nearestTag', tag: 'embalm', slots: ['work'] });
    expect(registry.stagesOf(IX.beEmbalmed)[0].target).toEqual({ kind: 'target', slots: ['lie'] });
    expect(registry.stagesOf(IX.shower)[0].stopWhen).toEqual({ need: 'hygiene', atLeast: 98 });
    expect(registry.stagesOf(IX.sleep)[0].stopWhen).toEqual({ need: 'energy', atLeast: 98 });
    expect(ixById[IX.sleep].tags).toContain('sleep');
    expect(registry.stagesOf(IX.nap)[0]).toMatchObject({ duration: 60, needsPerHour: { energy: 6 } });
    expect(registry.stagesOf(IX.watchTv)[0]).toMatchObject({ target: { kind: 'seat', facingTarget: true, radius: 6 }, fallback: { kind: 'target', slots: ['watch'] } });
    expect(ixById[IX.watchTv].joinable).toBe(true);
    expect(registry.stagesOf(IX.dance)[0]).toMatchObject({ target: { kind: 'tileNear', radius: 3 }, needsPerHour: { fun: 18 }, skillXpPerHour: { fitness: 20 } });
    expect(ixById[IX.dance].tags).toContain('strenuous');
    expect(ixById[IX.workout].tags).toContain('strenuous');
    expect(registry.stagesOf(IX.workout)[0].skillXpPerHour).toEqual({ fitness: 45 });
    expect(registry.stagesOf(IX.practiceSpeech)[0].skillXpPerHour).toEqual({ charisma: 30 });
    expect(ixById[IX.program].params).toMatchObject({ xpSkill: 'logic', xpPerHour: 30 });
    expect(ixById[IX.playChess].params).toMatchObject({ xpSkill: 'logic', xpPerHour: 30 });
    expect(ixById[IX.paint].params).toMatchObject({ xpSkill: 'creativity', xpPerHour: 40 });
    expect(registry.stagesOf(IX.read).map((s) => s.target.kind)).toEqual(['target', 'seat']);
    expect(registry.stagesOf(IX.haveServing)[1]).toMatchObject({ target: { kind: 'seat', preferTable: true, radius: 8 }, fallback: { kind: 'here' } });
    expect(registry.stagesOf(IX.cleanDish)[1]).toMatchObject({ target: { kind: 'nearestTag', tag: 'sink' }, fallback: { kind: 'nearestTag', tag: 'trash' } });
    const ice = registry.stagesOf(IX.iceBath)[0];
    expect((ice.needsPerHour!.preservation! * ice.duration) / 60).toBeCloseTo(22, 5);
    expect((ice.needsPerHour!.hygiene! * ice.duration) / 60).toBeCloseTo(60, 5);
    expect((ice.needsPerHour!.fun! * ice.duration) / 60).toBeCloseTo(-10, 5);
  });
});

describe('recipes (GDD §5)', () => {
  it('match the table', () => {
    const r = Object.fromEntries(HOME_RECIPES.map((x) => [x.id, x]));
    expect(r.brainLoaf).toMatchObject({ cost: 12, minCooking: 0, servings: 4, baseQuality: 2, hunger: 45, cookMinutes: 30 });
    expect(r.brainJerky).toMatchObject({ cost: 5, minCooking: 0, servings: 1, baseQuality: 1, hunger: 20 });
    expect(r.cerebellumStew).toMatchObject({ cost: 20, minCooking: 2, servings: 4, baseQuality: 3, hunger: 55, cookMinutes: 45 });
    expect(r.frontalLasagna).toMatchObject({ cost: 30, minCooking: 4, servings: 6, baseQuality: 4, hunger: 60, cookMinutes: 60 });
    expect(r.medullaFlambe).toMatchObject({ cost: 45, minCooking: 7, servings: 4, baseQuality: 5, hunger: 70, cookMinutes: 75, requiresTag: 'cryoFridge' });
    expect(r.brainBurrito).toMatchObject({ cost: 8, servings: 1, baseQuality: 2, hunger: 40, cookMinutes: 6 });
    expect(r.brainPizza).toMatchObject({ cost: 35, servings: 6, baseQuality: 3, hunger: 50 });
  });
});

describe('moodlets', () => {
  it('cover the brief, have witty text and never collide with engine/people ids', () => {
    const ids = HOME_MOODLETS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.values(MOOD).sort()).toEqual(ids.slice().sort());
    for (const required of [
      'lostLimb', 'grossedOut', 'hilariousLimb', 'butterfingers', 'fallingApart', 'mourning', 'backFromDead', 'deliciousMeal',
      'questionableMeal', 'ateStandingUp', 'familyDinner', 'foodPoisoning', 'tooFluffy', 'freshAsADaisy', 'reeking', 'stenchNearby',
      'disgustedByMess', 'panicking', 'powerOut', 'billsOverdue', 'finalNotice', 'repossessed', 'embalmed', 'wellRested',
      'sleptInDirt', 'coldSoak', 'artisticTriumph', 'paintingSold',
    ]) {
      expect(ids, required).toContain(required);
    }
    const people = new Set<string>(Object.values(PEOPLE_MOODLETS));
    const engine = new Set((engineContent.moodlets ?? []).map((m) => m.id));
    for (const m of HOME_MOODLETS) {
      expect(people.has(m.id), m.id).toBe(false);
      expect(engine.has(m.id), m.id).toBe(false);
      expect(m.label.length).toBeGreaterThan(2);
      expect(m.description.length).toBeGreaterThan(20);
      expect(m.kind === 'good' ? m.mood > 0 : m.kind === 'bad' ? m.mood < 0 : true, m.id).toBe(true);
    }
    const md = Object.fromEntries(HOME_MOODLETS.map((m) => [m.id, m]));
    expect(md.lostLimb).toMatchObject({ mood: -15, durationMin: 720 });
    expect(md.grossedOut.mood).toBe(-5);
    expect(md.hilariousLimb.mood).toBe(5);
    expect(md.fallingApart.mood).toBe(-30);
    expect(md.mourning).toMatchObject({ mood: -20, durationMin: 2880 });
    expect(md.backFromDead).toMatchObject({ mood: 15, durationMin: 1440 });
    expect(md.deliciousMeal).toMatchObject({ mood: 10, durationMin: 240 });
    expect(md.questionableMeal.mood).toBe(-5);
    expect(md.ateStandingUp.mood).toBe(-3);
    expect(md.familyDinner.mood).toBe(8);
    expect(md.foodPoisoning).toMatchObject({ mood: -20, durationMin: 360 });
    expect(md.stenchNearby.mood).toBe(-10);
    expect(md.panicking.mood).toBe(-15);
  });
});
