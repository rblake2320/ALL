/**
 * Backlog #8 / contract decision #19, end to end on the REAL simulation: every achievement the sim reports as a
 * semantic event (skillUp / promotion / milestone) is accompanied — in the SAME tick, for the SAME zombie — by an
 * engine notification of the agreed kind (skill / career / good), and relationship milestones post 'romance' or
 * 'social'. Routed tick by tick through the real EventRouter, each achievement yields exactly ONE toast and ONE
 * sting (no generic "notify" ping on top).
 */
import { describe, expect, it } from 'vitest';
import type { SimContext, SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, Notification } from '../../../src/sim/types';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { IX } from '../../../src/sim/content/home/ids';
import { EventRouter, type RouterHost } from '../../../src/game/events';
import { BubbleBoard, ToastCenter } from '../../../src/game/toasts';
import { FakeAudio, FakeRenderer } from './fakes';

const SEMANTIC: Record<string, Notification['kind']> = { skillUp: 'skill', promotion: 'career', milestone: 'good' };
const STING: Record<string, string> = { skillUp: 'skillUp', promotion: 'promotion', milestone: 'milestone' };

function world(): SimulationAPI {
  return createSimulation(
    createNewWorld({
      seed: 808,
      householdName: 'Kind',
      members: [
        { firstName: 'Mort', lastName: 'Kind', appearance: defaultAppearance(), traits: [], aspiration: 'tycoon' },
        { firstName: 'Ghoulia', lastName: 'Kind', appearance: defaultAppearance(), traits: [], aspiration: 'eternalRomance' },
      ],
      lotTemplate: 'starter',
      difficulty: 'normal',
    }),
  );
}

interface Batch {
  tick: number;
  events: SimEvent[];
}

describe('#8 achievement notifications pair with their semantic events (real sim -> real EventRouter)', () => {
  it('skill-up, promotion, aspiration milestones and relationship milestones: same tick, agreed kinds, one toast + one sting each', () => {
    const sim = world();
    const ctx = (sim as unknown as { engine: { ctx: SimContext } }).engine.ctx;
    const [mort, ghoulia] = sim.state.household.memberIds.map((id) => sim.state.agents[id]) as [AgentState, AgentState];
    for (const a of [mort, ghoulia]) for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) a.needs[n] = 92;
    const batches: Batch[] = [];
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        sim.step();
        const events = sim.drainEvents();
        if (events.length) batches.push({ tick: sim.state.tick, events });
      }
    };
    // (1) skill: Mort practises his speech one xp short of Charisma 1 (also his retail promotion requirement)
    mort.skills.charisma = { level: 0, xp: 99.5 };
    const mirror = Object.values(sim.state.objects).find((o) => o.defId === 'mirror_cracked')!;
    expect(sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.practiceSpeech, target: { kind: 'object', id: mirror.id } }).ok).toBe(true);
    // (2) relationship milestone (+ Ghoulia's eternalRomance "first kiss" milestone): a first kiss
    const rel = ctx.rel(mort.id, ghoulia.id);
    Object.assign(rel, { met: true, friendship: 60, romance: 45 });
    // (3) career: a night-shift retail job, primed one good shift away from a promotion
    expect(ctx.sys('careers').join(mort.id, 'retail')).toBe(true);
    run(4 * 60);
    expect(sim.dispatch({ type: 'queue', actorId: ghoulia.id, interactionId: 'social_kiss', target: { kind: 'agent', id: mort.id } }).ok).toBe(true);
    run(4 * 60);
    mort.career!.performance = 99;
    mort.skills.charisma.level = Math.max(1, mort.skills.charisma.level);
    run(20 * TICKS_PER_HOUR); // through the 22:00–04:00 shift and its review
    // (4) Mort's tycoon "$5,000 funds" milestone fires at an hourly check (starting funds are $6,500)

    const seen = { skillUp: 0, promotion: 0, milestone: 0, romance: 0 };
    const audio = new FakeAudio();
    const toasts = new ToastCenter(() => 0);
    const host: RouterHost = {
      audio,
      renderer: new FakeRenderer(),
      viewport: () => ({ width: 1280, height: 720 }),
      now: () => 0,
      toasts,
      bubbles: new BubbleBoard(),
      gameMinutesPerSecond: () => 1,
      interactive: () => true,
      isSelected: () => false,
      onChoice: () => undefined,
      onGameOver: () => undefined,
      onMusic: () => undefined,
      onAgentLeft: () => undefined,
      onObjectRemoved: () => undefined,
      onLotChanged: () => undefined,
      onError: (where, err) => {
        throw new Error(`router error at ${where}: ${String(err)}`);
      },
    };
    const router = new EventRouter();
    for (const b of batches) {
      const notes = b.events.filter((e): e is Extract<SimEvent, { type: 'notify' }> => e.type === 'notify').map((e) => sim.state.notifications.find((n) => n.id === e.id)).filter((n): n is Notification => !!n);
      for (const n of notes) if (/First kiss|Best Fiends|Going steady|Engaged|Just married/.test(n.title)) {
        expect(['romance', 'social'], n.title).toContain(n.kind);
        seen.romance++;
      }
      const semantic = b.events.filter((e) => e.type in SEMANTIC) as Extract<SimEvent, { type: 'skillUp' | 'promotion' | 'milestone' }>[];
      if (semantic.length === 0) continue;
      for (const e of semantic) {
        seen[e.type]++;
        const kind = SEMANTIC[e.type];
        const want = semantic.filter((x) => x.type === e.type && x.agentId === e.agentId).length;
        const have = notes.filter((n) => n.kind === kind && n.agentId === e.agentId).length;
        expect(have, `tick ${b.tick}: ${e.type} for ${e.agentId} needs a '${kind}' notification in the same tick`).toBeGreaterThanOrEqual(want);
      }
      // route this tick's batch on its own (one frame): one toast per notification, the sting instead of a ping
      const before = toasts.list().length;
      const sfxBefore = audio.sfxIds().length;
      router.route(sim, b.events, host);
      const pushed = toasts.list().slice(before);
      const sfx = audio.sfxIds().slice(sfxBefore);
      for (const e of semantic) {
        const kind = SEMANTIC[e.type];
        // no controller fallback toast on top of the engine's own (fallback titles: "… improved …", "Promotion!", "Aspiration milestone")
        expect(pushed.filter((t) => t.agentId === e.agentId && t.kind === kind && /improved|^Promotion!$|^Aspiration milestone$/.test(t.title))).toEqual([]);
        expect(sfx.filter((id) => id === STING[e.type]).length, `${e.type} sting`).toBe(1);
      }
      // exactly one toast per engine notification — no controller fallback toast doubling an achievement
      expect(pushed.length, `tick ${b.tick}: toasts`).toBe(notes.length);
      // a generic ping only for notifications no sting covers (e.g. the romance "First kiss!" next to the aspiration
      // milestone it completes: two achievements, one sound each); a covered achievement never pings on top
      const uncovered = notes.filter((n) => !semantic.some((e) => SEMANTIC[e.type] === n.kind && e.agentId === n.agentId));
      expect(sfx.filter((id) => id === 'notify' || id === 'notifyBad').length, `tick ${b.tick}: generic ping`).toBeLessThanOrEqual(uncovered.length > 0 ? 1 : 0);
    }
    expect(seen.skillUp).toBeGreaterThanOrEqual(1);
    expect(seen.promotion).toBeGreaterThanOrEqual(1);
    expect(seen.milestone).toBeGreaterThanOrEqual(2); // Mort's $5,000 + Ghoulia's first kiss
    expect(seen.romance).toBeGreaterThanOrEqual(1);
    expect(mort.career?.level).toBe(2);
    expect(sim.faults()).toEqual([]);
  });
});
