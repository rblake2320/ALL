/**
 * W-116 (D-061) story-arc credit on the REAL modules: an Act 1 step that becomes active is credited at once with what
 * the player already did since this world's arc began ("Already done — nice"):
 *  - every beat done up front (before the mailbox) completes the whole act with no further player command, in order,
 *    each beat paid exactly once;
 *  - partial credit (1 of 2 friendly chats) shows as credited progress and needs only the rest;
 *  - nothing done BEFORE the arc began is credited; the event that finishes a step never also credits the next one;
 *    duplicate deliveries count once;
 *  - replay and save/reload mid-log give the identical stream; the profile ledger pays each key once;
 *  - classic worlds never get an arc log; an Act 1 save written before W-116 loads byte-identically.
 */
import { describe, expect, it } from 'vitest';
import type { Command, QuestDef, SimEvent } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { ACT1_QUEST_IDS } from '../../../src/sim/content/quests';
import { QUESTS_SYSTEM_ID } from '../../../src/sim/systems/quests';
import type { EngineSimulation } from '../../../src/sim/engine';
import { validateWorld } from '../../../src/persistence/validation';
import { EconomyService } from '../../../src/economy/service';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { newWorld, opts, run, simOf, systemsWithQuests } from './helpers';
import { BACK_ROOM, buyAt, LAYOUT, MAIN_ROOM, objectOf } from './act1Driver';

type Sim = EngineSimulation;
const QUEST_EV = new Set(['questStarted', 'questProgress', 'questCompleted']);

function derelict(seed: number, systems = systemsWithQuests()) {
  return { sim: simOf(newWorld({ ...opts(seed, 2), lotTemplate: 'derelict' }, systems), systems), systems };
}

/** Step until `done` (or `max` ticks); returns the quest events seen. */
function stepUntil(sim: Sim, done: (s: Sim) => boolean, max: number, out: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < max && !done(sim); i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (QUEST_EV.has(e.type)) out.push(e);
  }
  return out;
}

/** Queue and wait for one player interaction to complete (returns whether it completed). */
function doIt(sim: Sim, cmd: Extract<Command, { type: 'queue' }>, max = 2400, log: SimEvent[] = []): boolean {
  const r = sim.dispatch(cmd);
  if (!r.ok) return false;
  let ok = false;
  for (let i = 0; i < max && !ok; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (QUEST_EV.has(e.type)) log.push(e);
      if (e.type === 'interactionCompleted' && e.agentId === cmd.actorId && e.interactionId === cmd.interactionId) ok = true;
    }
  }
  return ok;
}

const done = (sim: Sim, id: string) => (sim.state.quests!.completions[id] ?? 0) > 0;

/** Every Act 1 action done while only the first beat (the mailbox) is active. Returns the quest events seen. */
function everythingFirst(sim: Sim): SimEvent[] {
  const log: SimEvent[] = [];
  const [a, b] = sim.state.household.memberIds;
  sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } }); // autonomy would read the mail on its own
  // the builds: kitchen, shower, a 4-segment fence, furniture, decorations for the back room
  expect(buyAt(sim, 'fridge_humming', LAYOUT.fridge[0], LAYOUT.fridge[1], LAYOUT.fridge[2], MAIN_ROOM)).not.toBeNull();
  expect(buyAt(sim, 'microwave_nuke', LAYOUT.microwave[0], LAYOUT.microwave[1], LAYOUT.microwave[2], MAIN_ROOM)).not.toBeNull();
  expect(buyAt(sim, 'shower_drizzle', LAYOUT.shower[0], LAYOUT.shower[1], LAYOUT.shower[2], BACK_ROOM)).not.toBeNull();
  expect(sim.build.apply({ type: 'addWalls', edges: ['h:20:22', 'h:21:22', 'h:22:22', 'h:23:22'] }).ok).toBe(true);
  sim.dispatch({ type: 'endBuildSession' });
  for (const [d, x, z, r] of LAYOUT.furnish) expect(buyAt(sim, d, x, z, r), d).not.toBeNull();
  for (const [d, x, z, r] of LAYOUT.decor) buyAt(sim, d, x, z, r);
  expect(buyAt(sim, 'plant_deadfern', 15, 17, 0)).not.toBeNull();
  // a bill, paid on time
  const billId = sim.engine.ctx.sys('economy').issueBill() as string | null;
  expect(billId).toBeTruthy();
  const mb = objectOf(sim, 'mailbox_crooked')!;
  expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_payBills', target: { kind: 'object', id: mb } }, 2400, log)).toBe(true);
  // the event beats: nap in the coffin, a hot burrito, a shower, Freshness, two friendly chats
  const coffin = objectOf(sim, 'coffin_pine')!;
  expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_sleep', target: { kind: 'object', id: coffin } }, 4000, log)).toBe(true);
  expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_microwaveBurrito', target: { kind: 'object', id: objectOf(sim, 'microwave_nuke')! } }, 2400, log)).toBe(true);
  expect(doIt(sim, { type: 'queue', actorId: b, interactionId: 'home_shower', target: { kind: 'object', id: objectOf(sim, 'shower_drizzle')! } }, 2400, log)).toBe(true);
  expect(doIt(sim, { type: 'queue', actorId: b, interactionId: 'home_grabSpray', target: { kind: 'object', id: objectOf(sim, 'fridge_humming')! } }, 2400, log)).toBe(true);
  for (let i = 0; i < 2; i++) expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'social_chat', target: { kind: 'agent', id: b } }, 2400, log), `chat ${i}`).toBe(true);
  return log;
}

/** Then read the mail and let the act run on its own (no further player command). */
function thenClaim(sim: Sim, log: SimEvent[]): SimEvent[] {
  const [a] = sim.state.household.memberIds;
  sim.dispatch({ type: 'setSettings', settings: { autonomy: 'full' } });
  expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: objectOf(sim, 'mailbox_crooked')! } }, 2400, log)).toBe(true);
  stepUntil(sim, (s) => ACT1_QUEST_IDS.every((id) => done(s, id)), TICKS_PER_DAY, log);
  return log;
}

const cache = new Map<number, { sim: Sim; early: SimEvent[]; log: SimEvent[]; counts: Record<string, number>; active: string[] }>();
function creditedRun(seed = 81) {
  const hit = cache.get(seed);
  if (hit) return hit;
  const { sim } = derelict(seed);
  const early = everythingFirst(sim);
  const counts = JSON.parse(JSON.stringify(sim.state.quests!.arcLog!.counts)) as Record<string, number>;
  const active = sim.state.quests!.active.map((x) => x.questId);
  const log = thenClaim(sim, [...early]);
  const r = { sim, early, log, counts, active };
  cache.set(seed, r);
  return r;
}

describe('W-116 arc credit: every Act 1 beat done before it is active', () => {
  it('nothing completes early; the arc log holds one count per EVENT step (capped at its target)', () => {
    const { early, counts, active, sim } = creditedRun();
    expect(early.filter((e) => e.type === 'questCompleted' || e.type === 'questStarted')).toEqual([]);
    expect(active.filter((id) => id.startsWith('act1_'))).toEqual(['act1_claim']);
    expect(counts).toEqual({ 'act1_rest#sleep': 1, 'act1_hunger#eat': 1, 'act1_scrub#wash': 1, 'act1_scrub#preserve': 1, 'act1_neighbour#friendly': 2 });
    expect(sim.state.quests!.arcLog!.startTick).toBe(0);
  }, 300_000);

  it('after the mailbox the whole act completes on its own, strictly in order, each beat exactly once, all credited', () => {
    const { sim, log } = creditedRun();
    const q = sim.state.quests!;
    for (const id of ACT1_QUEST_IDS) expect(q.completions[id], id).toBe(1);
    const order = log.filter((e) => e.type === 'questCompleted' && e.questId.startsWith('act1_')).map((e) => (e as { questId: string }).questId);
    expect(order).toEqual([...ACT1_QUEST_IDS]);
    // every EVENT step after the mailbox was credited from the log (not re-done)
    const credited = log.filter((e): e is Extract<SimEvent, { type: 'questProgress' }> => e.type === 'questProgress' && typeof e.credited === 'number');
    const keys = credited.map((e) => `${e.questId}#${e.stepId}:${e.credited}`);
    expect(keys).toEqual(['act1_rest#sleep:1', 'act1_hunger#eat:1', 'act1_scrub#wash:1', 'act1_scrub#preserve:1', 'act1_neighbour#friendly:2']);
    for (const e of credited) expect(e.stepDone, e.stepId).toBe(true);
    // the state beats counted what was built / bought / paid since the arc began
    expect(q.grants.filter((g) => g.questId.startsWith('act1_')).map((g) => g.questId)).toEqual([...ACT1_QUEST_IDS]);
    // the log is pruned: no counts left for finished beats
    expect(q.arcLog!.counts).toEqual({});
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  }, 300_000);

  it('replay: the same seed and script give the identical quest stream and quest state', () => {
    const a = creditedRun(81);
    const { sim } = derelict(81);
    const log = thenClaim(sim, everythingFirst(sim));
    expect(JSON.stringify(log)).toBe(JSON.stringify(a.log));
    expect(JSON.stringify(sim.state.quests)).toBe(JSON.stringify(a.sim.state.quests));
  }, 300_000);

  it('save/reload with a full arc log (before the mailbox) continues to the identical stream', () => {
    const a = creditedRun(81);
    const { sim, systems } = derelict(81);
    const early = everythingFirst(sim);
    expect(Object.keys(sim.state.quests!.arcLog!.counts).sort()).toEqual(['act1_hunger#eat', 'act1_neighbour#friendly', 'act1_rest#sleep', 'act1_scrub#preserve', 'act1_scrub#wash']);
    expect(sim.state.quests!.arcLog!.counts['act1_neighbour#friendly']).toBe(2);
    const saved = JSON.stringify(sim.serialize());
    // the persistence schema keeps the log intact with zero issues
    const v = validateWorld(JSON.parse(saved));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.issues).toEqual([]);
      expect(JSON.stringify(v.world.quests!.arcLog)).toBe(JSON.stringify(sim.state.quests!.arcLog));
    }
    const reloaded = simOf(JSON.parse(saved) as WorldState, systems);
    expect(JSON.stringify(reloaded.serialize())).toBe(saved);
    const log = thenClaim(reloaded, [...early]);
    expect(JSON.stringify(log)).toBe(JSON.stringify(a.log));
    expect(JSON.stringify(reloaded.state.quests)).toBe(JSON.stringify(a.sim.state.quests));
  }, 300_000);

  it('the profile ledger pays each Act 1 key ONCE (credited beats included), replays add nothing', async () => {
    const backend = createMemoryBackend();
    const now = () => Date.parse('2026-11-06T12:00:00Z');
    const profile = new ProfileStoreImpl(() => Promise.resolve(backend), { logger: { warn: () => undefined }, now });
    let r = 7;
    const svc = new EconomyService({ backend: () => Promise.resolve(backend), profile, now, randomU32: () => (r = (r * 1103515245 + 12345) >>> 0), logger: { warn: () => undefined, error: () => undefined } as never, broadcast: false });
    await svc.init();
    const a = creditedRun(81);
    svc.registerNewWorld(a.sim.state);
    svc.onSimEvents({ state: a.sim.state }, a.log);
    await svc.idle();
    const bones = svc.wallet.bones;
    svc.onSimEvents({ state: a.sim.state }, a.log);
    svc.onSimEvents({ state: JSON.parse(JSON.stringify(a.sim.state)) as WorldState }, a.log);
    await svc.idle();
    expect(svc.wallet.bones).toBe(bones);
    const entries = svc.ledgerSnapshot!.entries;
    for (const id of ACT1_QUEST_IDS) expect(entries.filter((e) => e.key === `profile:${id}:1`), id).toHaveLength(1);
    expect(entries.filter((e) => e.key.startsWith('profile:act1_')).reduce((s, e) => s + e.amount, 0)).toBe(340);
    svc.dispose();
  }, 300_000);
});

// ── small arcs over the same mechanism (fast, targeted) ──
const mk = (id: string, steps: QuestDef['steps'], requires?: string[]): QuestDef => ({
  id,
  order: 0.01 + ACT1_QUEST_IDS.length,
  category: 'story',
  arc: 'act1',
  title: id,
  description: id,
  icon: 'mail',
  steps,
  reward: { bones: 1 },
  ...(requires ? { requires } : {}),
});
const MAIL: QuestDef['steps'][number] = { id: 'mail', label: 'mail', objective: { kind: 'interaction', ids: ['home_checkMail'], count: 1 } };
const mini = (second: QuestDef['steps']) => [mk('t_first', [MAIL]), { ...mk('t_second', second, ['t_first']), order: 0.02 }];

describe('W-116 arc credit: adversarial', () => {
  it('partial credit: one of two friendly chats done early → the step starts at 1/2 (credited), one more finishes it', () => {
    const systems = systemsWithQuests(mini([{ id: 'friendly', label: 'Be friendly twice', objective: { kind: 'interaction', tags: ['friendly'], count: 2 } }]));
    const { sim } = derelict(91, systems);
    const [a, b] = sim.state.household.memberIds;
    sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
    expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'social_chat', target: { kind: 'agent', id: b } })).toBe(true);
    const log: SimEvent[] = [];
    expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: objectOf(sim, 'mailbox_crooked')! } }, 2400, log)).toBe(true);
    const inst = sim.state.quests!.active.find((x) => x.questId === 't_second')!;
    expect(inst.step).toMatchObject({ progress: 1, credited: 1, done: false });
    expect(log.find((e) => e.type === 'questProgress' && e.questId === 't_second')).toMatchObject({ progress: 1, target: 2, stepDone: false, credited: 1 });
    const view = sim.quests!()!.active.find((v) => v.questId === 't_second')!;
    expect(view.steps[0]).toMatchObject({ progress: 1, target: 2, credited: true, current: true });
    expect(sim.state.quests!.arcLog!.counts).toEqual({}); // consumed
    expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'social_chat', target: { kind: 'agent', id: b } }, 2400, log)).toBe(true);
    expect(done(sim, 't_second')).toBe(true);
    expect(log.filter((e) => e.type === 'questCompleted' && e.questId === 't_second')).toHaveLength(1);
  }, 120_000);

  it('the event that finishes a step never also credits the step it starts (two mail steps need two mail checks)', () => {
    const systems = systemsWithQuests(mini([{ id: 'mail2', label: 'mail again', objective: { kind: 'interaction', ids: ['home_checkMail'], count: 1 } }]));
    const { sim } = derelict(92, systems);
    const [a] = sim.state.household.memberIds;
    sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
    const mb = objectOf(sim, 'mailbox_crooked')!;
    expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: mb } })).toBe(true);
    expect(done(sim, 't_first')).toBe(true);
    expect(sim.state.quests!.active.find((x) => x.questId === 't_second')!.step).toMatchObject({ progress: 0, done: false });
    expect(sim.state.quests!.active.find((x) => x.questId === 't_second')!.step.credited).toBeUndefined();
    expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: mb } })).toBe(true);
    expect(done(sim, 't_second')).toBe(true);
  }, 120_000);

  it('a duplicate delivery of the same event is logged once', () => {
    const systems = systemsWithQuests(mini([{ id: 'friendly', label: 'f', objective: { kind: 'interaction', tags: ['friendly'], count: 2 } }]));
    const { sim } = derelict(93, systems);
    const [a, b] = sim.state.household.memberIds;
    const ev: SimEvent = { type: 'interactionCompleted', uid: 999_001, agentId: a, interactionId: 'social_chat', targetId: b, source: 'player', household: true, params: {} };
    sim.engine.ctx.emit(ev);
    sim.engine.ctx.emit({ ...ev });
    expect(sim.state.quests!.arcLog!.counts['t_second#friendly']).toBe(1);
    sim.engine.ctx.emit({ ...ev, uid: 999_002 });
    expect(sim.state.quests!.arcLog!.counts['t_second#friendly']).toBe(2);
    sim.engine.ctx.emit({ ...ev, uid: 999_003 }); // capped at the target
    expect(sim.state.quests!.arcLog!.counts['t_second#friendly']).toBe(2);
    // visitors / non-household actors never count
    sim.engine.ctx.emit({ ...ev, uid: 999_004, household: false });
    expect(sim.state.quests!.arcLog!.seen).not.toContain(`ic:999004:${a}`);
  });

  it('NOTHING done before the arc began is credited (a classic world converted later starts its log fresh)', () => {
    const systems = systemsWithQuests(mini([{ id: 'friendly', label: 'f', objective: { kind: 'interaction', tags: ['friendly'], count: 2 } }]));
    const w = newWorld(opts(94, 2), systems); // starter lot: no arc
    const pre = simOf(w, systems);
    const [a, b] = pre.state.household.memberIds;
    pre.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
    expect(pre.state.quests!.arcLog).toBeUndefined();
    for (let i = 0; i < 2; i++) expect(doIt(pre, { type: 'queue', actorId: a, interactionId: 'social_chat', target: { kind: 'agent', id: b } })).toBe(true);
    expect(pre.state.quests!.arcLog).toBeUndefined(); // classic worlds never log
    // the arc begins NOW (hand-converted save): the earlier chats are history
    const s = pre.serialize();
    s.flags.storyArc = 'act1';
    delete (s as { quests?: unknown }).quests;
    const sim = simOf(s, systems);
    expect(sim.state.quests!.arcLog).toMatchObject({ arc: 'act1', startTick: s.tick, counts: {} });
    expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: objectOf(sim, 'mailbox_crooked')! } })).toBe(true);
    expect(sim.state.quests!.active.find((x) => x.questId === 't_second')!.step).toMatchObject({ progress: 0, done: false });
  }, 120_000);

  it('state beats: walls / fresh furniture count from the arc start, but still hold their minutes; old stuff never counts', () => {
    const wallsStep: QuestDef['steps'] = [{ id: 'walls', label: 'w', objective: { kind: 'walls', count: 4, holdMin: 15 } }];
    const systems = systemsWithQuests(mini(wallsStep));
    const { sim } = derelict(95, systems);
    const wallsAtStart = Object.keys(sim.state.lot.walls).length;
    expect(sim.state.quests!.arcLog).toMatchObject({ walls: wallsAtStart, startTick: 0 });
    expect(sim.build.apply({ type: 'addWalls', edges: ['h:20:22', 'h:21:22', 'h:22:22', 'h:23:22'] }).ok).toBe(true);
    sim.dispatch({ type: 'endBuildSession' });
    sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
    const [a] = sim.state.household.memberIds;
    expect(doIt(sim, { type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: objectOf(sim, 'mailbox_crooked')! } })).toBe(true);
    const inst = sim.state.quests!.active.find((x) => x.questId === 't_second')!;
    expect(inst.step.baseline).toBe(wallsAtStart);
    expect(done(sim, 't_second')).toBe(false); // the hold runs from the step start
    stepUntil(sim, (x) => done(x, 't_second'), 15 * 4 + 8);
    expect(done(sim, 't_second')).toBe(true);
  }, 120_000);
});

describe('W-116 arc credit: compatibility (D-019)', () => {
  it('classic worlds never get an arc log (a game day of play)', () => {
    const systems = systemsWithQuests();
    const sim = simOf(newWorld(opts(96), systems), systems);
    run(sim, Math.floor(TICKS_PER_DAY / 2));
    expect(sim.state.quests!.arcLog).toBeUndefined();
    expect(JSON.stringify(sim.serialize())).not.toContain('arcLog');
  }, 120_000);

  it('an Act 1 save written before W-116 (no arcLog) loads byte-identically; the log starts at its next interaction', () => {
    const { sim, systems } = derelict(97);
    const s = sim.serialize();
    delete (s.quests as { arcLog?: unknown }).arcLog;
    const saved = JSON.stringify(s);
    const loaded = simOf(JSON.parse(saved) as WorldState, systems);
    expect(JSON.stringify(loaded.serialize())).toBe(saved);
    expect(loaded.drainEvents().filter((e) => QUEST_EV.has(e.type))).toEqual([]);
    for (let i = 0; i < 600 && !loaded.state.quests!.arcLog; i++) loaded.step();
    // created lazily by the first logged event, never back-dated
    if (loaded.state.quests!.arcLog) expect(loaded.state.quests!.arcLog.startTick).toBeGreaterThan(s.tick);
    expect(loaded.engine.ctx.sys(QUESTS_SYSTEM_ID).grants()).toEqual([]);
  }, 120_000);
});
