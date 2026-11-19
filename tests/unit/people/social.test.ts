/**
 * Social system: GDD §9 success-chance formula, gates, deltas/outcomes, behaviour idempotency, drift, SocialApi.
 */
import { describe, expect, it } from 'vitest';
import { createFakeSim, at, HOUR } from './fakeCtx';
import { successChance } from '../../../src/sim/systems/people/social/chance';
import { checkGates } from '../../../src/sim/systems/people/social/gates';
import { applySocialResult } from '../../../src/sim/systems/people/social/outcomes';
import { dailyDrift, labelBetween, relationshipLabel } from '../../../src/sim/systems/people/social/relations';
import type { AgentState } from '../../../src/sim/types';

function pair(opts: { traitsA?: string[]; traitsB?: string[]; roleB?: AgentState['role'] } = {}) {
  const sim = createFakeSim({ initSystems: false });
  const a = sim.addAgent({ firstName: 'Mortimer', traits: opts.traitsA ?? [] });
  const b = sim.addAgent({ firstName: 'Ghoulia', role: opts.roleB ?? 'household', traits: opts.traitsB ?? [] });
  sim.moodOverride[a.id] = 0;
  sim.moodOverride[b.id] = 0;
  return { sim, a, b, def: (id: string) => sim.ctx.content.interactions[id] };
}

describe('social success chance (GDD §9 formula)', () => {
  it('base + 0.03×charisma + moods/400 + friendship/400', () => {
    const { sim, a, b, def } = pair();
    a.skills.charisma.level = 4;
    sim.moodOverride[a.id] = 40;
    sim.moodOverride[b.id] = 20;
    sim.ctx.rel(a.id, b.id).friendship = 40;
    const c = successChance(sim.ctx, a, b, def('social_chat')).chance;
    expect(c).toBeCloseTo(0.85 + 0.12 + 60 / 400 + 40 / 400 > 0.95 ? 0.95 : 0.85 + 0.12 + 0.15 + 0.1, 6);
    const j = successChance(sim.ctx, a, b, def('social_joke')).chance;
    expect(j).toBeCloseTo(Math.min(0.95, 0.7 + 0.12 + 0.15 + 0.1), 6);
  });

  it('clamps to 0.05..0.95', () => {
    const { sim, a, b, def } = pair();
    sim.moodOverride[a.id] = -100;
    sim.moodOverride[b.id] = -100;
    sim.ctx.rel(a.id, b.id).friendship = -100;
    a.needs.hygiene = 0;
    expect(successChance(sim.ctx, a, b, def('social_playfulBite')).chance).toBe(0.05);
    sim.moodOverride[a.id] = 100;
    sim.moodOverride[b.id] = 100;
    sim.ctx.rel(a.id, b.id).friendship = 100;
    a.needs.hygiene = 100;
    a.skills.charisma.level = 10;
    expect(successChance(sim.ctx, a, b, def('social_chat')).chance).toBe(0.95);
  });

  it('Welcome In (base 1.0) always succeeds', () => {
    const { sim, a, b, def } = pair();
    sim.moodOverride[b.id] = -100;
    expect(successChance(sim.ctx, a, b, def('social_welcome')).chance).toBe(1);
  });

  it('smelly actors −0.25 unless the target is a Slob', () => {
    const { sim, a, b, def } = pair();
    a.needs.hygiene = 10;
    expect(successChance(sim.ctx, a, b, def('social_chat')).chance).toBeCloseTo(0.6, 6);
    b.traits = ['slob'];
    expect(successChance(sim.ctx, a, b, def('social_chat')).chance).toBeCloseTo(0.85, 6);
    a.needs.hygiene = 15; // boundary: < 15 only
    b.traits = [];
    expect(successChance(sim.ctx, a, b, def('social_chat')).chance).toBeCloseTo(0.85, 6);
  });

  it('miserable targets −0.2', () => {
    const { sim, a, b, def } = pair();
    sim.moodOverride[b.id] = -50;
    expect(successChance(sim.ctx, a, b, def('social_chat')).chance).toBeCloseTo(0.85 - 50 / 400 - 0.2, 6);
  });

  it('trait bonuses: Silver Tongue, Social Butterfly, Grumpy/Hothead mean, Cheerful jokes, Grumpy targets, Vain targets', () => {
    const { sim, a, b, def } = pair();
    a.rewardTraits = ['silverTongue'];
    expect(successChance(sim.ctx, a, b, def('social_flirt')).chance).toBeCloseTo(0.65 + 0.15, 6);
    a.rewardTraits = [];
    a.traits = ['socialButterfly'];
    expect(successChance(sim.ctx, a, b, def('social_flirt')).chance).toBeCloseTo(0.75, 6);
    a.traits = ['grumpy', 'hothead'];
    // grumpy baseMood is irrelevant here (mood overridden); mean bonus .15 + .2
    expect(successChance(sim.ctx, a, b, def('social_argue')).chance).toBeCloseTo(0.95, 6);
    expect(successChance(sim.ctx, a, b, def('social_chat')).chance).toBeCloseTo(0.85, 6);
    a.traits = ['cheerful'];
    expect(successChance(sim.ctx, a, b, def('social_joke')).chance).toBeCloseTo(0.85, 6);
    a.traits = [];
    b.traits = ['grumpy'];
    expect(successChance(sim.ctx, a, b, def('social_joke')).chance).toBeCloseTo(0.45, 6);
    b.traits = ['vain'];
    expect(successChance(sim.ctx, a, b, def('social_complimentRot')).chance).toBeCloseTo(0.95, 6);
  });

  it('survives NaN everywhere', () => {
    const { sim, a, b, def } = pair();
    sim.moodOverride[a.id] = NaN;
    a.skills.charisma.level = NaN;
    a.needs.hygiene = NaN;
    sim.ctx.rel(a.id, b.id).friendship = NaN;
    const c = successChance(sim.ctx, a, b, def('social_chat')).chance;
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0.05);
    expect(c).toBeLessThanOrEqual(0.95);
  });
});

describe('social gates', () => {
  it('introduce only for strangers; small talk auto-introduces; romance and insults need an introduction', () => {
    const { sim, a, b, def } = pair();
    expect(checkGates(sim.ctx, a, b, def('social_introduce'), { engineGates: true })).toBe(true);
    for (const id of ['social_chat', 'social_joke', 'social_complimentRot']) expect(checkGates(sim.ctx, a, b, def(id), { engineGates: true }), id).toBe(true);
    for (const id of ['social_flirt', 'social_argue', 'social_insultDecay', 'social_kiss']) expect(checkGates(sim.ctx, a, b, def(id), { engineGates: true }), id).toMatch(/introduced/);
    sim.ctx.rel(a.id, b.id).met = true;
    expect(checkGates(sim.ctx, a, b, def('social_introduce'), { engineGates: true })).toMatch(/acquainted/);
    expect(checkGates(sim.ctx, a, b, def('social_argue'), { engineGates: true })).toBe(true);
  });

  it('friendship / romance thresholds are enforced with engine gates', () => {
    const { sim, a, b, def } = pair();
    const r = sim.ctx.rel(a.id, b.id);
    r.met = true;
    r.friendship = 29;
    expect(checkGates(sim.ctx, a, b, def('social_hug'), { engineGates: true })).toMatch(/friendship 30/);
    expect(checkGates(sim.ctx, a, b, def('social_hug'), { engineGates: false })).toBe(true);
    r.friendship = 30;
    expect(checkGates(sim.ctx, a, b, def('social_hug'), { engineGates: true })).toBe(true);
    r.romance = 39;
    expect(checkGates(sim.ctx, a, b, def('social_kiss'), { engineGates: true })).toMatch(/romance 40/);
    r.romance = 40;
    expect(checkGates(sim.ctx, a, b, def('social_kiss'), { engineGates: true })).toBe(true);
  });

  it('relationship status gates: notPartnered, partners, engaged, partnersOrMore', () => {
    const { sim, a, b, def } = pair();
    const r = sim.ctx.rel(a.id, b.id);
    Object.assign(r, { met: true, friendship: 60, romance: 90 });
    expect(checkGates(sim.ctx, a, b, def('social_askPartner'), { engineGates: true })).toBe(true);
    expect(checkGates(sim.ctx, a, b, def('social_propose'), { engineGates: true })).toMatch(/partners first/);
    expect(checkGates(sim.ctx, a, b, def('social_breakUp'), { engineGates: true })).toMatch(/not a couple/);
    r.partners = true;
    expect(checkGates(sim.ctx, a, b, def('social_askPartner'), { engineGates: true })).toMatch(/together/);
    expect(checkGates(sim.ctx, a, b, def('social_propose'), { engineGates: true })).toBe(true);
    expect(checkGates(sim.ctx, a, b, def('social_elope'), { engineGates: true })).toMatch(/engaged first/);
    r.engaged = true;
    expect(checkGates(sim.ctx, a, b, def('social_propose'), { engineGates: true })).toMatch(/Already engaged/);
    expect(checkGates(sim.ctx, a, b, def('social_elope'), { engineGates: true })).toBe(true);
    expect(checkGates(sim.ctx, a, b, def('social_breakUp'), { engineGates: true })).toBe(true);
  });

  it('nobody can go steady with someone already spoken for', () => {
    const { sim, a, b, def } = pair();
    const c = sim.addAgent({ firstName: 'Rotney', role: 'townie' });
    Object.assign(sim.ctx.rel(a.id, b.id), { met: true, friendship: 60, romance: 70 });
    Object.assign(sim.ctx.rel(b.id, c.id), { met: true, partners: true });
    expect(checkGates(sim.ctx, a, b, def('social_askPartner'), { engineGates: true })).toMatch(/spoken for/);
  });

  it('visitor gates: welcome only waiting visitors, inviteStay only welcomed, waveOver only walk-bys', () => {
    const { sim, a, def } = pair();
    const v = sim.addAgent({ firstName: 'Agnes', role: 'townie' });
    expect(checkGates(sim.ctx, a, v, def('social_welcome'), { engineGates: true })).toMatch(/isn’t visiting/);
    v.visit = { arrivedTick: 0, leaveTick: 999, reason: 'dropIn', welcomed: false, leaving: false };
    expect(checkGates(sim.ctx, a, v, def('social_welcome'), { engineGates: true })).toBe(true);
    expect(checkGates(sim.ctx, a, v, def('social_inviteStay'), { engineGates: true })).toMatch(/Welcome them in first/);
    v.visit.welcomed = true;
    expect(checkGates(sim.ctx, a, v, def('social_welcome'), { engineGates: true })).toMatch(/already inside/);
    expect(checkGates(sim.ctx, a, v, def('social_inviteStay'), { engineGates: true })).toBe(true);
    expect(checkGates(sim.ctx, a, v, def('social_waveOver'), { engineGates: true })).toMatch(/walking by/);
    v.visit = null;
    v.walkBy = { from: { x: 0.5, z: 28.5 }, to: { x: 29.5, z: 28.5 }, startedTick: 0 };
    expect(checkGates(sim.ctx, a, v, def('social_waveOver'), { engineGates: true })).toBe(true);
    expect(checkGates(sim.ctx, a, v, def('social_introduce'), { engineGates: true })).toMatch(/Wave them over/);
  });

  it('move-in needs friendship 50 or a partner, a non-household townie, and room (cap 8)', () => {
    const { sim, a, def } = pair();
    const t = sim.addAgent({ firstName: 'Doris', role: 'townie' });
    const r = sim.ctx.rel(a.id, t.id);
    Object.assign(r, { met: true, friendship: 49 });
    expect(checkGates(sim.ctx, a, t, def('social_moveIn'), { engineGates: true })).toMatch(/friendship 50/);
    r.friendship = 50;
    expect(checkGates(sim.ctx, a, t, def('social_moveIn'), { engineGates: true })).toBe(true);
    r.friendship = 0;
    r.partners = true;
    expect(checkGates(sim.ctx, a, t, def('social_moveIn'), { engineGates: true })).toBe(true);
    for (let i = 0; i < 6; i++) sim.addAgent({ firstName: `Filler${i}` });
    expect(sim.state.household.memberIds).toHaveLength(8);
    expect(checkGates(sim.ctx, a, t, def('social_moveIn'), { engineGates: true })).toMatch(/full/);
  });

  it('service NPCs, absent agents, missing targets and self are refused gracefully', () => {
    const { sim, a, b, def } = pair({ roleB: 'service' });
    expect(checkGates(sim.ctx, a, b, def('social_chat'), { engineGates: true })).toMatch(/on the clock/);
    expect(checkGates(sim.ctx, a, a, def('social_chat'), { engineGates: true })).toMatch(/yourself/);
    expect(checkGates(sim.ctx, a, undefined, def('social_chat'), { engineGates: true })).toMatch(/not here/);
    const gone = sim.addAgent({ firstName: 'Gone', role: 'townie', presence: 'offLot' });
    expect(checkGates(sim.ctx, a, gone, def('social_chat'), { engineGates: true })).toMatch(/isn’t here/);
    expect(checkGates(sim.ctx, a, b, sim.ctx.content.interactions.phone_quitJob, { engineGates: true })).toMatch(/Not a social/);
  });
});

describe('social outcomes (deltas + special outcomes)', () => {
  it('applies GDD friendship deltas, social need +8 / +4, fun, charisma xp', () => {
    const { sim, a, b, def } = pair();
    const r = sim.ctx.rel(a.id, b.id);
    r.met = true;
    a.needs.social = 50;
    b.needs.social = 50;
    a.needs.fun = 50;
    applySocialResult(sim.ctx, a, b, def('social_joke'), true);
    expect(r.friendship).toBe(6);
    expect(a.needs.social).toBe(58);
    expect(b.needs.social).toBe(58);
    expect(a.needs.fun).toBe(58);
    expect(a.skills.charisma.xp).toBe(6);
    expect(sim.ctx.hasMoodlet(b, 'laughedTooHard')).toBe(true);
    applySocialResult(sim.ctx, a, b, def('social_joke'), false);
    expect(r.friendship).toBe(2);
    expect(a.needs.social).toBe(62);
    expect(r.interactions).toBe(2);
  });

  it('a first chat with a stranger includes the introduction (+3) and counts a townsfolk meeting', () => {
    const { sim, a, def } = pair();
    const t = sim.addAgent({ firstName: 'Stranger', role: 'townie' });
    applySocialResult(sim.ctx, a, t, def('social_chat'), true);
    const r = sim.ctx.rel(a.id, t.id);
    expect(r.met).toBe(true);
    expect(r.friendship).toBe(3 + 4);
    expect(sim.ctx.statValue('townsfolkMet', a.id)).toBe(1);
    applySocialResult(sim.ctx, a, t, def('social_chat'), true);
    expect(r.friendship).toBe(3 + 4 + 4);
    expect(sim.ctx.statValue('townsfolkMet', a.id)).toBe(1);
  });

  it('introduce sets met even on failure', () => {
    const { sim, a, b, def } = pair();
    applySocialResult(sim.ctx, a, b, def('social_introduce'), false);
    const r = sim.ctx.rel(a.id, b.id);
    expect(r.met).toBe(true);
    expect(r.friendship).toBe(1);
  });

  it('romance gains × romanceMult (higher of the two), losses unscaled, clamped to 0..100', () => {
    const { sim, a, b, def } = pair({ traitsB: ['hopelessRomantic'] });
    const r = sim.ctx.rel(a.id, b.id);
    Object.assign(r, { met: true, friendship: 20 });
    applySocialResult(sim.ctx, a, b, def('social_flirt'), true);
    expect(r.romance).toBeCloseTo(12, 6); // 8 × 1.5
    applySocialResult(sim.ctx, a, b, def('social_flirt'), false);
    expect(r.romance).toBeCloseTo(8, 6);
    r.romance = 95;
    applySocialResult(sim.ctx, a, b, def('social_kiss'), true);
    expect(r.romance).toBe(100);
    r.romance = 2;
    applySocialResult(sim.ctx, a, b, def('social_kiss'), false);
    expect(r.romance).toBe(0);
  });

  it('kisses are counted and give First Kiss once', () => {
    const { sim, a, b, def } = pair();
    Object.assign(sim.ctx.rel(a.id, b.id), { met: true, romance: 50 });
    applySocialResult(sim.ctx, a, b, def('social_kiss'), true);
    expect(sim.ctx.statValue('kisses', a.id)).toBe(1);
    expect(sim.ctx.statValue('kisses', b.id)).toBe(1);
    expect(sim.ctx.hasMoodlet(a, 'firstKiss')).toBe(true);
    sim.ctx.removeMoodlet(a, 'firstKiss');
    applySocialResult(sim.ctx, a, b, def('social_kiss'), true);
    expect(sim.ctx.hasMoodlet(a, 'firstKiss')).toBe(false);
    expect(sim.ctx.statValue('kisses', a.id)).toBe(2);
  });

  it('partners → engaged → married (townie spouse moves in) → break up', () => {
    const { sim, a, def } = pair();
    const t = sim.addAgent({ firstName: 'Lucretia', role: 'townie', traits: ['hopelessRomantic'] });
    t.visit = { arrivedTick: 0, leaveTick: 9999, reason: 'invited', welcomed: true, leaving: false };
    sim.ctx.addMoodlet(t, 'lovesick');
    const r = sim.ctx.rel(a.id, t.id);
    Object.assign(r, { met: true, friendship: 60, romance: 85 });
    applySocialResult(sim.ctx, a, t, def('social_askPartner'), true);
    expect(r.partners).toBe(true);
    expect(sim.ctx.hasMoodlet(t, 'lovesick')).toBe(false);
    applySocialResult(sim.ctx, a, t, def('social_propose'), true);
    expect(r.engaged).toBe(true);
    applySocialResult(sim.ctx, a, t, def('social_elope'), true);
    expect(r.married).toBe(true);
    expect(r.engaged).toBe(false);
    expect(sim.ctx.hasMoodlet(a, 'newlyweds')).toBe(true);
    expect(t.moodlets.find((m) => m.id === 'newlyweds')!.endTick).toBe(sim.state.tick + 3 * 24 * 60 * 4);
    expect(t.role).toBe('household');
    expect(sim.state.household.memberIds).toContain(t.id);
    expect(t.visit).toBeNull();
    expect(t.aspiration).not.toBeNull();
    expect(sim.ctx.statValue('marriages')).toBe(1);
    applySocialResult(sim.ctx, t, a, def('social_breakUp'), true);
    expect(r.married || r.partners || r.engaged).toBe(false);
    expect(r.friendship).toBe(80 - 40);
    expect(r.romance).toBeLessThanOrEqual(40);
    expect(sim.ctx.hasMoodlet(a, 'heartbroken')).toBe(true);
  });

  it('move-in respects the cap even if the gate passed earlier', () => {
    const { sim, a, def } = pair();
    const t = sim.addAgent({ firstName: 'Silas', role: 'townie' });
    t.visit = { arrivedTick: 0, leaveTick: 9999, reason: 'invited', welcomed: true, leaving: false };
    for (let i = 0; i < 6; i++) sim.addAgent({ firstName: `Filler${i}` });
    applySocialResult(sim.ctx, a, t, def('social_moveIn'), true);
    expect(t.role).toBe('townie');
    expect(sim.notifications().join('\n')).toMatch(/full/);
  });

  it('bite: preservation −2 always, fun + Love Nibble on success, Bitten on failure', () => {
    const { sim, a, b, def } = pair();
    Object.assign(sim.ctx.rel(a.id, b.id), { met: true, friendship: 50 });
    b.needs.preservation = 50;
    b.needs.fun = 40;
    applySocialResult(sim.ctx, a, b, def('social_playfulBite'), true);
    expect(b.needs.preservation).toBe(48);
    expect(b.needs.fun).toBe(50);
    expect(sim.ctx.hasMoodlet(b, 'nibbled')).toBe(true);
    applySocialResult(sim.ctx, a, b, def('social_playfulBite'), false);
    expect(b.needs.preservation).toBe(46);
    expect(sim.ctx.hasMoodlet(b, 'bitten')).toBe(true);
  });

  it('best friends flag + moodlet', () => {
    const { sim, a, b, def } = pair();
    Object.assign(sim.ctx.rel(a.id, b.id), { met: true, friendship: 80 });
    applySocialResult(sim.ctx, a, b, def('social_bestFriends'), true);
    expect(sim.ctx.rel(a.id, b.id).bestFriends).toBe(true);
    expect(relationshipLabel(sim.ctx.rel(a.id, b.id))).toBe('Best Friend');
    expect(sim.ctx.hasMoodlet(b, 'bestFriendsForever')).toBe(true);
  });

  it('welcome, wave over, invite to stay, ask to leave drive the visitor lifecycle', () => {
    const { sim, a, def } = pair();
    const v = sim.addAgent({ firstName: 'Percival', role: 'townie' });
    v.visit = { arrivedTick: 0, leaveTick: 100, reason: 'dropIn', welcomed: false, leaving: false };
    applySocialResult(sim.ctx, a, v, def('social_welcome'), true);
    expect(v.visit.welcomed).toBe(true);
    expect(sim.ctx.rel(a.id, v.id).met).toBe(true);
    applySocialResult(sim.ctx, a, v, def('social_inviteStay'), true);
    expect(v.visit.leaveTick).toBe(100 + 180 * 4);
    applySocialResult(sim.ctx, a, v, def('social_askToLeave'), true);
    expect(v.visit.leaving).toBe(true);
    expect(v.queue.some((q) => q.interactionId === 'visit_leave')).toBe(true);

    const w = sim.addAgent({ firstName: 'Wanda', role: 'townie' });
    w.walkBy = { from: { x: 0.5, z: 28.5 }, to: { x: 29.5, z: 28.5 }, startedTick: 0 };
    applySocialResult(sim.ctx, a, w, def('social_waveOver'), true);
    expect(w.walkBy).toBeNull();
    expect(w.visit).toMatchObject({ reason: 'walkBy', welcomed: false, leaving: false });
    expect(w.queue[0].interactionId).toBe('visit_waitAtDoor');
  });

  it('failed waveOver/askToLeave leave the target as they were', () => {
    const { sim, a, def } = pair();
    const w = sim.addAgent({ firstName: 'Wanda', role: 'townie' });
    w.walkBy = { from: { x: 0.5, z: 28.5 }, to: { x: 29.5, z: 28.5 }, startedTick: 0 };
    applySocialResult(sim.ctx, a, w, def('social_waveOver'), false);
    expect(w.walkBy).not.toBeNull();
    const v = sim.addAgent({ firstName: 'Percy', role: 'townie' });
    v.visit = { arrivedTick: 0, leaveTick: 100, reason: 'dropIn', welcomed: true, leaving: false };
    applySocialResult(sim.ctx, a, v, def('social_askToLeave'), false);
    expect(v.visit.leaving).toBe(false);
  });

  it('Hothead targets stay Furious twice as long', () => {
    const { sim, a, b, def } = pair({ traitsB: ['hothead'] });
    sim.ctx.rel(a.id, b.id).met = true;
    applySocialResult(sim.ctx, a, b, def('social_argue'), true);
    const f = b.moodlets.find((m) => m.id === 'furious')!;
    expect(f.endTick).toBe(sim.state.tick + 180 * 2 * 4);
  });
});

describe('social behaviour lifecycle', () => {
  it('rolls once at startStage, applies once at completeStage, never throws on a vanished target', () => {
    const { sim, a, b } = pair();
    sim.ctx.rel(a.id, b.id).met = true;
    const beh = sim.behavior('social');
    const def = sim.ctx.content.interactions.social_chat;
    const run = sim.makeRun(a, 'social_chat', { kind: 'agent', id: b.id });
    expect(beh.begin!(sim.ctx, a, run, def)).toBeNull();
    expect(beh.startStage!(sim.ctx, a, run, def, 0)).toBeNull();
    const rolled = run.data.success;
    expect(typeof rolled).toBe('boolean');
    beh.startStage!(sim.ctx, a, run, def, 0);
    expect(run.data.success).toBe(rolled);
    for (let i = 0; i < 40; i++) {
      run.elapsed += 0.25;
      beh.tick!(sim.ctx, a, run, def, 0.25);
    }
    expect(run.data.reacted).toBe(true);
    const f0 = sim.ctx.rel(a.id, b.id).friendship;
    beh.completeStage!(sim.ctx, a, run, def, 0);
    const f1 = sim.ctx.rel(a.id, b.id).friendship;
    expect(f1).not.toBe(f0);
    beh.completeStage!(sim.ctx, a, run, def, 0);
    beh.end!(sim.ctx, a, run, def, 'canceled');
    expect(sim.ctx.rel(a.id, b.id).friendship).toBe(f1);
    // vanished target
    const run2 = sim.makeRun(a, 'social_chat', { kind: 'agent', id: 'a99999' });
    expect(beh.begin!(sim.ctx, a, run2, def)).toMatch(/not here/);
    expect(beh.tick!(sim.ctx, a, run2, def, 0.25)).toBe('done');
    expect(() => beh.completeStage!(sim.ctx, a, run2, def, 0)).not.toThrow();
    expect(sim.events.some((e) => e.type === 'voice')).toBe(true);
    expect(sim.events.some((e) => e.type === 'bubble')).toBe(true);
  });

  it('a cancel after the reaction still applies the result exactly once; before it, nothing', () => {
    const { sim, a, b } = pair();
    sim.ctx.rel(a.id, b.id).met = true;
    const beh = sim.behavior('social');
    const def = sim.ctx.content.interactions.social_chat;
    const early = sim.makeRun(a, 'social_chat', { kind: 'agent', id: b.id });
    beh.startStage!(sim.ctx, a, early, def, 0);
    beh.end!(sim.ctx, a, early, def, 'canceled');
    expect(sim.ctx.rel(a.id, b.id).interactions).toBe(0);
    const late = sim.makeRun(a, 'social_chat', { kind: 'agent', id: b.id });
    beh.startStage!(sim.ctx, a, late, def, 0);
    late.elapsed = 7;
    beh.tick!(sim.ctx, a, late, def, 0.25);
    beh.end!(sim.ctx, a, late, def, 'canceled');
    beh.end!(sim.ctx, a, late, def, 'canceled');
    expect(sim.ctx.rel(a.id, b.id).interactions).toBe(1);
  });

  it('available() hides status-gated socials but lets the engine grey friendship-gated ones', () => {
    const { sim, a, b } = pair();
    sim.ctx.rel(a.id, b.id).met = true;
    const beh = sim.behavior('social');
    expect(beh.available!(sim.ctx, a, sim.ctx.content.interactions.social_hug, { kind: 'agent', id: b.id })).toBe(true);
    expect(beh.available!(sim.ctx, a, sim.ctx.content.interactions.social_propose, { kind: 'agent', id: b.id })).toMatch(/partners/);
    expect(beh.available!(sim.ctx, a, sim.ctx.content.interactions.social_chat, { kind: 'self' })).toMatch(/someone/);
  });

  it('adjustScore discourages cheating and insulting friends, encourages welcoming', () => {
    const { sim, a, b } = pair();
    const c = sim.addAgent({ firstName: 'Third', role: 'townie' });
    Object.assign(sim.ctx.rel(a.id, c.id), { met: true, partners: true });
    Object.assign(sim.ctx.rel(a.id, b.id), { met: true, friendship: 50, romance: 50 });
    const beh = sim.behavior('social');
    const ix = sim.ctx.content.interactions;
    expect(beh.adjustScore!(sim.ctx, a, ix.social_flirt, { kind: 'agent', id: b.id }, 20)).toBeLessThan(0);
    expect(beh.adjustScore!(sim.ctx, a, ix.social_flirt, { kind: 'agent', id: c.id }, 20)).toBeGreaterThan(20);
    expect(beh.adjustScore!(sim.ctx, a, ix.social_insultDecay, { kind: 'agent', id: b.id }, 20)).toBeLessThan(20);
    const v = sim.addAgent({ firstName: 'Visitor', role: 'townie' });
    v.visit = { arrivedTick: 0, leaveTick: 9999, reason: 'dropIn', welcomed: false, leaving: false };
    sim.state.tick = 60 * 4;
    expect(beh.adjustScore!(sim.ctx, a, ix.social_welcome, { kind: 'agent', id: v.id }, 10)).toBeCloseTo(30, 6);
    expect(beh.adjustScore!(sim.ctx, a, ix.social_welcome, { kind: 'agent', id: v.id }, NaN)).toBe(0);
  });
});

describe('relationship drift + labels', () => {
  it('friendship drifts toward 0 (1/day, 2/day at ≥60), romance −2/day without romance, once per day', () => {
    const { sim, a, b } = pair();
    const c = sim.addAgent({ firstName: 'C', role: 'townie' });
    const d = sim.addAgent({ firstName: 'D', role: 'townie' });
    const r1 = Object.assign(sim.ctx.rel(a.id, b.id), { met: true, friendship: 10, romance: 10, lastInteractionTick: 0 });
    const r2 = Object.assign(sim.ctx.rel(a.id, c.id), { met: true, friendship: 70, lastInteractionTick: 0 });
    const r3 = Object.assign(sim.ctx.rel(a.id, d.id), { met: true, friendship: -10, lastInteractionTick: 0 });
    // first midnight is only 15 h after the 09:00 start: no full day without contact yet
    sim.state.tick = at(2, 0);
    dailyDrift(sim.ctx, 2);
    expect(r1.friendship).toBe(10);
    sim.state.tick = at(3, 0);
    dailyDrift(sim.ctx, 3);
    dailyDrift(sim.ctx, 3);
    expect(r1.friendship).toBe(9);
    expect(r1.romance).toBe(8);
    expect(r2.friendship).toBe(68);
    expect(r3.friendship).toBe(-9);
    // a recent interaction blocks friendship drift; a recent romantic one blocks romance drift
    r1.lastInteractionTick = sim.state.tick + 10 * HOUR;
    sim.state.tick = at(4, 0);
    dailyDrift(sim.ctx, 4);
    expect(r1.friendship).toBe(9);
    expect(r1.romance).toBe(6);
  });

  it('drift never crosses zero and repairs NaN', () => {
    const { sim, a, b } = pair();
    const r = Object.assign(sim.ctx.rel(a.id, b.id), { met: true, friendship: 0.5, romance: NaN, lastInteractionTick: NaN });
    sim.state.tick = at(3, 0);
    dailyDrift(sim.ctx, 3);
    expect(r.friendship).toBe(0);
    expect(r.romance).toBe(0);
  });

  it('labels follow GDD thresholds', () => {
    const { sim, a, b } = pair();
    const r = sim.ctx.rel(a.id, b.id);
    expect(labelBetween(sim.ctx, a.id, b.id)).toBe('Stranger');
    r.met = true;
    const cases: [number, string][] = [[0, 'Acquaintance'], [35, 'Friend'], [60, 'Good Friend'], [-35, 'Disliked'], [-70, 'Nemesis'], [-20, 'Acquaintance']];
    for (const [f, label] of cases) {
      r.friendship = f;
      expect(labelBetween(sim.ctx, a.id, b.id), String(f)).toBe(label);
    }
    r.friendship = 40;
    r.romance = 30;
    expect(labelBetween(sim.ctx, a.id, b.id)).toBe('Friend · Crush');
    r.partners = true;
    expect(labelBetween(sim.ctx, a.id, b.id)).toBe('Partner');
    r.engaged = true;
    expect(labelBetween(sim.ctx, a.id, b.id)).toBe('Fiancé(e)');
    r.married = true;
    expect(labelBetween(sim.ctx, a.id, b.id)).toBe('Spouse');
    expect(labelBetween(sim.ctx, a.id, a.id)).toBe('Stranger');
  });

  it('SocialApi.relationships lists met agents (no service NPCs), partners first', () => {
    const { sim, a, b } = pair();
    const t = sim.addAgent({ firstName: 'Townie', role: 'townie', presence: 'offLot' });
    const s = sim.addAgent({ firstName: 'Pizza', role: 'service' });
    Object.assign(sim.ctx.rel(a.id, b.id), { met: true, friendship: 90 });
    Object.assign(sim.ctx.rel(a.id, t.id), { met: true, friendship: 10, partners: true });
    Object.assign(sim.ctx.rel(a.id, s.id), { met: true, friendship: 50 });
    const api = sim.api('social');
    sim.systems[0].tick!(sim.ctx, 0.25); // bind ctx
    const views = api.relationships(a.id);
    expect(views.map((v: { otherId: string }) => v.otherId)).toEqual([t.id, b.id]);
    expect(views[0]).toMatchObject({ label: 'Partner', inHousehold: false, onLot: false });
    expect(views[1]).toMatchObject({ label: 'Good Friend', inHousehold: true, onLot: true, friendship: 90 });
    expect(api.label(a.id, b.id)).toBe('Good Friend');
    expect(api.relationships('nope')).toEqual([]);
    expect(api.label(undefined, null)).toBe('Stranger');
  });
});
