/**
 * Balance review round 2 (docs/BALANCE.md §5.9): autonomy picks a non-essential interaction id at most DAILY_PICK_CAP
 * times per game day (socials pooled over partners). The 6-hour repetition penalty alone let a liked joke come back
 * 7 times in a day (skeptic seed 2009).
 */
import { describe, expect, it } from 'vitest';
import type { ContentModule, InteractionDef } from '../../../src/sim/contracts';
import type { AgentState, WorldState } from '../../../src/sim/types';
import { NEED_IDS, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { fixtureSim } from '../../../src/sim/engine/fixtures/world';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { DAILY_PICK_CAP, overDailyCap, PICKS_FLAG_PREFIX, picksToday, recordPick } from '../../../src/sim/engine/repetition';
import { timeInfo } from '../../../src/sim/time';
import { putAt, setup, steps } from './helpers';

const content: ContentModule = {
  id: 'x_cap',
  interactions: [
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
  traits: [{ id: 'x_vainest', name: 'Vainest', description: 'Mirrors. Only mirrors.', icon: 'mirror', conflicts: [], reward: false, tagAd: { mirror: 1000 } }],
};

function vain() {
  const s = setup({ members: ['Narcissa'], objects: [{ defId: 'mirror_cracked', x: 10, z: 10 }], autonomy: 'full', needs: { hunger: 95, energy: 95, social: 95, fun: 95, hygiene: 95 }, extraContent: [content] });
  const a = s.agents[0];
  a.traits = ['x_vainest'];
  putAt(a, 10, 13);
  (s.sim.engine.content.objects.mirror_cracked as { interactions: string[] }).interactions = ['x_gaze'];
  return { ...s, a };
}
const refresh = (a: AgentState) => {
  for (const n of NEED_IDS) a.needs[n] = n === 'preservation' ? Math.min(95, a.vitality) : 95;
};

/** Fresh autonomous x_gaze runs per game day over `days` days. */
function gazesPerDay(sim: EngineSimulation, a: AgentState, days: number): Map<number, number> {
  const out = new Map<number, number>();
  let last = -1;
  for (let i = 0; i < days * TICKS_PER_DAY; i++) {
    if (i % TICKS_PER_HOUR === 0) refresh(a);
    sim.step();
    const r = a.active;
    if (r && r.interactionId === 'x_gaze' && r.uid !== last && r.source === 'auto') {
      last = r.uid;
      const d = timeInfo(sim.state.tick).day;
      out.set(d, (out.get(d) ?? 0) + 1);
    }
  }
  return out;
}

describe('daily cap on non-essential autonomous picks', () => {
  it('an irresistible hobby is picked at most DAILY_PICK_CAP times on any game day, and again the next day', () => {
    const { sim, a } = vain();
    const per = gazesPerDay(sim, a, 3);
    expect(per.size).toBeGreaterThanOrEqual(2);
    for (const [d, n] of per) expect(n, `day ${d}`).toBeLessThanOrEqual(DAILY_PICK_CAP);
    // the cap binds (a 1000-point hobby is wanted far more often than 6 times a day) and resets at midnight
    expect([...per.values()].filter((n) => n === DAILY_PICK_CAP).length).toBeGreaterThanOrEqual(2);
    expect(sim.faults()).toEqual([]);
  });

  it('the tally lives in WorldState (survives a JSON reload), essentials are never counted or capped', () => {
    const { sim, a } = vain();
    const c = sim.engine.content.interactions;
    for (let i = 0; i < DAILY_PICK_CAP; i++) recordPick(sim.engine, a, c.x_gaze);
    for (let i = 0; i < 10; i++) recordPick(sim.engine, a, c.fx_snack);
    const today = picksToday(sim.engine, a);
    expect(today.get('x_gaze')).toBe(DAILY_PICK_CAP);
    expect(today.has('fx_snack')).toBe(false);
    expect(overDailyCap(sim.engine, c.x_gaze, today)).toBe(true);
    expect(overDailyCap(sim.engine, c.fx_snack, new Map([['fx_snack', 99]]))).toBe(false);
    const saved = JSON.parse(JSON.stringify(sim.serialize())) as WorldState;
    const loaded = fixtureSim(saved, { registry: sim.engine.content, systems: sim.engine.systems.map((e) => e.sys) }).sim;
    expect(picksToday(loaded.engine, loaded.state.agents[a.id]).get('x_gaze')).toBe(DAILY_PICK_CAP);
  });

  it('adversarial: junk / stale / orphan tallies are ignored and pruned hourly', () => {
    const { sim, a } = vain();
    const day = timeInfo(sim.state.tick).day;
    sim.state.flags[PICKS_FLAG_PREFIX + a.id] = `${day}|=3;x_gaze=NaN;x_gaze=-2;;x_gaze=1e99`;
    expect(picksToday(sim.engine, a).size).toBe(0);
    sim.state.flags[PICKS_FLAG_PREFIX + a.id] = `${day - 1}|x_gaze=6`;
    expect(picksToday(sim.engine, a).size).toBe(0); // yesterday's tally does not cap today
    sim.state.flags[PICKS_FLAG_PREFIX + 'a_ghost'] = `${day}|x_gaze=1`;
    sim.state.settings.autonomy = 'off';
    steps(sim, TICKS_PER_HOUR + 1);
    expect(sim.state.flags[PICKS_FLAG_PREFIX + 'a_ghost']).toBeUndefined();
    expect(sim.state.flags[PICKS_FLAG_PREFIX + a.id]).toBeUndefined();
    sim.state.flags[PICKS_FLAG_PREFIX + a.id] = 42;
    expect(picksToday(sim.engine, a).size).toBe(0);
    expect(sim.faults()).toEqual([]);
  });
});
