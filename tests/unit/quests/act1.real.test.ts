/**
 * W-113 Act 1 "The Condemned Shack" on the REAL modules (docs/systems/story-start.md §4/§6):
 *  - only derelict-start worlds run the arc (flags.storyArc), classic worlds and old saves are byte-identical;
 *  - every beat completes from real sim events/state, strictly in order, and early actions never count;
 *  - save/reload mid-arc and replay give the identical stream; the profile ledger never pays twice;
 *  - the classic chain follows the arc via `supersedes`; the validator rejects malformed arcs; `walls` semantics.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectiveDef, QuestDef, SimEvent } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { ACT1_FINALE_ID, ACT1_QUEST_IDS, ACT1_QUESTS, ALL_QUESTS, STORY_QUESTS } from '../../../src/sim/content/quests';
import { healQuestsState, QUESTS_SYSTEM_ID, startObjective, evaluateObjectiveState, validateQuests, type ObjectiveWorld } from '../../../src/sim/systems/quests';
import { loadContent } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { en } from '../../../src/i18n/en';
import { EconomyService } from '../../../src/economy/service';
import { alreadyPaid, profileGrantOf } from '../../../src/economy/grantPolicy';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { jsonClone, newWorld, opts, run, simOf, systemsWithQuests } from './helpers';
import { act1Step, buyAt, driveAct1, LAYOUT, objectOf, type DriveLog } from './act1Driver';

const DEFS = new Map(ALL_QUESTS.map((d) => [d.id, d]));
const content = loadContent();
const SUPERSEDED = ['story_firstMeal', 'story_freshen', 'story_decorate', 'story_bills'];

function derelict(seed = 41, members = 2) {
  const systems = systemsWithQuests();
  const sim = simOf(newWorld({ ...opts(seed, members), lotTemplate: 'derelict' }, systems), systems);
  return { sim, systems };
}

const completedEvents = (log: DriveLog) => log.quest.filter((e): e is Extract<SimEvent, { type: 'questCompleted' }> => e.type === 'questCompleted');
const startedEvents = (log: DriveLog) => log.quest.filter((e): e is Extract<SimEvent, { type: 'questStarted' }> => e.type === 'questStarted');

/** One full scripted Act 1 run (cached per seed: the drive is deterministic, and the suites below only read it). */
const runs = new Map<number, { sim: EngineSimulation; log: DriveLog; ticks: Map<string, number> }>();
function fullRun(seed = 41) {
  const hit = runs.get(seed);
  if (hit) return hit;
  const { sim } = derelict(seed);
  const log: DriveLog = { quest: [], notes: [] };
  const ticks = new Map<string, number>();
  // record the tick each quest completes at (questCompleted is emitted during the step that completes it)
  const origDrain = sim.drainEvents.bind(sim);
  (sim as { drainEvents: () => SimEvent[] }).drainEvents = () => {
    const ev = origDrain();
    for (const e of ev) if (e.type === 'questCompleted') ticks.set(e.questId, sim.state.tick);
    return ev;
  };
  driveAct1(sim, TICKS_PER_DAY * 10, log);
  const r = { sim, log, ticks };
  runs.set(seed, r);
  return r;
}

describe('Act 1 content', () => {
  it('8 one-off story beats on arc act1, a strict line, Bones only, text from en.ts (sim and UI share it)', () => {
    expect(ACT1_QUESTS.map((q) => q.id)).toEqual(['act1_claim', 'act1_rest', 'act1_hunger', 'act1_scrub', 'act1_patch', 'act1_curb', 'act1_neighbour', 'act1_lease']);
    expect(ACT1_FINALE_ID).toBe('act1_lease');
    ACT1_QUESTS.forEach((q, i) => {
      expect(q.arc).toBe('act1');
      expect(q.category).toBe('story');
      expect(q.repeat).toBeUndefined();
      expect(q.requires ?? []).toEqual(i === 0 ? [] : [ACT1_QUESTS[i - 1].id]);
      expect(Object.keys(q.reward)).toEqual(['bones']);
      const key = q.id.replace('act1_', '');
      expect(q.title).toBe((en as Record<string, string>)[`story.act1.${key}.title`]);
      expect(q.description).toBe((en as Record<string, string>)[`story.act1.${key}.beat`]);
      for (const s of q.steps) expect(s.label).toBe((en as Record<string, string>)[`story.act1.${key}.step.${s.id}`]);
      expect(q.description.length).toBeLessThanOrEqual(160); // a short narrative line
    });
    // every Act 1 beat sorts ahead of the classic chain (story slots go to the arc first)
    expect(Math.max(...ACT1_QUESTS.map((q) => q.order ?? 0))).toBeLessThan(Math.min(...STORY_QUESTS.map((q) => q.order ?? 0)));
    expect(ACT1_QUESTS.flatMap((q) => q.supersedes ?? []).sort()).toEqual([...SUPERSEDED].sort());
    const bones = ACT1_QUESTS.reduce((s, q) => s + q.reward.bones, 0);
    expect(bones).toBe(340);
    // in line with the classic one-off story rewards (30..100 each)
    for (const q of ACT1_QUESTS) expect(q.reward.bones).toBeGreaterThanOrEqual(20), expect(q.reward.bones).toBeLessThanOrEqual(100);
  });

  it('the shipped quest content validates (arcs, supersedes and the new walls kind included)', () => {
    expect(validateQuests(ALL_QUESTS, content)).toEqual([]);
  });

  it('ADVERSARIAL validator: malformed arcs are rejected', () => {
    const base = ACT1_QUESTS[0];
    const mk = (over: Partial<QuestDef>): QuestDef => ({ ...jsonClone(base), id: 'x_bad', ...over });
    const errs = (d: QuestDef) => validateQuests([...ALL_QUESTS, d], content).join('\n');
    expect(errs(mk({ arc: undefined, supersedes: ['story_party'] }))).toMatch(/supersedes needs an arc/);
    expect(errs(mk({ supersedes: ['act1_rest'] }))).toMatch(/may only supersede classic story quests/);
    expect(errs(mk({ supersedes: ['n_potluck'] }))).toMatch(/may only supersede classic story quests/);
    expect(errs(mk({ supersedes: ['nope'] }))).toMatch(/supersedes unknown quest/);
    expect(errs(mk({ supersedes: ['story_firstMeal'] }))).toMatch(/already superseded/);
    expect(errs(mk({ arc: 'Act 1!' }))).toMatch(/bad arc/);
    expect(errs(mk({ requires: ['story_getJob'] }))).toMatch(/from outside arc/);
    expect(errs(mk({ category: 'neighbourhood', repeat: { cooldownDays: 1 } }))).toMatch(/only story quests belong to an arc/);
    expect(errs(mk({ steps: [{ id: 'w', label: 'w', objective: { kind: 'walls', count: 0 } }] }))).toMatch(/count must be 1\.\.200/);
  });
});

describe('Act 1 runs only in derelict-start worlds', () => {
  it('a new derelict world: flags.storyArc = act1, the first beat is the only story quest, the classic opening never starts', () => {
    const { sim, systems } = derelict();
    expect(sim.state.flags.storyArc).toBe('act1');
    expect(sim.state.quests!.active.map((a) => a.questId)).toEqual(['act1_claim']);
    const v = sim.quests!()!;
    expect(v.active[0]).toMatchObject({ questId: 'act1_claim', arc: 'act1', category: 'story', title: "Squatter's Rights" });
    // Act 1 (8) + the 6 classic quests it does not replace
    expect(v.story).toEqual({ done: 0, total: 14 });
    // reload: strict no-op
    const saved = JSON.stringify(sim.serialize());
    const loaded = simOf(JSON.parse(saved) as WorldState, systems);
    expect(JSON.stringify(loaded.serialize())).toBe(saved);
    expect(loaded.drainEvents().filter((e) => e.type.startsWith('quest'))).toEqual([]);
    expect(healQuestsState(loaded.state, DEFS)).toEqual([]);
  });

  for (const lot of ['starter', 'empty'] as const) {
    it(`a new ${lot} world runs the classic chain: no arc flag, no Act 1 quest ever`, () => {
      const systems = systemsWithQuests();
      const sim = simOf(newWorld({ ...opts(41), lotTemplate: lot }, systems), systems);
      expect(sim.state.flags.storyArc).toBeUndefined();
      expect(sim.state.quests!.active.map((a) => a.questId)).toEqual(['story_firstMeal']);
      expect(sim.quests!()!.story).toEqual({ done: 0, total: 10 });
      run(sim, TICKS_PER_DAY);
      const ids = [...sim.state.quests!.active.map((a) => a.questId), ...Object.keys(sim.state.quests!.completions)];
      expect(ids.some((id) => id.startsWith('act1_'))).toBe(false);
    }, 120_000);
  }

  it('OLD SAVE: a classic world saved before W-113 loads byte-identically and keeps its classic chain', () => {
    const systems = systemsWithQuests();
    const sim = simOf(newWorld(opts(52), systems), systems);
    run(sim, TICKS_PER_DAY);
    const saved = JSON.stringify(sim.serialize());
    expect(saved).not.toContain('storyArc');
    expect(saved).not.toContain('act1_');
    const loaded = simOf(JSON.parse(saved) as WorldState, systems);
    expect(JSON.stringify(loaded.serialize())).toBe(saved);
    expect(loaded.drainEvents().filter((e) => e.type.startsWith('quest'))).toEqual([]);
    expect(healQuestsState(loaded.state, DEFS)).toEqual([]);
    // and keeps stepping exactly like the uninterrupted world
    for (let i = 0; i < 2000; i++) {
      sim.step();
      loaded.step();
    }
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(sim.serialize()));
  }, 120_000);

  it('ADVERSARIAL: an unknown arc in a (hand-edited) save offers no arc quest and supersedes nothing', () => {
    const systems = systemsWithQuests();
    const w = newWorld(opts(53), systems);
    w.flags.storyArc = 'act9';
    delete (w as { quests?: unknown }).quests;
    const sim = simOf(w, systems);
    expect(sim.state.quests!.active.map((a) => a.questId)).toEqual(['story_firstMeal']);
    expect(sim.quests!()!.story.total).toBe(10);
  });
});

describe('Act 1 played through on the real sim', () => {
  it('every beat completes from real events, in order, each exactly once, then the classic chain follows', () => {
    const { sim, log, ticks } = fullRun();
    const q = sim.state.quests!;
    for (const id of ACT1_QUEST_IDS) expect(q.completions[id], id).toBe(1);
    // strictly in order: completion ticks never go back, and each beat started only after the previous one completed
    // (W-116: a beat already done since the arc began completes in the same tick it starts — e.g. the friendly chats)
    const at = ACT1_QUEST_IDS.map((id) => ticks.get(id)!);
    for (let i = 1; i < at.length; i++) expect(at[i], ACT1_QUEST_IDS[i]).toBeGreaterThanOrEqual(at[i - 1]);
    const order = log.quest.filter((e) => e.type === 'questStarted' || e.type === 'questCompleted').map((e) => `${e.type === 'questStarted' ? '+' : '✓'}${e.questId}`);
    const arc = order.filter((s) => s.includes('act1_'));
    expect(arc).toEqual(ACT1_QUEST_IDS.flatMap((id) => [`+${id}`, `✓${id}`]).slice(1)); // act1_claim started at creation
    // each beat paid once, with its own reward and a stable grant id
    const done = completedEvents(log).filter((e) => e.questId.startsWith('act1_'));
    expect(done.map((e) => e.questId)).toEqual([...ACT1_QUEST_IDS]);
    for (const e of done) expect(e.grant).toEqual({ grantId: `${q.worldId}:${e.questId}:1`, bones: DEFS.get(e.questId)!.reward.bones, reason: `Quest: ${DEFS.get(e.questId)!.title}` });
    // superseded classic quests were never offered in this world
    for (const id of SUPERSEDED) {
      expect(startedEvents(log).some((e) => e.questId === id), id).toBe(false);
      expect(q.completions[id] ?? 0, id).toBe(0);
    }
    // the classic chain followed the arc: the job quest unlocked by the Act 1 meal, the friend quest by the scrub
    const started = (id: string) => log.quest.findIndex((e) => e.type === 'questStarted' && e.questId === id);
    const completedIdx = (id: string) => log.quest.findIndex((e) => e.type === 'questCompleted' && e.questId === id);
    expect(started('story_getJob')).toBeGreaterThan(completedIdx('act1_hunger'));
    expect(started('story_makeFriend')).toBeGreaterThan(completedIdx('act1_scrub'));
    expect(sim.quests!()!.story.done).toBeGreaterThanOrEqual(8);
    // the house was built up along the way (the story builds the home)
    for (const d of ['fridge_humming', 'stove_greasefire', 'shower_drizzle']) expect(objectOf(sim, d), d).not.toBeNull();
    expect(Object.keys(sim.state.lot.walls).length).toBeGreaterThanOrEqual(4 + 34);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  }, 300_000);

  it('the run ends within the first few game days (Act 1 is the first-hour-to-first-bill arc)', () => {
    const { ticks } = fullRun();
    expect(ticks.get('act1_patch')!).toBeLessThan(TICKS_PER_DAY);
    expect(ticks.get(ACT1_FINALE_ID)!).toBeLessThan(TICKS_PER_DAY * 5);
  }, 300_000);

  it('replay: the same seed and script give the identical quest stream and state', () => {
    const a = fullRun(41);
    const { sim: b } = derelict(41);
    const lb: DriveLog = { quest: [], notes: [] };
    driveAct1(b, TICKS_PER_DAY * 10, lb);
    expect(JSON.stringify(lb.quest)).toBe(JSON.stringify(a.log.quest));
    expect(JSON.stringify(b.state.quests)).toBe(JSON.stringify(a.sim.state.quests));
  }, 300_000);

  it('save/reload mid-arc (after The Hunger) continues to the identical stream; reloading the finished world pays nothing again', () => {
    const a = fullRun(41);
    const { sim, systems } = derelict(41);
    const log: DriveLog = { quest: [], notes: [] };
    const mem: Record<string, unknown> = {};
    driveAct1(sim, TICKS_PER_DAY * 10, log, mem, (s) => (s.state.quests!.completions.act1_hunger ?? 0) > 0);
    expect(act1Step(sim)).toBe('act1_scrub#0');
    const reloaded = simOf(JSON.parse(JSON.stringify(sim.serialize())) as WorldState, systems);
    expect(reloaded.drainEvents().filter((e) => e.type.startsWith('quest'))).toEqual([]);
    driveAct1(reloaded, TICKS_PER_DAY * 10, log, mem);
    expect(JSON.stringify(log.quest)).toBe(JSON.stringify(a.log.quest));
    expect(JSON.stringify(reloaded.state.quests)).toBe(JSON.stringify(a.sim.state.quests));
    const grantsBefore = reloaded.engine.ctx.sys(QUESTS_SYSTEM_ID).grants();
    const again = simOf(JSON.parse(JSON.stringify(reloaded.serialize())) as WorldState, systems);
    for (let i = 0; i < 400; i++) again.step();
    expect(again.drainEvents().filter((e) => e.type === 'questCompleted' && e.questId.startsWith('act1_'))).toEqual([]);
    expect(again.engine.ctx.sys(QUESTS_SYSTEM_ID).grants().slice(0, grantsBefore.length)).toEqual(grantsBefore);
  }, 300_000);

  it('the profile ledger pays each beat ONCE: replay, reload/reconcile and a second derelict world add nothing', async () => {
    const backend = createMemoryBackend();
    const now = () => Date.parse('2026-11-06T12:00:00Z');
    const profile = new ProfileStoreImpl(() => Promise.resolve(backend), { logger: { warn: () => undefined }, now });
    let r = 99;
    const svc = new EconomyService({ backend: () => Promise.resolve(backend), profile, now, randomU32: () => (r = (r * 1103515245 + 12345) >>> 0), logger: { warn: () => undefined, error: () => undefined } as never, broadcast: false });
    await svc.init();
    const a = fullRun(41);
    svc.registerNewWorld(a.sim.state);
    svc.onSimEvents({ state: a.sim.state }, a.log.quest);
    await svc.idle();
    const paidOnce = svc.wallet.bones;
    const act1Keys = ACT1_QUEST_IDS.map((id) => `profile:${id}:1`);
    const keys = svc.ledgerSnapshot!.entries.map((e) => e.key);
    for (const k of act1Keys) expect(keys.filter((x) => x === k), k).toHaveLength(1);
    expect(paidOnce).toBeGreaterThanOrEqual(340);
    // the same events again (replay), the world's own grant record (crash-recovery reconcile), a reloaded copy
    svc.onSimEvents({ state: a.sim.state }, a.log.quest);
    const copy = JSON.parse(JSON.stringify(a.sim.state)) as WorldState;
    svc.onSimEvents({ state: copy }, a.log.quest);
    await svc.idle();
    expect(svc.wallet.bones).toBe(paidOnce);
    // a second, different derelict world finishing Act 1 again pays nothing more for those beats
    const b = fullRun(42);
    svc.registerNewWorld(b.sim.state);
    svc.onSimEvents({ state: b.sim.state }, completedEvents(b.log).filter((e) => e.questId.startsWith('act1_')));
    await svc.idle();
    // (world b may still earn its own daily tasks / other quests: only the Act 1 keys are checked here)
    const after = svc.ledgerSnapshot!.entries;
    for (const k of act1Keys) expect(after.filter((x) => x.key === k), k).toHaveLength(1);
    expect(after.filter((x) => act1Keys.includes(x.key)).reduce((sum, x) => sum + x.amount, 0)).toBe(340);
    expect(after.filter((x) => x.key.includes('act1_') && !act1Keys.includes(x.key))).toEqual([]);
    // the pure policy agrees: every Act 1 grant is a one-time, profile-scoped key, already paid now
    const ledgerKeys = new Set(svc.ledgerSnapshot!.entries.map((e) => e.key));
    for (const e of completedEvents(b.log).filter((x) => x.questId.startsWith('act1_'))) {
      const g = profileGrantOf(e.grant, true)!;
      expect(g.cls).toBe('once');
      expect(alreadyPaid(ledgerKeys, g)).toBe(true);
    }
    svc.dispose();
  }, 300_000);
});

describe('Act 1 beats: order-independent credit (W-116, D-061)', () => {
  it('sleeping, buying the kitchen and eating BEFORE the lease letter: each later beat is credited when it starts, paid once, in order', () => {
    const { sim } = derelict(61);
    const [a] = sim.state.household.memberIds;
    // do later beats' actions first (act1_claim is the only active beat)
    const coffin = objectOf(sim, 'coffin_pine')!;
    sim.dispatch({ type: 'queue', actorId: a, interactionId: 'home_sleep', target: { kind: 'object', id: coffin } });
    expect(buyAt(sim, 'fridge_humming', ...(LAYOUT.fridge as unknown as [number, number, 0]))).not.toBeNull();
    expect(buyAt(sim, 'microwave_nuke', ...(LAYOUT.microwave as unknown as [number, number, 0]))).not.toBeNull();
    for (let i = 0; i < 1200; i++) sim.step();
    const mw = objectOf(sim, 'microwave_nuke')!;
    sim.dispatch({ type: 'queue', actorId: a, interactionId: 'home_microwaveBurrito', target: { kind: 'object', id: mw } });
    for (let i = 0; i < 400; i++) sim.step();
    const early = sim.drainEvents();
    const q = sim.state.quests!;
    // nothing completed early: the line still waits on the mailbox, and no later beat ever started
    expect(q.active.map((x) => x.questId)).toEqual(['act1_claim']);
    for (const id of ACT1_QUEST_IDS.slice(1)) expect(q.completions[id] ?? 0, id).toBe(0);
    expect(early.some((e) => e.type === 'questCompleted')).toBe(false);
    expect(q.arcLog!.counts).toMatchObject({ 'act1_rest#sleep': 1, 'act1_hunger#eat': 1 });
    // now claim the shack: The Rest is credited the moment it starts (the earlier coffin nap)
    const mb = objectOf(sim, 'mailbox_crooked')!;
    sim.dispatch({ type: 'queue', actorId: a, interactionId: 'home_checkMail', target: { kind: 'object', id: mb } });
    const seen: SimEvent[] = [];
    for (let i = 0; i < 400 && !(q.completions.act1_claim ?? 0); i++) {
      sim.step();
      seen.push(...sim.drainEvents());
    }
    expect(q.completions.act1_claim).toBe(1);
    expect(q.completions.act1_rest).toBe(1);
    const restDone = seen.findIndex((e) => e.type === 'questCompleted' && e.questId === 'act1_rest');
    const claimDone = seen.findIndex((e) => e.type === 'questCompleted' && e.questId === 'act1_claim');
    expect(restDone).toBeGreaterThan(claimDone);
    expect(seen.find((e) => e.type === 'questProgress' && e.questId === 'act1_rest')).toMatchObject({ stepId: 'sleep', stepDone: true, credited: 1 });
    // The Hunger runs: the owned appliances still hold 15 game minutes each, then the earlier burrito credits the meal
    for (let i = 0; i < 400 && !(q.completions.act1_hunger ?? 0); i++) {
      sim.step();
      seen.push(...sim.drainEvents());
    }
    expect(q.completions.act1_hunger).toBe(1);
    expect(seen.find((e) => e.type === 'questProgress' && e.questId === 'act1_hunger' && e.stepId === 'eat')).toMatchObject({ stepDone: true, credited: 1 });
    // each beat paid exactly once
    for (const id of ['act1_claim', 'act1_rest', 'act1_hunger']) expect(seen.filter((e) => e.type === 'questCompleted' && e.questId === id), id).toHaveLength(1);
    // consumed counts are gone (never credited twice), finished beats leave nothing behind
    expect(Object.keys(q.arcLog!.counts).filter((k) => /^act1_(claim|rest|hunger)#/.test(k))).toEqual([]);
    expect(sim.faults()).toEqual([]);
  }, 120_000);

  it('The Hunger: owning appliances bought earlier counts (fresh: false) but the hot meal must be eaten after the step starts', () => {
    const { sim } = fullRun(41);
    const hunger = DEFS.get('act1_hunger')!;
    expect(hunger.steps.map((s) => s.objective.kind)).toEqual(['own', 'own', 'interaction']);
    expect((hunger.steps[0].objective as Extract<ObjectiveDef, { kind: 'own' }>).fresh).toBe(false);
    // the cold-jerky loophole is closed: the eat step only accepts a served meal or the microwave
    expect((hunger.steps[2].objective as Extract<ObjectiveDef, { kind: 'interaction' }>).targetTags).toEqual(['meal', 'microwave']);
    expect(sim.state.quests!.completions.act1_hunger).toBe(1);
  }, 300_000);
});

describe('walls objective (new kind)', () => {
  const w0 = derelict(71).sim;
  const world = (s: WorldState): ObjectiveWorld => ({ state: s, content, spatial: null, worldId: 'W' });
  const o: ObjectiveDef = { kind: 'walls', count: 4, holdMin: 15 };
  const addWalls = (s: WorldState, keys: string[]) => {
    for (const k of keys) s.lot.walls[k] = { paint: ['wall_exterior_siding', 'wall_exterior_siding'], openingId: null };
  };

  it('counts only segments added after the step started, and only once they have stood for holdMin', () => {
    const s = jsonClone(w0.state);
    const p = startObjective(o, world(s));
    expect(p.baseline).toBe(Object.keys(s.lot.walls).length); // the shack's own walls never count
    addWalls(s, ['h:20:22', 'h:21:22', 'h:22:22']);
    for (let m = 0; m < 30; m++) evaluateObjectiveState(o, p, world(s), 1);
    expect(p).toMatchObject({ progress: 3, done: false });
    addWalls(s, ['h:23:22']);
    for (let m = 0; m < 14; m++) evaluateObjectiveState(o, p, world(s), 1);
    expect(p.done).toBe(false);
    evaluateObjectiveState(o, p, world(s), 1);
    expect(p.done).toBe(true);
  });

  it('ADVERSARIAL: walls removed before the hold reset it (build-and-sell never completes); done latches afterwards', () => {
    const s = jsonClone(w0.state);
    const p = startObjective(o, world(s));
    addWalls(s, ['h:20:22', 'h:21:22', 'h:22:22', 'h:23:22']);
    for (let m = 0; m < 10; m++) evaluateObjectiveState(o, p, world(s), 1);
    for (const k of ['h:22:22', 'h:23:22']) delete s.lot.walls[k];
    evaluateObjectiveState(o, p, world(s), 1);
    expect(p).toMatchObject({ progress: 2, heldMin: 0, done: false });
    addWalls(s, ['h:22:22', 'h:23:22']);
    for (let m = 0; m < 15; m++) evaluateObjectiveState(o, p, world(s), 1);
    expect(p.done).toBe(true);
    for (const k of ['h:20:22', 'h:21:22', 'h:22:22', 'h:23:22']) delete s.lot.walls[k];
    expect(evaluateObjectiveState(o, p, world(s), 1)).toBe(false);
    expect(p.done).toBe(true);
  });

  it('ADVERSARIAL: removing the shack\'s own walls and re-adding them does not count as building', () => {
    const s = jsonClone(w0.state);
    const p = startObjective(o, world(s));
    const own = Object.keys(s.lot.walls).slice(0, 4);
    const saved = own.map((k) => s.lot.walls[k]);
    for (const k of own) delete s.lot.walls[k];
    for (let m = 0; m < 5; m++) evaluateObjectiveState(o, p, world(s), 1);
    own.forEach((k, i) => (s.lot.walls[k] = saved[i]));
    for (let m = 0; m < 30; m++) evaluateObjectiveState(o, p, world(s), 1);
    expect(p).toMatchObject({ progress: 0, done: false });
  });
});
