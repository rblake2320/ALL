/**
 * Regressions found by the balance harness (tests/balance, docs/BALANCE.md) — REAL content.
 *
 * Social / fire-call loop: a household zombie with a critical Fight Fire call queued was still a valid social target.
 * The respond half started, the critical item preempted it within the minute, the actor re-picked the same social
 * and the pair looped — 25 jokes, 23 hugs and 18 gossips in one morning while the kitchen burned (scenario Bc,
 * seed 55, day 12). A target with a critical item waiting is now "busy".
 */
import { describe, expect, it } from 'vitest';
import type { SimContext, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { PRIORITY } from '../../../src/sim/vocabulary';
import { IX } from '../../../src/sim/content/home/ids';
import { targetBusyReason } from '../../../src/sim/engine/socials';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';

function realSim(seed: number, names = ['Mort', 'Ghoulia']): SimulationAPI {
  return createSimulation(
    createNewWorld({
      seed,
      householdName: 'Graves',
      members: names.map((firstName) => ({ firstName, lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null })),
      lotTemplate: 'starter',
      difficulty: 'normal',
    }),
  );
}
const membersOf = (sim: SimulationAPI): AgentState[] => sim.state.household.memberIds.map((id) => sim.state.agents[id]);
const firstOf = (sim: SimulationAPI, defId: string): ObjectState => Object.values(sim.state.objects).find((o) => o.defId === defId)!;

const ctxOf = (sim: EngineSimulation): SimContext => sim.engine.ctx;

describe('balance pass: a target with a critical action waiting is busy for socials', () => {
  it('targetBusyReason → "is busy" while a critical item is queued, free again once it is gone', () => {
    const sim = realSim(71) as EngineSimulation;
    const [mort, ghoulia] = membersOf(sim);
    expect(targetBusyReason(sim.engine, mort, ghoulia)).toBeNull();
    ghoulia.queue.push({ uid: 999_001, interactionId: IX.fightFire, target: { kind: 'self' }, params: {}, source: 'system', priority: PRIORITY.critical, queuedTick: sim.state.tick });
    expect(targetBusyReason(sim.engine, mort, ghoulia)).toBe(`${ghoulia.firstName} is busy`);
    // a player / system item does not make a zombie unavailable for a chat
    ghoulia.queue[0].priority = PRIORITY.system;
    expect(targetBusyReason(sim.engine, mort, ghoulia)).toBeNull();
    // junk queue entries never throw
    (ghoulia.queue as unknown as unknown[]).push(null);
    expect(targetBusyReason(sim.engine, mort, ghoulia)).toBeNull();
    ghoulia.queue = [];
    // the player is told why
    ghoulia.queue.push({ uid: 999_002, interactionId: IX.fightFire, target: { kind: 'self' }, params: {}, source: 'system', priority: PRIORITY.critical, queuedTick: sim.state.tick });
    sim.state.settings.autonomy = 'off';
    const r = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: 'social_chat', target: { kind: 'agent', id: ghoulia.id } });
    if (r.ok) {
      // queued: it must fail at begin with the busy reason instead of starting a doomed respond
      for (let i = 0; i < 8; i++) sim.step();
      expect(mort.active?.interactionId === 'social_chat' && mort.active.phase === 'run').toBe(false);
    } else expect(r.reason).toMatch(/busy/);
    expect(sim.faults()).toEqual([]);
  });

  it('a kitchen fire: housemates are not chatted into a loop, the fire is fought and goes out', () => {
    const sim = realSim(72, ['Mort', 'Ghoulia', 'Bram']) as EngineSimulation;
    const ms = membersOf(sim);
    // sociable, otherwise content: every pick is a social unless something more urgent comes up
    for (const a of ms) for (const n of ['hunger', 'energy', 'fun', 'hygiene'] as const) a.needs[n] = 90;
    for (const a of ms) a.needs.social = 20;
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const r = ctxOf(sim).rel(ms[i].id, ms[j].id);
      r.met = true;
      r.friendship = 50;
    }
    const stove = firstOf(sim, 'stove_greasefire');
    const fireId = ctxOf(sim).sys('upkeep').startFire(stove.id) as string;
    expect(typeof fireId).toBe('string');
    const lastUid: Record<string, number> = {};
    const socialsAtCrew = new Map<string, number>();
    let out = -1;
    for (let i = 0; i < 4 * 90 && out < 0; i++) {
      sim.step();
      sim.drainEvents();
      for (const a of ms) {
        const run = a.active;
        if (!run || run.uid === lastUid[a.id]) continue;
        lastUid[a.id] = run.uid;
        if (run.target.kind !== 'agent' || !sim.content.interactions[run.interactionId]?.social) continue;
        const tgt = sim.state.agents[run.target.id] as AgentState | undefined;
        if (tgt && tgt.queue.some((q) => q.priority >= PRIORITY.critical)) socialsAtCrew.set(a.id, (socialsAtCrew.get(a.id) ?? 0) + 1);
      }
      if (!sim.state.objects[fireId]) out = i;
    }
    expect([...socialsAtCrew.values()].reduce((s, n) => s + n, 0)).toBe(0);
    expect(out, 'the fire is out within 90 game minutes').toBeGreaterThanOrEqual(0);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });
});

/**
 * Ash pile left by a burned stove (skeptic review, seed 1007): Clean Up on item_ash had adBonus 6 — exactly the idle
 * threshold — so with any walking distance it never won an autonomy pick and the ash sat on the stove's tile for days,
 * blocking the replacement stove ("Something's in the way") while the household lived on $5 jerky. adBonus is now 12.
 */
describe('balance pass: autonomy sweeps up ash', () => {
  it('an idle household cleans an ash pile on the burned stove spot within 6 game hours, and the stove can be re-bought there', () => {
    const sim = realSim(73) as EngineSimulation;
    const ctx = ctxOf(sim);
    const stove = firstOf(sim, 'stove_greasefire');
    if (stove.placement.kind !== 'floor') throw new Error('starter stove is a floor object');
    const { x, z, rot } = stove.placement;
    const fp = { x: stove.placement.x, z: stove.placement.z };
    ctx.removeObject(stove.id, 'Burned');
    const ash = ctx.spawnObject('item_ash', { kind: 'loose', x: fp.x + 0.5, z: fp.z + 0.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data: {} });
    expect(sim.build.preview({ type: 'buy', defId: 'stove_greasefire', x, z, rot }).ok, 'the ash blocks the spot').toBe(false);
    let cleanedAt = -1;
    for (let i = 0; i < 6 * 60 * 4 && cleanedAt < 0; i++) {
      sim.step();
      if (i % 240 === 0) sim.drainEvents();
      if (!sim.state.objects[ash.id]) cleanedAt = i;
    }
    expect(cleanedAt, 'ash swept within 6 game hours').toBeGreaterThanOrEqual(0);
    expect(sim.build.apply({ type: 'buy', defId: 'stove_greasefire', x, z, rot }).ok).toBe(true);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('balance review round 2: Chill Out on a refrigerated coffin (docs/BALANCE.md §5.9)', () => {
  it('a household that lost its fridge keeps its freshness up through the Chill-Rest in the daytime', () => {
    const sim = realSim(3001, ['Mort', 'Ghoulia', 'Bones']) as EngineSimulation;
    const ctx = ctxOf(sim);
    ctx.removeObject(firstOf(sim, 'fridge_humming').id, 'Burned'); // no spray, no snacks: only the coffins are left
    const zs = membersOf(sim);
    for (const a of zs) a.needs.preservation = 30;
    let chills = 0;
    let low = 0;
    let samples = 0;
    const last = new Map<string, number>();
    for (let i = 0; i < 3 * 24 * 60 * 4; i++) {
      sim.step();
      for (const a of zs) {
        const r = a.active;
        if (r && r.interactionId === IX.chillOut && last.get(a.id) !== r.uid) {
          last.set(a.id, r.uid);
          chills++;
        }
      }
      if (i % 240 !== 0) continue;
      sim.drainEvents();
      for (const a of zs) {
        if (a.presence !== 'onLot') continue;
        samples++;
        if (a.needs.preservation < 15) low++;
      }
    }
    expect(chills, 'autonomy chills out when freshness runs low').toBeGreaterThanOrEqual(3);
    expect(low / samples, 'share of on-lot hours below Freshness 15').toBeLessThan(0.05);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('Chill Out: +10 Freshness/h, needs power, never picked by autonomy at Freshness ≥ 40', () => {
    const sim = realSim(5) as EngineSimulation;
    const def = sim.engine.content.interactions[IX.chillOut];
    expect(def.advertise?.preservation).toBe(10);
    expect(def.params?.autoMax).toBe(40);
    expect(sim.engine.content.objects.coffin_chillrest.interactions).toContain(IX.chillOut);
    expect(sim.engine.content.objects.sarcophagus_cryo.interactions).toContain(IX.chillOut);
    expect(sim.engine.content.objects.coffin_pine.interactions).not.toContain(IX.chillOut);
    const zs = membersOf(sim);
    for (const a of zs) a.needs.preservation = Math.min(60, a.vitality);
    for (let i = 0; i < 12 * 60 * 4; i++) {
      sim.step();
      for (const a of zs) {
        if (a.active?.interactionId === IX.chillOut && a.active.source === 'auto') expect(a.needs.preservation, 'only when low').toBeLessThan(41);
      }
      if (i % 240 === 0) {
        sim.drainEvents();
        for (const a of zs) a.needs.preservation = Math.max(a.needs.preservation, Math.min(60, a.vitality));
      }
    }
    expect(sim.faults()).toEqual([]);
  });
});
