/**
 * decay system: preservation model (GDD §4), vitality, limbs & witnesses, crumbling → urn → game over, reanimation,
 * sleep / embalming / stitching / prosthetic behaviours, DecayApi.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IX, MOOD } from '../../../src/sim/content/home/ids';
import { preservationDecayPerHour, preservationPerHour, decayLevel } from '../../../src/sim/systems/home/decay/rates';
import { limbLossChance, loseLimb, stitchChance } from '../../../src/sim/systems/home/decay/limbs';
import { crumble, reanimate } from '../../../src/sim/systems/home/decay/death';
import { freshnessReport } from '../../../src/sim/systems/home/decay/behaviors';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { tickAt } from '../../../src/sim/time';
import { homeSystems } from '../../../src/sim/systems/home';
import { FakeSim, kitchenLot } from './fakeCtx';

const NOON_DAY2 = tickAt(2, 12 * 60);
const MIDNIGHT_DAY2 = tickAt(2, 23 * 60);

function lot(extra: { defId: string; x: number; z: number }[] = []) {
  return [...kitchenLot(), ...extra];
}

describe('preservation rate', () => {
  let sim: FakeSim;
  beforeEach(() => {
    sim = new FakeSim({ objects: lot(), tick: NOON_DAY2 });
  });

  it('is 1.3/h awake indoors on normal difficulty', () => {
    expect(preservationDecayPerHour(sim.ctx, sim.member())).toBeCloseTo(1.3, 6);
  });

  it('adds +0.6 for hygiene < 20 and +1.0 for hunger < 10', () => {
    const a = sim.member();
    a.needs.hygiene = 10;
    expect(preservationDecayPerHour(sim.ctx, a)).toBeCloseTo(1.9, 6);
    a.needs.hunger = 5;
    expect(preservationDecayPerHour(sim.ctx, a)).toBeCloseTo(2.9, 6);
  });

  it('is ×1.2 outdoors in daytime but not at night', () => {
    const a = sim.member();
    a.pos = { x: 25.5, z: 25.5 };
    expect(preservationDecayPerHour(sim.ctx, a)).toBeCloseTo(1.56, 6);
    sim.setTick(MIDNIGHT_DAY2);
    expect(preservationDecayPerHour(sim.ctx, a)).toBeCloseTo(1.3, 6);
  });

  it('follows the difficulty preset (relaxed 0.6, grim 1.4) and Well Preserved 0.7', () => {
    sim.state.settings.difficulty = 'relaxed';
    expect(preservationDecayPerHour(sim.ctx, sim.member())).toBeCloseTo(0.78, 6);
    sim.state.settings.difficulty = 'grim';
    expect(preservationDecayPerHour(sim.ctx, sim.member())).toBeCloseTo(1.82, 6);
    sim.state.settings.difficulty = 'normal';
    sim.member().rewardTraits.push('wellPreserved');
    expect(preservationDecayPerHour(sim.ctx, sim.member())).toBeCloseTo(0.91, 6);
  });

  it('halts in a coffin, halves in a human bed, and refrigerated coffins restore only with power', () => {
    const s2 = new FakeSim({ objects: [{ defId: 'coffin_pine', x: 2, z: 2 }, { defId: 'bed_normal', x: 6, z: 2 }, { defId: 'coffin_chillrest', x: 10, z: 2 }], tick: MIDNIGHT_DAY2 });
    const a = s2.member();
    a.needs.energy = 20;
    s2.start(a, IX.sleep, { kind: 'object', id: s2.obj('coffin_pine').id });
    expect(preservationDecayPerHour(s2.ctx, a)).toBe(0);
    s2.cancel(a);
    s2.start(a, IX.sleep, { kind: 'object', id: s2.obj('bed_normal').id });
    expect(preservationDecayPerHour(s2.ctx, a)).toBeCloseTo(0.65, 6);
    s2.cancel(a);
    s2.start(a, IX.sleep, { kind: 'object', id: s2.obj('coffin_chillrest').id });
    expect(preservationDecayPerHour(s2.ctx, a)).toBe(0);
    expect(preservationPerHour(s2.ctx, a)).toBeCloseTo(4, 6);
    s2.state.household.utilitiesOn = false;
    expect(preservationPerHour(s2.ctx, a)).toBe(0);
  });

  it('is ×1.5 while doing something strenuous', () => {
    const s2 = new FakeSim({ objects: [{ defId: 'gym_limb', x: 2, z: 2 }], tick: NOON_DAY2 });
    const a = s2.member();
    expect(s2.start(a, IX.workout, { kind: 'object', id: s2.obj('gym_limb').id })).toBeNull();
    expect(preservationDecayPerHour(s2.ctx, a)).toBeCloseTo(1.95, 6);
  });

  it('decays over real ticks, never below 0, never above vitality', () => {
    const a = sim.member();
    a.needs.preservation = 50;
    sim.advance(60);
    expect(a.needs.preservation).toBeCloseTo(48.7, 4);
    a.vitality = 40;
    sim.advance(1);
    expect(a.needs.preservation).toBeLessThanOrEqual(40);
    a.needs.preservation = 0.2;
    sim.advance(60);
    expect(a.needs.preservation).toBe(0);
  });

  it('keeps decaying at work (base rate) but skips off-lot townies and service NPCs', () => {
    const a = sim.member();
    a.presence = 'atWork';
    a.needs.preservation = 60;
    sim.advance(60);
    expect(a.needs.preservation).toBeCloseTo(58.7, 4);
    const ghoul = sim.addMember({ role: 'service', firstName: 'Ghoul' });
    expect(preservationDecayPerHour(sim.ctx, ghoul)).toBe(0);
  });
});

describe('vitality', () => {
  it('erodes 0.6 at midnight (once per day) and 0.25/h below 15 freshness, re-capping preservation', () => {
    const sim = new FakeSim({ objects: lot(), tick: tickAt(1, 23 * 60 + 59) });
    const a = sim.member();
    a.vitality = 90;
    a.needs.preservation = 89.9;
    sim.advance(1); // crosses 00:00
    expect(a.vitality).toBeCloseTo(89.4, 6);
    sim.sys('decay').dayStart!(sim.ctx, sim.ctx.time.day); // repeated hook: idempotent
    expect(a.vitality).toBeCloseTo(89.4, 6);
    expect(a.needs.preservation).toBeLessThanOrEqual(a.vitality);
    a.needs.preservation = 10;
    const before = a.vitality;
    sim.advance(60);
    expect(before - a.vitality).toBeCloseTo(0.25, 3);
  });

  it('never drops below 20', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    a.vitality = 20.1;
    a.needs.preservation = 5;
    sim.advance(10 * 60);
    expect(a.vitality).toBe(20);
  });
});

describe('limb loss', () => {
  it('follows ((50-p)/50)^2 × 0.08 with clumsy ×2, fitness ×0.5, zero ×3 and Iron Stitches ×0', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    a.needs.preservation = 60;
    expect(limbLossChance(sim.ctx, a)).toBe(0);
    a.needs.preservation = 25;
    expect(limbLossChance(sim.ctx, a)).toBeCloseTo(0.02, 6);
    a.traits.push('clumsy');
    expect(limbLossChance(sim.ctx, a)).toBeCloseTo(0.04, 6);
    a.skills.fitness.level = 5;
    expect(limbLossChance(sim.ctx, a)).toBeCloseTo(0.02, 6);
    a.needs.preservation = 0;
    expect(limbLossChance(sim.ctx, a)).toBeCloseTo(0.08 * 2 * 0.5 * 3, 6);
    a.rewardTraits.push('ironStitches');
    expect(limbLossChance(sim.ctx, a)).toBe(0);
  });

  it('spawns a limb item with owner data and makes witnesses react by trait', () => {
    const sim = new FakeSim({
      objects: lot(),
      members: [
        { firstName: 'Mort', pos: { x: 5, z: 5 } },
        { firstName: 'Squea', traits: ['squeamish'], pos: { x: 6, z: 5 } },
        { firstName: 'Grum', traits: ['grumpy'], pos: { x: 5, z: 6 } },
        { firstName: 'Norm', pos: { x: 4, z: 5 } },
        { firstName: 'Far', pos: { x: 25, z: 25 } },
      ],
    });
    const [mort, squea, grum, norm, far] = [0, 1, 2, 3, 4].map((i) => sim.member(i));
    const item = loseLimb(sim.ctx, mort, 'armL');
    expect(item).not.toBeNull();
    expect(item!.defId).toBe('item_limb_arm');
    expect(item!.data).toMatchObject({ limbId: 'armL', ownerId: mort.id, rotten: false, createdTick: sim.state.tick });
    expect(mort.limbs.armL).toBe('missing');
    expect(sim.ctx.hasMoodlet(mort, MOOD.lostLimb)).toBe(true);
    expect(sim.ctx.hasMoodlet(squea, MOOD.squeamishHorror)).toBe(true);
    expect(sim.ctx.hasMoodlet(grum, MOOD.hilariousLimb)).toBe(true);
    expect(sim.ctx.hasMoodlet(norm, MOOD.grossedOut)).toBe(true);
    expect(far.moodlets).toEqual([]);
    expect(sim.eventsOf('fx').some((e) => e.kind === 'limbDrop')).toBe(true);
    expect(sim.ctx.statValue('limbsLost', mort.id)).toBe(1);
    // the same limb can't fall off twice; a fully limbless zombie loses nothing
    expect(loseLimb(sim.ctx, mort, 'armL')).toBeNull();
    for (const l of ['armR', 'legL', 'legR'] as const) loseLimb(sim.ctx, mort, l);
    expect(loseLimb(sim.ctx, mort, null)).toBeNull();
  });

  it('a task that needs the lost limb fails with a player-facing reason', () => {
    const sim = new FakeSim({ objects: [{ defId: 'gym_limb', x: 2, z: 2 }] });
    const a = sim.member();
    sim.start(a, IX.workout, { kind: 'object', id: sim.obj('gym_limb').id });
    loseLimb(sim.ctx, a, 'armL');
    expect(a.active).toBeNull();
    expect(sim.failures).toEqual([{ agentId: a.id, reason: 'Lost an arm mid-task' }]);
    expect(sim.lastOutcome).toBe('failed');
  });

  it('a clumsy owner laughs at their own loss', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ traits: ['clumsy'] }] });
    loseLimb(sim.ctx, sim.member(), 'legR');
    expect(sim.ctx.hasMoodlet(sim.member(), MOOD.hilariousLimb)).toBe(true);
    expect(sim.ctx.hasMoodlet(sim.member(), MOOD.lostLimb)).toBe(true);
  });

  it('runs at most once per game hour even if the hour hook fires twice', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ needs: { preservation: 0 } }] });
    sim.forcedChance = true;
    sim.sys('decay').hour!(sim.ctx, sim.ctx.time.hour);
    sim.sys('decay').hour!(sim.ctx, sim.ctx.time.hour);
    expect(sim.objs('item_limb_arm').length + sim.objs('item_limb_leg').length).toBe(1);
  });

  it('rots detached limbs after 48 game hours', () => {
    const sim = new FakeSim({ objects: lot() });
    const item = loseLimb(sim.ctx, sim.member(), 'armR')!;
    sim.member().needs.preservation = 90;
    sim.advance(47 * 60);
    expect(item.data.rotten).toBe(false);
    sim.advance(2 * 60);
    expect(item.data.rotten).toBe(true);
  });
});

describe('crumbling, urns, game over', () => {
  it('crumbles after 24 h at zero, mourns, turns to an urn after 72 h, then game over', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ firstName: 'Mort', needs: { preservation: 0 } }, { firstName: 'Ghoulia', needs: { preservation: 100 } }] });
    const [mort, ghoulia] = [sim.member(0), sim.member(1)];
    ghoulia.rewardTraits.push('ironStitches');
    mort.rewardTraits.push('ironStitches');
    sim.advance(1);
    expect(sim.ctx.hasMoodlet(mort, MOOD.fallingApart)).toBe(true);
    sim.advance(23 * 60);
    expect(mort.presence).toBe('onLot');
    sim.advance(60);
    expect(mort.presence).toBe('crumbled');
    const pile = sim.obj('item_bonepile');
    expect(pile.data.ownerId).toBe(mort.id);
    expect(mort.status.bonePileId).toBe(pile.id);
    expect(sim.ctx.hasMoodlet(ghoulia, MOOD.mourning)).toBe(true);
    expect(sim.state.gameOver).toBe(false);
    sim.advance(72 * 60);
    expect(mort.presence).toBe('gone');
    expect(sim.objs('item_bonepile')).toHaveLength(0);
    expect(sim.obj('item_urn').data.ownerId).toBe(mort.id);
    // last member crumbles → game over exactly once
    crumble(sim.ctx, ghoulia);
    expect(sim.state.gameOver).toBe(true);
    crumble(sim.ctx, ghoulia);
    sim.advance(5);
    expect(sim.eventsOf('gameOver')).toHaveLength(1);
  });

  it('a member at work crumbles on the doorstep when they get home', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ needs: { preservation: 0 } }, { needs: { preservation: 90 } }] });
    const a = sim.member();
    a.presence = 'atWork';
    a.status.zeroPreservationMinutes = 24 * 60;
    sim.advance(5);
    expect(a.presence).toBe('atWork');
    sim.ctx.spawnAgent(a.id);
    expect(a.presence).toBe('crumbled');
  });

  it('never crumbles visitors', () => {
    const sim = new FakeSim({ objects: lot(), members: [{}, { role: 'townie', needs: { preservation: 0 } }] });
    sim.advance(26 * 60);
    expect(sim.state.agents[Object.keys(sim.state.agents)[1]].presence).toBe('onLot');
  });
});

describe('reanimation', () => {
  it('Reanimate on a bone pile with a kit: back with 55 freshness, −15 vitality, all limbs, kit and pile consumed', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'kit_reanimation', x: 8, z: 8 }], members: [{ firstName: 'Mort' }, { firstName: 'Ghoulia' }] });
    const [mort, ghoulia] = [sim.member(0), sim.member(1)];
    mort.vitality = 80;
    mort.limbs.armL = 'missing';
    crumble(sim.ctx, mort);
    expect(sim.ctx.hasMoodlet(ghoulia, MOOD.mourning)).toBe(true);
    const pile = sim.obj('item_bonepile');
    expect(sim.start(ghoulia, IX.reanimate, { kind: 'object', id: pile.id })).toBeNull();
    sim.runToEnd(ghoulia);
    expect(sim.lastOutcome).toBe('complete');
    expect(mort.presence).toBe('onLot');
    expect(mort.vitality).toBe(65);
    expect(mort.needs.preservation).toBeCloseTo(55, 1); // a tick of decay may follow the reanimation
    expect(mort.limbs).toEqual({ armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' });
    expect(sim.ctx.hasMoodlet(mort, MOOD.backFromDead)).toBe(true);
    expect(sim.ctx.hasMoodlet(ghoulia, MOOD.mourning)).toBe(false);
    expect(sim.objs('kit_reanimation')).toHaveLength(0);
    expect(sim.objs('item_bonepile')).toHaveLength(0);
  });

  it('refuses when too late, not crumbled, unknown, and requires a kit', () => {
    const sim = new FakeSim({ objects: lot(), members: [{}, {}] });
    const [a, b] = [sim.member(0), sim.member(1)];
    expect(reanimate(sim.ctx, 'nope')).toMatch(/Nobody/);
    expect(reanimate(sim.ctx, a.id)).toMatch(/isn’t a pile/);
    crumble(sim.ctx, a);
    const pile = sim.obj('item_bonepile');
    expect(sim.canStart(b, IX.reanimate, { kind: 'object', id: pile.id })).toMatch(/Reanimation Kit/);
    a.status.crumbledTick = sim.state.tick - 73 * TICKS_PER_HOUR;
    expect(reanimate(sim.ctx, a.id)).toMatch(/Too late/);
  });

  it('the kit menu lists crumbled members and chains into Reanimate on their pile', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'kit_reanimation', x: 8, z: 8 }], members: [{ firstName: 'Mort' }, { firstName: 'Ghoulia' }] });
    const [mort, ghoulia] = [sim.member(0), sim.member(1)];
    crumble(sim.ctx, mort);
    const kit = sim.obj('kit_reanimation');
    const def = sim.content.interactions[IX.kitReanimate];
    const choices = sim.ctx.content && (sim.sys('decay').behaviors!.kitReanimate.choices!(sim.ctx, ghoulia, def, { kind: 'object', id: kit.id }) ?? []);
    expect(choices).toHaveLength(1);
    expect(choices[0].label).toMatch(/Mort \(72 h left\)/);
    sim.start(ghoulia, IX.kitReanimate, { kind: 'object', id: kit.id }, { agentId: mort.id });
    sim.runToEnd(ghoulia);
    expect(ghoulia.queue[0]).toMatchObject({ interactionId: IX.reanimate, target: { kind: 'object', id: mort.status.bonePileId } });
  });
});

describe('sleep behaviour', () => {
  it('restores energy via the bed params and stops at 98', () => {
    const sim = new FakeSim({ objects: lot(), tick: MIDNIGHT_DAY2 });
    const a = sim.member();
    a.needs.energy = 50;
    sim.start(a, IX.sleep, { kind: 'object', id: sim.obj('coffin_pine').id });
    sim.advance(60);
    expect(a.needs.energy).toBeCloseTo(62, 3);
    sim.runToEnd(a);
    expect(a.needs.energy).toBeGreaterThanOrEqual(98 - 1e-6);
    expect(sim.lastOutcome).toBe('complete');
    expect(sim.ctx.hasMoodlet(a, MOOD.wellRested)).toBe(true);
  });

  it('a human bed is too fluffy; the burial plot is dirty and drains hygiene', () => {
    const sim = new FakeSim({ objects: [{ defId: 'bed_normal', x: 2, z: 2 }, { defId: 'plot_budget', x: 25, z: 25 }], members: [{}, {}], tick: MIDNIGHT_DAY2 });
    const [a, b] = [sim.member(0), sim.member(1)];
    a.needs.energy = 20;
    b.needs.energy = 20;
    b.needs.hygiene = 60;
    sim.start(a, IX.sleep, { kind: 'object', id: sim.obj('bed_normal').id });
    sim.start(b, IX.sleep, { kind: 'object', id: sim.obj('plot_budget').id });
    sim.advance(120);
    expect(b.needs.hygiene).toBeCloseTo(54, 3);
    sim.runToEnd(a);
    sim.runToEnd(b);
    expect(sim.ctx.hasMoodlet(a, MOOD.tooFluffy)).toBe(true);
    expect(sim.ctx.hasMoodlet(a, MOOD.wellRested)).toBe(false);
    expect(sim.ctx.hasMoodlet(b, MOOD.sleptInDirt)).toBe(true);
  });

  it('ends gracefully when interrupted (careers wake-up) with a rude awakening', () => {
    const sim = new FakeSim({ objects: lot(), tick: MIDNIGHT_DAY2 });
    const a = sim.member();
    a.needs.energy = 10;
    sim.start(a, IX.sleep, { kind: 'object', id: sim.obj('coffin_pine').id });
    sim.advance(60);
    sim.ctx.interrupt(a, 'Time for work');
    expect(a.active).toBeNull();
    expect(sim.ctx.hasMoodlet(a, MOOD.rudeAwakening)).toBe(true);
    expect(sim.obj('coffin_pine').reservedBy).toEqual({});
  });

  it('cryo sleep ≥ 6 h with power adds +2 vitality (cap 100); without power it does not', () => {
    for (const powered of [true, false]) {
      // economy owns utilitiesOn (it restores power when no bill justifies a cut), so leave it out here
      const sim = new FakeSim({ objects: [{ defId: 'sarcophagus_cryo', x: 2, z: 2 }], tick: MIDNIGHT_DAY2, systems: homeSystems.filter((x) => x.id !== 'economy') });
      const a = sim.member();
      a.vitality = 70;
      a.needs.energy = 0;
      sim.state.household.utilitiesOn = powered;
      sim.start(a, IX.sleep, { kind: 'object', id: sim.obj('sarcophagus_cryo').id });
      sim.runToEnd(a);
      const expected = powered ? 72 : 70;
      expect(a.vitality + 0.6 * (sim.ctx.time.day - 2)).toBeCloseTo(expected, 1); // add back the midnight erosion
    }
  });
});

describe('embalming', () => {
  it('Self-Embalm costs $30 (balance pass) and restores 45 × (0.7 + 0.06 × mortuary) over 90 min', () => {
    const sim = new FakeSim({ objects: [{ defId: 'station_embalming', x: 2, z: 2 }], members: [{ needs: { preservation: 30 }, skills: { mortuary: 5 } }], funds: 100 });
    const a = sim.member();
    a.rewardTraits.push('wellPreserved'); // shrink decay noise
    sim.start(a, IX.selfEmbalm, { kind: 'object', id: sim.obj('station_embalming').id });
    expect(sim.state.household.funds).toBe(70);
    sim.runToEnd(a);
    const gain = 45 * (0.7 + 0.06 * 5);
    expect(a.needs.preservation).toBeCloseTo(30 + gain - 1.3 * 0.7 * 1.5, 1);
    expect(sim.ctx.hasMoodlet(a, MOOD.embalmed)).toBe(true);
    expect(a.skills.mortuary.level).toBeGreaterThanOrEqual(5);
  });

  it('fails cleanly without the $30', () => {
    const sim = new FakeSim({ objects: [{ defId: 'station_embalming', x: 2, z: 2 }], funds: 29 });
    const a = sim.member();
    a.needs.preservation = 30;
    expect(sim.start(a, IX.selfEmbalm, { kind: 'object', id: sim.obj('station_embalming').id })).toBe("Can't afford");
    expect(sim.state.household.funds).toBe(29);
    expect(a.needs.preservation).toBe(30);
  });

  it('Embalm Other gives the partner +60 (Squeamish embalmer ×0.7) and counts embalmedOthers per agent', () => {
    for (const squeamish of [false, true]) {
      const sim = new FakeSim({
        objects: [{ defId: 'station_embalming', x: 2, z: 2 }],
        members: [
          { firstName: 'Doc', skills: { mortuary: 3 }, traits: squeamish ? ['squeamish'] : [] },
          { firstName: 'Patient', needs: { preservation: 20 } },
        ],
      });
      const [doc, patient] = [sim.member(0), sim.member(1)];
      expect(sim.canStart(doc, IX.embalmOther, { kind: 'agent', id: patient.id })).toBe(true);
      expect(sim.start(doc, IX.embalmOther, { kind: 'agent', id: patient.id })).toBeNull();
      expect(patient.active?.interactionId).toBe(IX.beEmbalmed);
      sim.runToEnd(doc);
      const gain = 60 * (squeamish ? 0.7 : 1);
      expect(patient.needs.preservation).toBeCloseTo(20 + gain - 1.3, 1);
      expect(sim.ctx.hasMoodlet(patient, MOOD.embalmed)).toBe(true);
      expect(sim.ctx.statValue('embalmedOthers', doc.id)).toBe(1);
      expect(patient.active).toBeNull();
      if (squeamish) expect(sim.ctx.hasMoodlet(doc, MOOD.squeamishHorror)).toBe(true);
    }
  });

  it('requires mortuary 2, a station, and a target that is not already fresh', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ firstName: 'Doc' }, { firstName: 'P', needs: { preservation: 100 } }] });
    const [doc, p] = [sim.member(0), sim.member(1)];
    expect(sim.canStart(doc, IX.embalmOther, { kind: 'agent', id: p.id })).toMatch(/Embalming Station/);
    sim.addObject({ defId: 'station_embalming', x: 12, z: 12 });
    expect(sim.canStart(doc, IX.embalmOther, { kind: 'agent', id: p.id })).toMatch(/mortuary 2/);
    doc.skills.mortuary.level = 2;
    expect(sim.canStart(doc, IX.embalmOther, { kind: 'agent', id: p.id })).toMatch(/already fresh/);
  });
});

describe('stitching & prosthetics', () => {
  it('own limb: Stitch Back On from the item walks to the table; success restores the limb', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'table_stitchnmend', x: 8, z: 8 }], members: [{ skills: { mortuary: 10 } }] });
    const a = sim.member();
    const limb = loseLimb(sim.ctx, a, 'armL')!;
    expect(stitchChance(sim.ctx, a)).toBe(0.95);
    sim.forcedChance = true;
    expect(sim.start(a, IX.limbStitch, { kind: 'object', id: limb.id })).toBeNull();
    sim.runToEnd(a);
    expect(a.limbs.armL).toBe('ok');
    expect(sim.state.objects[limb.id]).toBeUndefined();
    expect(a.carryObjectId).toBeNull();
    expect(sim.ctx.hasMoodlet(a, MOOD.stitchedUp)).toBe(true);
  });

  it('a failed stitch drops the limb and gives Butterfingers', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'table_stitchnmend', x: 8, z: 8 }] });
    const a = sim.member();
    const limb = loseLimb(sim.ctx, a, 'legL')!;
    sim.forcedChance = false;
    sim.start(a, IX.limbStitch, { kind: 'object', id: limb.id });
    sim.runToEnd(a);
    expect(a.limbs.legL).toBe('missing');
    expect(sim.state.objects[limb.id].placement.kind).toBe('loose');
    expect(sim.ctx.hasMoodlet(a, MOOD.butterfingers)).toBe(true);
  });

  it('someone else’s limb: Reattach picks it up and queues Stitch Other on the owner', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'table_stitchnmend', x: 8, z: 8 }], members: [{ firstName: 'Owner' }, { firstName: 'Helper' }] });
    const [owner, helper] = [sim.member(0), sim.member(1)];
    const limb = loseLimb(sim.ctx, owner, 'armR')!;
    expect(sim.canStart(helper, IX.limbStitch, { kind: 'object', id: limb.id })).toMatch(/Not their limb/);
    expect(sim.canStart(owner, IX.limbReattachOther, { kind: 'object', id: limb.id })).toMatch(/own limb/);
    sim.start(helper, IX.limbReattachOther, { kind: 'object', id: limb.id });
    sim.runToEnd(helper);
    expect(helper.carryObjectId).toBe(limb.id);
    expect(helper.queue[0]).toMatchObject({ interactionId: IX.stitchOther, target: { kind: 'agent', id: owner.id } });
    sim.forcedChance = true;
    sim.start(helper, IX.stitchOther, { kind: 'agent', id: owner.id });
    expect(owner.active?.interactionId).toBe(IX.beStitched);
    sim.runToEnd(helper);
    expect(owner.limbs.armR).toBe('ok');
    expect(owner.active).toBeNull();
  });

  it('rotten limbs cannot be reattached', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'table_stitchnmend', x: 8, z: 8 }] });
    const a = sim.member();
    const limb = loseLimb(sim.ctx, a, 'armL')!;
    limb.data.rotten = true;
    expect(sim.canStart(a, IX.limbStitch, { kind: 'object', id: limb.id })).toMatch(/rotten/);
  });

  it('Fit Prosthetic replaces a missing limb (chosen one first) and consumes the crate', () => {
    const sim = new FakeSim({ objects: [{ defId: 'crate_prosthetic', x: 2, z: 2 }] });
    const a = sim.member();
    expect(sim.canStart(a, IX.fitProsthetic, { kind: 'object', id: sim.obj('crate_prosthetic').id })).toMatch(/all their limbs/);
    a.limbs.legL = 'missing';
    a.limbs.armR = 'missing';
    sim.start(a, IX.fitProsthetic, { kind: 'object', id: sim.obj('crate_prosthetic').id }, { limb: 'legL' });
    sim.runToEnd(a);
    expect(a.limbs.legL).toBe('prosthetic');
    expect(a.limbs.armR).toBe('missing');
    expect(sim.objs('crate_prosthetic')).toHaveLength(0);
  });
});

describe('mirror & api', () => {
  it('Check Freshness reports the numbers', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    a.needs.preservation = 42;
    a.vitality = 88;
    a.limbs.legR = 'missing';
    const text = freshnessReport(sim.ctx, a);
    expect(text).toMatch(/Freshness 42 \/ 88/);
    expect(text).toMatch(/1\.3 per hour/);
    expect(text).toMatch(/right leg/);
    expect(text).toMatch(/Limb-loss risk/);
  });

  it('decayLevel is 0 fresh, 1 crumbled, monotonic in freshness; api works with a trailing ctx', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    a.needs.preservation = 100;
    a.vitality = 100;
    expect(decayLevel(a)).toBe(0);
    a.needs.preservation = 50;
    const mid = decayLevel(a);
    a.needs.preservation = 10;
    expect(decayLevel(a)).toBeGreaterThan(mid);
    const api = sim.sys('decay').api!;
    expect(api.decayLevel(a.id, sim.ctx)).toBe(decayLevel(a));
    expect(api.decayLevel('nobody', sim.ctx)).toBe(0);
    a.presence = 'crumbled';
    expect(api.decayLevel(a.id)).toBe(1);
    expect(api.preservationPerHour(a.id, sim.ctx)).toBe(0);
  });
});
