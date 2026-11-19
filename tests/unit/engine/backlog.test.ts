/**
 * Integration-backlog regressions on the FIXTURE world (fast, precise control). Real-content counterparts live in
 * backlog.real.test.ts. Each describe names its backlog item (docs/INTEGRATION_BACKLOG.md).
 */
import { describe, expect, it } from 'vitest';
import type { ContentModule, InteractionDef } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { fixtureSim, hashState } from '../../../src/sim/engine/fixtures/world';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { TAG_WAIT_MAX_MIN } from '../../../src/sim/engine/constants';
import { putAt, setup, steps, until } from './helpers';
import type { AgentState, TargetRef } from '../../../src/sim/types';

/** Continue a simulation from a JSON round trip of its state with the same registry + systems. */
function reload(sim: EngineSimulation): EngineSimulation {
  const saved = JSON.parse(JSON.stringify(sim.serialize())) as WorldState;
  return fixtureSim(saved, { registry: sim.engine.content, systems: sim.engine.systems.map((e) => e.sys) }).sim;
}

// ───────────────────────────── #5 nearestTag wait ─────────────────────────────

/** x_holdFridge keeps the fridge's only slot for `params`-free 10 min; x_fetch needs ANY fridge (nearestTag). */
const tagWaitContent: ContentModule = {
  id: 'x_tagwait',
  interactions: [
    {
      id: 'x_holdFridge',
      label: 'Stare Into the Fridge',
      icon: 'fridge',
      targetKind: 'object',
      stage: { target: { kind: 'target', slots: ['front'] }, duration: 10, anim: 'idle' },
    },
    {
      id: 'x_holdFridgeLong',
      label: 'Stare Into the Fridge Forever',
      icon: 'fridge',
      targetKind: 'object',
      stage: { target: { kind: 'target', slots: ['front'] }, duration: 90, anim: 'idle' },
    },
    {
      id: 'x_fetch',
      label: 'Fetch Ice',
      icon: 'ice',
      targetKind: 'self',
      stages: [
        { target: { kind: 'nearestTag', tag: 'fridge', slots: ['front'] }, duration: 2, anim: 'pickup' },
        { target: { kind: 'here' }, duration: 1, anim: 'idle' },
      ],
    },
  ] as InteractionDef[],
};

/** A player-sourced order straight through ctx.queue (the fixture fridge does not list the x_ interactions). */
function order(sim: EngineSimulation, a: AgentState, interactionId: string, target: TargetRef): number {
  const qi = sim.engine.ctx.queue(a, { interactionId, target, source: 'player' });
  if (!qi) throw new Error(`could not queue ${interactionId}`);
  return qi.uid;
}

function kitchen(members = ['A', 'B']) {
  const s = setup({ members, objects: [{ defId: 'fridge_humming', x: 10, z: 10 }], extraContent: [tagWaitContent] });
  s.agents.forEach((a, i) => putAt(a, 8 + i, 14));
  return s;
}

describe('#5 nearestTag stage waits for a merely reserved object', () => {
  it('waits (phase wait, bound to nothing) while the only fridge is in use, then succeeds in sequence', () => {
    const { sim, agents, objects } = kitchen();
    const [a, b] = agents;
    const fridge = objects[0];
    order(sim, a, 'x_holdFridge', { kind: 'object', id: fridge.id });
    until(sim, () => a.active?.phase === 'run');
    order(sim, b, 'x_fetch', { kind: 'self' });
    sim.step();
    expect(b.active?.phase).toBe('wait');
    expect(b.active?.data._tw).toBe(1);
    expect(b.active?.stageTarget).toEqual({ kind: 'self' });
    expect(Object.values(fridge.reservedBy)).toEqual([a.id]); // the waiter holds no reservation
    expect(sim.checkInvariants()).toEqual([]);
    let ranAtFridge = false;
    for (let i = 0; i < 4 * 30 && b.active; i++) {
      sim.step();
      if (b.active?.phase === 'run' && b.active.stage === 0 && b.active.stageTarget.kind === 'object') ranAtFridge = b.active.stageTarget.id === fridge.id;
    }
    expect(b.active).toBeNull();
    expect(ranAtFridge).toBe(true); // B used the fridge after A was done with it
    expect(sim.state.notifications.some((n) => n.kind === 'bad')).toBe(false);
    expect(sim.faults()).toEqual([]);
  });

  it('three zombies, one fridge: everyone gets their turn', () => {
    const { sim, agents, objects } = kitchen(['A', 'B', 'C']);
    const [a, b, c] = agents;
    order(sim, a, 'x_holdFridge', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    order(sim, b, 'x_fetch', { kind: 'self' });
    order(sim, c, 'x_fetch', { kind: 'self' });
    steps(sim, 2);
    expect([b.active?.phase, c.active?.phase]).toEqual(['wait', 'wait']);
    until(sim, () => !a.active && !b.active && !c.active, 4 * 40);
    expect([a.active, b.active, c.active]).toEqual([null, null, null]);
    expect(sim.state.notifications.filter((n) => n.kind === 'bad')).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it(`gives up after ${TAG_WAIT_MAX_MIN} game minutes with the busy reason (player toast)`, () => {
    const { sim, agents, objects } = kitchen();
    const [a, b] = agents;
    order(sim, a, 'x_holdFridgeLong', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    order(sim, b, 'x_fetch', { kind: 'self' });
    sim.step();
    expect(b.active?.phase).toBe('wait');
    steps(sim, (TAG_WAIT_MAX_MIN - 1) * 4);
    expect(b.active?.phase).toBe('wait'); // still patient at 19 minutes
    steps(sim, 8);
    expect(b.active).toBeNull();
    const note = sim.state.notifications.at(-1)!;
    expect(note.kind).toBe('bad');
    expect(note.text).toBe('The fridge is in use');
    expect(a.active?.interactionId).toBe('x_holdFridgeLong'); // the holder is never disturbed
  });

  it('adversarial: the only fridge is sold mid-wait -> fails on the next re-check (no stale binding, no fault)', () => {
    const { sim, agents, objects } = kitchen();
    const [a, b] = agents;
    order(sim, a, 'x_holdFridgeLong', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    order(sim, b, 'x_fetch', { kind: 'self' });
    steps(sim, 3);
    expect(b.active?.phase).toBe('wait');
    sim.engine.ctx.removeObject(objects[0].id, 'The fridge was sold');
    expect(b.active?.phase).toBe('wait'); // not bound to it: removal does not fail the waiter
    steps(sim, 8);
    expect(b.active).toBeNull();
    expect(sim.state.notifications.at(-1)?.text).toBe('No working fridge here');
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('adversarial: a broken fridge is a hard failure (no waiting), a cancel mid-wait ends quietly', () => {
    const { sim, agents, objects } = kitchen();
    const [a, b] = agents;
    objects[0].condition.broken = true;
    order(sim, b, 'x_fetch', { kind: 'self' });
    sim.step();
    expect(b.active).toBeNull(); // nothing to wait for
    objects[0].condition.broken = false;
    order(sim, a, 'x_holdFridgeLong', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    const uid = order(sim, b, 'x_fetch', { kind: 'self' });
    steps(sim, 6);
    expect(b.active?.phase).toBe('wait');
    const before = sim.state.notifications.length;
    expect(sim.dispatch({ type: 'cancel', actorId: b.id, uid }).ok).toBe(true);
    expect(b.active).toBeNull();
    expect(sim.state.notifications.length).toBe(before);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('save -> load mid-wait continues identically (the wait lives in WorldState only)', () => {
    const { sim, agents, objects } = kitchen();
    const [a, b] = agents;
    order(sim, a, 'x_holdFridge', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    order(sim, b, 'x_fetch', { kind: 'self' });
    steps(sim, 9); // mid-wait, between two re-checks
    expect(b.active?.phase).toBe('wait');
    const loaded = reload(sim);
    expect(loaded.repairWarnings).toEqual([]);
    for (let i = 0; i < 4 * 25; i++) {
      sim.step();
      loaded.step();
    }
    expect(hashState(loaded.serialize())).toBe(hashState(sim.serialize()));
    expect(sim.state.agents[b.id].active).toBeNull();
  });
});

// ───────────────────────────── #12 sleep-time decay ─────────────────────────────

describe('#12 reduced non-energy decay while asleep (GDD §3)', () => {
  function sleeper(difficulty: 'normal' | 'grim' = 'normal') {
    const s = setup({ members: ['Sleepy', 'Awake'], objects: [{ defId: 'coffin_pine', x: 10, z: 10 }], needs: { hunger: 80, social: 80, fun: 80, hygiene: 80, energy: 20 } });
    s.sim.state.settings.difficulty = difficulty;
    putAt(s.agents[0], 8, 13);
    putAt(s.agents[1], 14, 14);
    return s;
  }

  it('asleep: hunger x0.5, social x0.3, fun x0.3, hygiene x0.5 of the awake rates; energy restores', () => {
    const { sim, agents, objects } = sleeper();
    const [z, w] = agents;
    order(sim, z, 'fx_sleep', { kind: 'object', id: objects[0].id });
    until(sim, () => z.active?.phase === 'run');
    expect(z.active?.interactionId).toBe('fx_sleep');
    const s0 = { ...z.needs };
    const w0 = { ...w.needs };
    steps(sim, 240); // one game hour
    expect(z.active?.phase).toBe('run'); // still asleep
    const drop = (a: Record<string, number>, b: Record<string, number>, n: string) => a[n] - b[n];
    expect(drop(s0, z.needs, 'hunger')).toBeCloseTo(5.5 * 0.5, 4);
    expect(drop(s0, z.needs, 'social')).toBeCloseTo(4.0 * 0.3, 4);
    expect(drop(s0, z.needs, 'fun')).toBeCloseTo(4.5 * 0.3, 4);
    expect(drop(s0, z.needs, 'hygiene')).toBeCloseTo(3.5 * 0.5, 4);
    expect(z.needs.energy).toBeGreaterThan(s0.energy);
    // the awake housemate decays at the full GDD rates
    expect(drop(w0, w.needs, 'hunger')).toBeCloseTo(5.5, 4);
    expect(drop(w0, w.needs, 'fun')).toBeCloseTo(4.5, 4);
    // the needs panel trend agrees with what actually happens
    const trend = Object.fromEntries(sim.needs(z.id).map((n) => [n.id, n.trend]));
    expect(trend.hunger).toBeCloseTo(-2.75, 4);
    expect(trend.social).toBeCloseTo(-1.2, 4);
    expect(trend.fun).toBeCloseTo(-1.35, 4);
    expect(trend.hygiene).toBeCloseTo(-1.75, 4);
  });

  it('difficulty still applies on top (grim 1.3), and walking to bed is not sleeping', () => {
    const { sim, agents, objects } = sleeper('grim');
    const [z] = agents;
    putAt(z, 3, 22); // a long walk to the coffin
    order(sim, z, 'fx_sleep', { kind: 'object', id: objects[0].id });
    sim.step();
    expect(z.active?.phase).toBe('route');
    const h0 = z.needs.hunger;
    steps(sim, 4);
    if (z.active?.phase === 'route') expect(h0 - z.needs.hunger).toBeCloseTo(5.5 * 1.3 * (4 / 240), 5);
    until(sim, () => z.active?.phase === 'run');
    const s0 = { ...z.needs };
    steps(sim, 240);
    expect(s0.hunger - z.needs.hunger).toBeCloseTo(5.5 * 1.3 * 0.5, 4);
    expect(s0.fun - z.needs.fun).toBeCloseTo(4.5 * 1.3 * 0.3, 4);
  });

  it('adversarial: a canceled sleeper in its exit minute is awake again (full decay, finite needs)', () => {
    const { sim, agents, objects } = sleeper();
    const [z] = agents;
    const uid = order(sim, z, 'fx_sleep', { kind: 'object', id: objects[0].id });
    until(sim, () => z.active?.phase === 'run');
    sim.dispatch({ type: 'cancel', actorId: z.id, uid });
    expect(z.active?.phase).toBe('exit'); // exit minute: not asleep any more
    const h0 = z.needs.hunger;
    steps(sim, 4);
    expect(h0 - z.needs.hunger).toBeCloseTo(5.5 * (4 / 240), 5);
    for (const v of Object.values(z.needs)) expect(Number.isFinite(v)).toBe(true);
  });
});

// ───────────────────────────── #13 autonomy repetition penalty + trait-bonus cap ─────────────────────────────

import { capTraitBonus } from '../../../src/sim/engine/autonomy';
import { isEssentialInteraction, recentCompletions, REPEAT_FLAG_PREFIX, repetitionFactor } from '../../../src/sim/engine/repetition';
import { NEED_IDS, TICKS_PER_HOUR } from '../../../src/sim/types';

const repContent: ContentModule = {
  id: 'x_rep',
  interactions: [
    {
      id: 'x_slam',
      label: 'Slam the Mirror Cabinet',
      icon: 'angry',
      targetKind: 'object',
      stage: { target: { kind: 'target' }, duration: 1, anim: 'angry' },
      advertise: { fun: 2 },
      traitAd: { fx_grumpy: 12 },
      tags: ['door'],
    },
    {
      id: 'x_gaze',
      label: 'Gaze Lovingly',
      icon: 'mirror',
      targetKind: 'object',
      stage: { target: { kind: 'target' }, duration: 2, anim: 'admire' },
      advertise: { fun: 1 },
      tags: ['mirror'],
    },
  ] as InteractionDef[],
  objects: [],
  traits: [
    { id: 'x_vainest', name: 'Vainest', description: 'Mirrors. Only mirrors.', icon: 'mirror', conflicts: [], reward: false, tagAd: { mirror: 1000 } },
    { id: 'x_neverMirror', name: 'Mirror-Shy', description: 'Never.', icon: 'mirror', conflicts: [], reward: false, tagAd: { mirror: -1000 } },
  ],
};

describe('#13 autonomy repetition penalty', () => {
  function slammer() {
    const s = setup({ members: ['Grump'], objects: [{ defId: 'mirror_cracked', x: 10, z: 10 }], autonomy: 'full', needs: { hunger: 95, energy: 95, social: 95, fun: 95, hygiene: 95 }, extraContent: [repContent] });
    const a = s.agents[0];
    a.traits = ['fx_grumpy'];
    putAt(a, 10, 13);
    // the fixture mirror only lists fx_admire: give it the test hobbies
    (s.sim.engine.content.objects.mirror_cracked as { interactions: string[] }).interactions = ['x_slam', 'x_gaze'];
    return { ...s, a };
  }
  const refresh = (a: AgentState) => {
    for (const n of NEED_IDS) a.needs[n] = n === 'preservation' ? Math.min(95, a.vitality) : 95;
  };

  it('a 1-minute trait hobby is done once per 6-hour window, not every minute (history in WorldState)', () => {
    const { sim, a } = slammer();
    let slams = 0;
    let last = -1;
    for (let h = 0; h < 8; h++) {
      refresh(a);
      for (let i = 0; i < TICKS_PER_HOUR; i++) {
        sim.step();
        if (a.active?.interactionId === 'x_slam' && a.active.uid !== last) {
          last = a.active.uid;
          slams++;
        }
      }
    }
    // without the penalty this loops ~once a minute (hundreds); with it: one per window (t≈0 and t≈6h)
    expect(slams).toBeGreaterThanOrEqual(1);
    expect(slams).toBeLessThanOrEqual(2);
    const hist = String(sim.state.flags[REPEAT_FLAG_PREFIX + a.id] ?? '');
    expect(hist).toMatch(/^(x_slam@\d+)(;x_slam@\d+)*$/);
    expect(sim.faults()).toEqual([]);
  });

  it('only completions count; the window expires (hourly prune) and a reload keeps the history', () => {
    const { sim, a, objects } = slammer();
    sim.state.settings.autonomy = 'off';
    const mirror = objects[0];
    const uid1 = order(sim, a, 'x_gaze', { kind: 'object', id: mirror.id });
    until(sim, () => !a.active, 60);
    const uid2 = order(sim, a, 'x_gaze', { kind: 'object', id: mirror.id });
    until(sim, () => a.active?.phase === 'run', 60);
    sim.dispatch({ type: 'cancel', actorId: a.id, uid: uid2 });
    until(sim, () => !a.active, 60);
    expect(uid1).not.toBe(uid2);
    expect(recentCompletions(sim.engine, a).get('x_gaze')).toBe(1); // the canceled one is not a completion
    const def = sim.engine.content.interactions.x_gaze;
    expect(repetitionFactor(sim.engine, def, recentCompletions(sim.engine, a))).toBeCloseTo(0.6, 9);
    const loaded = reload(sim);
    expect(recentCompletions(loaded.engine, loaded.state.agents[a.id]).get('x_gaze')).toBe(1);
    steps(loaded, 6 * TICKS_PER_HOUR + TICKS_PER_HOUR);
    expect(recentCompletions(loaded.engine, loaded.state.agents[a.id]).size).toBe(0);
    expect(loaded.state.flags[REPEAT_FLAG_PREFIX + a.id]).toBeUndefined(); // pruned, not just ignored
  });

  it('essentials (eat / sleep / hygiene / clean / bills …) only get the mild 0.85^n factor', () => {
    const { sim } = slammer();
    const c = sim.engine.content.interactions;
    for (const id of ['fx_snack', 'fx_dinner', 'fx_sleep', 'fx_shower']) expect(isEssentialInteraction(sim.engine, c[id]), id).toBe(true);
    for (const id of ['x_slam', 'x_gaze', 'fx_watchTv', 'fx_admire', 'fx_chat']) expect(isEssentialInteraction(sim.engine, c[id]), id).toBe(false);
    const three = new Map([['fx_snack', 3], ['x_slam', 3]]);
    expect(repetitionFactor(sim.engine, c.fx_snack, three)).toBeCloseTo(0.85 ** 3, 9);
    expect(repetitionFactor(sim.engine, c.x_slam, three)).toBeCloseTo(0.6 ** 3, 9);
  });

  it('adversarial: junk history flags are ignored, never thrown on, and repaired by the prune', () => {
    const { sim, a } = slammer();
    sim.state.flags[REPEAT_FLAG_PREFIX + a.id] = 'garbage;@12;x_slam@NaN;x_slam@;;x_gaze@1e999;x_slam@99999999999';
    sim.state.flags[REPEAT_FLAG_PREFIX + 'a_ghost'] = 'x_slam@1';
    expect(recentCompletions(sim.engine, a).size).toBe(0); // future / non-finite ticks are not "recent"
    sim.state.flags[REPEAT_FLAG_PREFIX + a.id] = 42;
    expect(recentCompletions(sim.engine, a).size).toBe(0);
    steps(sim, TICKS_PER_HOUR + 1); // hourly housekeeping
    expect(sim.state.flags[REPEAT_FLAG_PREFIX + 'a_ghost']).toBeUndefined();
    expect(typeof (sim.state.flags[REPEAT_FLAG_PREFIX + a.id] ?? '')).toBe('string');
    expect(sim.faults()).toEqual([]);
  });
});

describe('#13 trait / tag ad bonuses are soft-capped', () => {
  it('capTraitBonus: monotonic, bounded by TRAIT_AD_CAP, vetoes pass through', () => {
    const xs = [0, 1, 6, 12, 20, 30, 40, 1000];
    const ys = xs.map(capTraitBonus);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    expect(ys.at(-1)!).toBeLessThanOrEqual(12);
    expect(capTraitBonus(40)).toBeCloseTo(11.57, 1);
    expect(capTraitBonus(-1000)).toBe(-1000);
    expect(capTraitBonus(Number.NaN)).toBe(0);
  });

  it('a +1000 mirror trait cannot out-bid a starving zombie’s meal, while a -1000 veto still vetoes', () => {
    let food = 0;
    let mirror = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup({ seed, members: ['Vain'], objects: [{ defId: 'fridge_humming', x: 5, z: 5 }, { defId: 'mirror_cracked', x: 9, z: 5 }], autonomy: 'full', needs: { hunger: 25, energy: 95, social: 95, fun: 95, hygiene: 95 }, extraContent: [repContent] });
      (s.sim.engine.content.objects.mirror_cracked as { interactions: string[] }).interactions = ['x_gaze'];
      const a = s.agents[0];
      a.traits = ['x_vainest'];
      putAt(a, 7, 9);
      for (let i = 0; i < 200 && !a.active; i++) s.sim.step();
      const id = a.active?.interactionId ?? '';
      if (id === 'fx_snack' || id === 'fx_dinner') food++;
      if (id === 'x_gaze') mirror++;
    }
    expect(food).toBeGreaterThanOrEqual(9); // uncapped, the +1000 mirror would win every single time
    expect(mirror).toBeLessThanOrEqual(3);
    const v = setup({ members: ['Shy'], objects: [{ defId: 'mirror_cracked', x: 9, z: 5 }], autonomy: 'full', needs: { fun: 10 }, extraContent: [repContent] });
    (v.sim.engine.content.objects.mirror_cracked as { interactions: string[] }).interactions = ['x_gaze'];
    v.agents[0].traits = ['x_neverMirror'];
    putAt(v.agents[0], 9, 9);
    let gazed = false;
    for (let i = 0; i < 400; i++) {
      v.sim.step();
      if (v.agents[0].active?.interactionId === 'x_gaze') gazed = true;
    }
    expect(gazed).toBe(false);
  });
});

// ───────────────────────────── #14 engine side: last-resort food in the feral override ─────────────────────────────

import { FERAL_FALLBACK_TAG } from '../../../src/sim/engine/constants';

const gnawContent: ContentModule = {
  id: 'x_gnaw',
  interactions: [
    {
      id: 'x_gnaw',
      label: 'Gnaw the Headstone',
      icon: 'bite',
      targetKind: 'object',
      stage: { target: { kind: 'target' }, duration: 2, anim: 'feral', needsPerHour: { hunger: 60 } },
      advertise: { hunger: 30 },
      tags: [FERAL_FALLBACK_TAG],
    },
  ] as InteractionDef[],
};

describe('#14 engine: FERAL_FALLBACK_TAG candidates are last-resort food for the feral override only', () => {
  function world(withFridge: boolean, hunger: number) {
    const objects = [{ defId: 'headstone_decor', x: 14, z: 10 }, ...(withFridge ? [{ defId: 'fridge_humming', x: 6, z: 10 }] : [])];
    const s = setup({ members: ['Starved'], objects, autonomy: 'full', needs: { hunger, energy: 90, social: 90, fun: 90, hygiene: 90 }, extraContent: [gnawContent] });
    (s.sim.engine.content.objects.headstone_decor as { interactions: string[] }).interactions = ['x_gnaw'];
    putAt(s.agents[0], 10, 13);
    return s;
  }
  const picks = (s: ReturnType<typeof world>, ticks: number) => {
    const seen = new Set<string>();
    for (let i = 0; i < ticks; i++) {
      s.sim.step();
      const id = s.agents[0].active?.interactionId;
      if (id) seen.add(id);
    }
    return seen;
  };

  it('feral with real food reachable: the food wins, the last resort is never touched', () => {
    const s = world(true, 3);
    s.sim.step();
    expect(s.agents[0].status.feral).toBe(true);
    const seen = picks(s, 4 * 30);
    expect([...seen].some((id) => id === 'fx_snack' || id === 'fx_dinner')).toBe(true);
    expect(seen.has('x_gnaw')).toBe(false);
    expect(s.agents[0].status.feral).toBe(false); // fed for real
  });

  it('feral with no food at all: the last resort is picked (critical priority)', () => {
    const s = world(false, 3);
    let pri = 0;
    for (let i = 0; i < 4 * 10 && !pri; i++) {
      s.sim.step();
      if (s.agents[0].active?.interactionId === 'x_gnaw') pri = s.agents[0].active.priority;
    }
    expect(pri).toBeGreaterThan(300);
  });

  it('adversarial: a hungry but NOT feral zombie never picks a last-resort candidate (normal autonomy excludes them)', () => {
    const s = world(false, 30);
    const seen = picks(s, 4 * 60);
    expect(s.agents[0].status.feral).toBe(false);
    expect(seen.has('x_gnaw')).toBe(false);
    expect(s.sim.faults()).toEqual([]);
  });
});
