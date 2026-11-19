/**
 * 10 000-tick fuzz on the real modules with quest invariants checked every tick: random player orders, build buy /
 * sell / undo / redo, quest commands, duplicated events, deleted objects, save/load. Run twice from the same seed —
 * once with a save/load round trip every 500 ticks — and both timelines must be identical (quests included).
 */
import { describe, expect, it } from 'vitest';
import type { Command, SimEvent } from '../../../src/sim/contracts';
import type { QuestsState } from '../../../src/sim/types';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { healQuestsState, objectiveTarget } from '../../../src/sim/systems/quests';
import { ALL_QUESTS } from '../../../src/sim/content/quests';
import type { EngineSimulation } from '../../../src/sim/engine';
import { jsonClone, newWorld, opts, simOf, spotFor, systemsWithQuests } from './helpers';

const DEFS = new Map(ALL_QUESTS.map((d) => [d.id, d]));
const TICKS = 10_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkQuests(q: QuestsState | undefined, prevCompletions: Record<string, number>, where: string): string[] {
  const out: string[] = [];
  if (!q) return [`${where}: quests missing`];
  const ids = new Set<string>();
  for (const a of q.active) {
    const def = DEFS.get(a.questId);
    if (!def) out.push(`${where}: unknown active ${a.questId}`);
    if (ids.has(a.questId)) out.push(`${where}: duplicate active ${a.questId}`);
    ids.add(a.questId);
    if (a.instance !== (q.completions[a.questId] ?? 0) + 1) out.push(`${where}: ${a.questId} instance ${a.instance}`);
    if (!def) continue;
    if (a.stepIndex < 0 || a.stepIndex >= def.steps.length) out.push(`${where}: ${a.questId} stepIndex ${a.stepIndex}`);
    const t = objectiveTarget(def.steps[a.stepIndex].objective);
    if (!(a.step.progress >= 0 && a.step.progress <= t)) out.push(`${where}: ${a.questId} progress ${a.step.progress}/${t}`);
    if (a.step.done) out.push(`${where}: ${a.questId} left on a done step`);
    if (def.category === 'story' && (q.completions[a.questId] ?? 0) > 0) out.push(`${where}: completed story quest active again`);
  }
  const g = new Set<string>();
  for (const x of q.grants) {
    if (g.has(x.grantId)) out.push(`${where}: duplicate grant ${x.grantId}`);
    g.add(x.grantId);
    if (x.grantId !== `${q.worldId}:${x.questId}:${x.instance}`) out.push(`${where}: grant id format ${x.grantId}`);
  }
  for (const [k, v] of Object.entries(prevCompletions)) if ((q.completions[k] ?? 0) < v) out.push(`${where}: completions.${k} went down`);
  if (q.pinned !== null && !ids.has(q.pinned)) out.push(`${where}: pinned ${q.pinned} not active`);
  return out;
}

interface FuzzResult {
  final: string;
  completed: string[];
  violations: string[];
  faults: { tick: number; where: string; message: string }[];
}

function fuzz(seed: number, saveLoad: boolean): FuzzResult {
  const systems = systemsWithQuests();
  let sim: EngineSimulation = simOf(newWorld(opts(seed, 3), systems), systems);
  const rnd = mulberry32(seed * 7919);
  const pick = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(rnd() * xs.length)] : undefined);
  const violations: string[] = [];
  const completed: string[] = [];
  const faults: FuzzResult['faults'] = [];
  let lastDone: SimEvent | null = null;
  let prev: Record<string, number> = {};
  for (let i = 0; i < TICKS; i++) {
    const r = rnd();
    const ids = sim.state.household.memberIds;
    const actor = pick(ids);
    const cmds: Command[] = [];
    if (actor && r < 0.02) {
      // a random available menu entry on a random object or agent
      const targets = [...Object.values(sim.state.objects).filter((o) => o.placement.kind !== 'held').map((o) => ({ kind: 'object' as const, id: o.id })), ...Object.keys(sim.state.agents).map((id) => ({ kind: 'agent' as const, id }))];
      const target = pick(targets);
      if (target) {
        const entry = pick(sim.menu(actor, target).flatMap((m) => (m.children && m.children.length ? m.children : [m])).filter((m) => m.available));
        if (entry) cmds.push({ type: 'queue', actorId: actor, interactionId: entry.interactionId, target, params: entry.params });
      }
    } else if (r < 0.024) {
      const s = spotFor(sim, 'plant_deadfern');
      if (s) cmds.push({ type: 'build', cmd: { type: 'buy', defId: pick(['plant_deadfern', 'headstone_decor', 'tree_gnarled'])!, x: s.x, z: s.z, rot: 0 } });
    } else if (r < 0.026) {
      const o = pick(Object.values(sim.state.objects).filter((x) => x.placement.kind === 'floor' && sim.content.objects[x.defId]?.sellable));
      if (o) cmds.push({ type: 'build', cmd: { type: 'sell', objectId: o.id } });
    } else if (r < 0.03) cmds.push({ type: pick(['undo', 'redo', 'endBuildSession'] as const)! });
    else if (r < 0.032) {
      const q = pick(sim.state.quests?.active ?? []);
      cmds.push({ type: 'quest', action: pick(['abandon', 'pin', 'unpin'] as const)!, questId: q ? q.questId : 'nope' });
    } else if (r < 0.034 && lastDone) sim.engine.ctx.emit(lastDone); // duplicated delivery
    else if (r < 0.035) {
      const o = pick(Object.values(sim.state.objects).filter((x) => x.placement.kind === 'loose'));
      if (o) sim.engine.ctx.removeObject(o.id, 'It vanished');
    }
    for (const c of cmds) sim.dispatch(c);
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'interactionCompleted') lastDone = e;
      if (e.type === 'questCompleted') completed.push(e.grantId);
    }
    const q = sim.state.quests;
    if (violations.length < 20) violations.push(...checkQuests(q, prev, `tick ${sim.state.tick}`));
    prev = { ...(q?.completions ?? {}) };
    if (i % 500 === 499) {
      // both timelines end the build session here (undo history is in-memory only and dropped by a reload)
      sim.dispatch({ type: 'endBuildSession' });
      if (saveLoad) {
        faults.push(...sim.faults());
        sim = simOf(jsonClone(sim.serialize()), systems);
        if (sim.repairWarnings.length) violations.push(`repair warnings after load: ${sim.repairWarnings.join('; ')}`);
      }
      const copy = jsonClone(sim.state);
      const fixes = healQuestsState(copy, DEFS);
      if (fixes.length) violations.push(`tick ${sim.state.tick}: heal not a no-op: ${fixes.join(', ')}`);
    }
    if (i % TICKS_PER_HOUR === 0 && violations.length < 20) violations.push(...sim.checkInvariants().map((v) => `tick ${sim.state.tick}: ${v}`));
  }
  faults.push(...sim.faults());
  if (new Set(completed).size !== completed.length) violations.push('a grant id was completed twice');
  const recorded = sim.state.quests!.grants.map((g) => g.grantId);
  for (const id of completed) if (!recorded.includes(id)) violations.push(`completed ${id} missing from the grant log`);
  return { final: JSON.stringify(sim.serialize()), completed, violations, faults };
}

describe('quests fuzz (real modules)', () => {
  it(`${TICKS} ticks: invariants hold every tick; save/load every 500 ticks changes nothing`, () => {
    const a = fuzz(1337, false);
    const b = fuzz(1337, true);
    expect(a.violations).toEqual([]);
    expect(b.violations).toEqual([]);
    expect(a.faults).toEqual([]);
    expect(b.faults).toEqual([]);
    expect(a.completed.length).toBeGreaterThan(0);
    expect(b.completed).toEqual(a.completed);
    expect(b.final === a.final).toBe(true);
  }, 600_000);
});
