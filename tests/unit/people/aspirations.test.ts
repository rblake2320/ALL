/**
 * Aspirations: every milestone condition kind, points awarded exactly once, notifications/events, the freshness
 * streak, Reward Store purchases (traits, Second Wind) and their refusals.
 */
import { describe, expect, it } from 'vitest';
import { at, createFakeSim } from './fakeCtx';
import { checkMilestones, closeFreshDay, freshStreak, sampleFreshness } from '../../../src/sim/systems/people/aspirations';

function aspirant(aspiration: string) {
  const sim = createFakeSim({ household: ['Mortimer'], initSystems: false });
  sim.ctx.content.lifeEvents.length = 0;
  for (const s of sim.systems) s.init?.(sim.ctx, false);
  const z = sim.state.agents[sim.state.household.memberIds[0]];
  z.aspiration = aspiration;
  return { sim, z, api: sim.api('aspirations') };
}

describe('aspiration milestones', () => {
  it('Undead Tycoon: funds + career level, each awarded once', () => {
    const { sim, z, api } = aspirant('tycoon');
    expect(checkMilestones(sim.ctx)).toEqual([]);
    sim.state.household.funds = 5000;
    expect(checkMilestones(sim.ctx)).toEqual(['tycoon_funds5k']);
    expect(z.aspirationPoints).toBe(250);
    expect(checkMilestones(sim.ctx)).toEqual([]);
    expect(z.aspirationPoints).toBe(250);
    sim.api('careers').join(z.id, 'retail');
    z.career!.level = 5;
    sim.state.household.funds = 25000;
    expect(checkMilestones(sim.ctx).sort()).toEqual(['tycoon_career3', 'tycoon_career5', 'tycoon_funds25k']);
    expect(z.aspirationPoints).toBe(250 + 400 + 600 + 1000);
    expect(sim.events.filter((e) => e.type === 'milestone')).toHaveLength(4);
    expect(sim.events.filter((e) => e.type === 'sfx' && e.id === 'milestone')).toHaveLength(4);
    expect(sim.notifications().join('\n')).toMatch(/Aspiration complete/);
    const v = api.view(z.id);
    expect(v.milestones.every((m: { done: boolean }) => m.done)).toBe(true);
  });

  it('Life of the Afterparty: friends + per-host party stats', () => {
    const { sim, z } = aspirant('afterparty');
    for (let i = 0; i < 3; i++) {
      const t = sim.addAgent({ firstName: `Pal${i}`, role: 'townie', presence: 'offLot' });
      Object.assign(sim.ctx.rel(z.id, t.id), { met: true, friendship: 35 });
    }
    const svc = sim.addAgent({ firstName: 'Pizza', role: 'service', presence: 'offLot' });
    Object.assign(sim.ctx.rel(z.id, svc.id), { met: true, friendship: 90 });
    expect(checkMilestones(sim.ctx)).toEqual(['afterparty_friends3']);
    sim.ctx.stat('partiesThrown', 1, null); // someone else's party doesn't count
    expect(checkMilestones(sim.ctx)).toEqual([]);
    sim.ctx.stat('partiesThrown', 1, z.id);
    sim.ctx.stat('legendaryParties', 1, z.id);
    expect(checkMilestones(sim.ctx).sort()).toEqual(['afterparty_legendary', 'afterparty_party']);
  });

  it('Eternal Romance: kissed, partners, married, romance 100', () => {
    const { sim, z } = aspirant('eternalRomance');
    const t = sim.addAgent({ firstName: 'Love', role: 'townie' });
    const r = sim.ctx.rel(z.id, t.id);
    sim.ctx.stat('kisses', 1, z.id);
    r.partners = true;
    expect(checkMilestones(sim.ctx).sort()).toEqual(['romance_firstKiss', 'romance_partners']);
    r.married = true;
    r.romance = 99.9;
    expect(checkMilestones(sim.ctx)).toEqual(['romance_married']);
    r.romance = 100;
    expect(checkMilestones(sim.ctx)).toEqual(['romance_max']);
  });

  it('Master Preserver: mortuary skill, embalmedOthers stat, 7-day freshness streak', () => {
    const { sim, z } = aspirant('masterPreserver');
    z.skills.mortuary.level = 7;
    sim.ctx.stat('embalmedOthers', 1, z.id);
    expect(checkMilestones(sim.ctx).sort()).toEqual(['preserver_embalmOther', 'preserver_mortuary3', 'preserver_mortuary7']);
    z.needs.preservation = 90;
    for (let day = 2; day <= 8; day++) {
      sampleFreshness(sim.ctx);
      closeFreshDay(sim.ctx, day);
      closeFreshDay(sim.ctx, day); // idempotent per day
    }
    expect(freshStreak(sim.ctx)).toBe(7);
    expect(checkMilestones(sim.ctx)).toEqual(['preserver_freshWeek']);
  });

  it('the freshness streak resets on any hourly sample below 70 and on days without samples', () => {
    const { sim, z } = aspirant('masterPreserver');
    z.needs.preservation = 90;
    sampleFreshness(sim.ctx);
    closeFreshDay(sim.ctx, 2);
    expect(freshStreak(sim.ctx)).toBe(1);
    sampleFreshness(sim.ctx);
    z.needs.preservation = 60;
    sampleFreshness(sim.ctx);
    closeFreshDay(sim.ctx, 3);
    expect(freshStreak(sim.ctx)).toBe(0);
    z.needs.preservation = 90;
    closeFreshDay(sim.ctx, 4); // no samples that day
    expect(freshStreak(sim.ctx)).toBe(0);
    z.needs.preservation = NaN;
    sampleFreshness(sim.ctx);
    closeFreshDay(sim.ctx, 5);
    expect(freshStreak(sim.ctx)).toBe(0);
  });

  it('Renaissance Corpse: creativity, paintings sold, three skills at 5+', () => {
    const { sim, z } = aspirant('renaissanceCorpse');
    z.skills.creativity.level = 7;
    z.skills.logic.level = 5;
    expect(checkMilestones(sim.ctx).sort()).toEqual(['renaissance_creativity3', 'renaissance_creativity7']);
    z.skills.fitness.level = 5;
    sim.ctx.stat('paintingsSold', 1, z.id);
    expect(checkMilestones(sim.ctx).sort()).toEqual(['renaissance_sellPainting', 'renaissance_threeSkills']);
  });

  it('runs hourly through the system hook and ignores unknown aspirations / non-members', () => {
    const { sim, z } = aspirant('nonsense');
    sim.state.household.funds = 99999;
    sim.jumpTo(at(1, 11));
    expect(z.aspirationPoints).toBe(0);
    z.aspiration = 'tycoon';
    sim.jumpTo(at(1, 12));
    expect(z.aspirationMilestones).toContain('tycoon_funds5k');
    const t = sim.addAgent({ firstName: 'T', role: 'townie' });
    t.aspiration = 'tycoon';
    sim.jumpTo(at(1, 13));
    expect(t.aspirationMilestones).toEqual([]);
  });
});

describe('reward store', () => {
  it('buys trait rewards once, refuses when short of points', () => {
    const { sim, z, api } = aspirant('tycoon');
    z.aspirationPoints = 1000;
    expect(api.buyReward(z.id, 'reward_wellPreserved')).toMatch(/Needs 200 more/);
    expect(api.buyReward(z.id, 'reward_ironStitches')).toBe(true);
    expect(z.rewardTraits).toEqual(['ironStitches']);
    expect(z.aspirationPoints).toBe(100);
    z.aspirationPoints = 5000;
    expect(api.buyReward(z.id, 'reward_ironStitches')).toBe('Already owned');
    expect(z.aspirationPoints).toBe(5000);
    expect(sim.ctx.traitMult(z, 'limbLoss')).toBe(0);
    const v = api.view(z.id);
    expect(v.rewards.find((r: { id: string }) => r.id === 'reward_ironStitches')).toMatchObject({ owned: true, affordable: false });
    expect(v.rewards.find((r: { id: string }) => r.id === 'reward_wellPreserved')).toMatchObject({ owned: false, affordable: true });
  });

  it('Second Wind raises vitality by 20 (max 100) and is refused at full vitality', () => {
    const { sim, z, api } = aspirant('tycoon');
    z.aspirationPoints = 2000;
    expect(api.buyReward(z.id, 'reward_secondWind')).toMatch(/peak/);
    z.vitality = 70;
    expect(api.buyReward(z.id, 'reward_secondWind')).toBe(true);
    expect(z.vitality).toBe(90);
    expect(z.aspirationPoints).toBe(1400);
    expect(sim.ctx.hasMoodlet(z, 'secondWind')).toBe(true);
    expect(api.buyReward(z.id, 'reward_secondWind')).toBe(true);
    expect(z.vitality).toBe(100);
  });

  it('refuses junk: unknown agent/reward, townies, crumbled zombies, NaN points', () => {
    const { sim, z, api } = aspirant('tycoon');
    expect(api.buyReward('ghost', 'reward_ironStitches')).toBe('Unknown zombie');
    expect(api.buyReward(z.id, 'reward_free_money')).toBe('No such reward');
    const t = sim.addAgent({ firstName: 'T', role: 'townie' });
    t.aspirationPoints = 99999;
    expect(api.buyReward(t.id, 'reward_ironStitches')).toMatch(/household/);
    z.aspirationPoints = NaN;
    expect(api.buyReward(z.id, 'reward_castIronStomach')).toMatch(/Needs 400 more/);
    z.presence = 'crumbled';
    z.aspirationPoints = 9999;
    expect(api.buyReward(z.id, 'reward_castIronStomach')).toMatch(/living/);
    expect(api.view('ghost')).toBeNull();
    z.aspiration = null;
    expect(api.view(z.id)).toBeNull();
  });
});
