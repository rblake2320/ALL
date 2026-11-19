/** Shared setup for engine tests: fixture world with controllable agents (autonomy off, needs comfortable). */
import type { ContentModule, SimSystem } from '../../../src/sim/contracts';
import type { AgentState, NeedId, ObjectState, TargetRef } from '../../../src/sim/types';
import { NEED_IDS } from '../../../src/sim/types';
import type { Rot } from '../../../src/shared/dimensions';
import { fixtureRegistry, fixtureSim, member, newFixtureWorld, place, steps } from '../../../src/sim/engine/fixtures/world';
import { createCounters, fixtureSystems, type FixtureCounters } from '../../../src/sim/engine/fixtures/systems';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';

export interface SetupOptions {
  members?: string[];
  objects?: { defId: string; x: number; z: number; rot?: Rot }[];
  autonomy?: 'full' | 'limited' | 'off';
  needs?: Partial<Record<NeedId, number>>;
  extraContent?: ContentModule[];
  extraSystems?: SimSystem[];
  seed?: number;
  funds?: number;
}

export interface Setup {
  sim: EngineSimulation;
  agents: AgentState[];
  objects: ObjectState[];
  counters: FixtureCounters;
}

export function setup(o: SetupOptions = {}): Setup {
  const registry = fixtureRegistry(o.extraContent ?? []);
  const counters = createCounters();
  const systems = [...fixtureSystems(counters), ...(o.extraSystems ?? [])];
  const state = newFixtureWorld({ seed: o.seed ?? 99, members: (o.members ?? ['Mort']).map((n) => member(n)), registry, systems });
  const { sim } = fixtureSim(state, { registry, systems, counters });
  sim.state.settings.autonomy = o.autonomy ?? 'off';
  const agents = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
  for (const a of agents) for (const n of NEED_IDS) a.needs[n] = n === 'preservation' ? Math.min(o.needs?.[n] ?? 90, a.vitality) : o.needs?.[n] ?? 90;
  if (o.funds !== undefined) sim.state.household.funds = o.funds;
  const objects = (o.objects ?? []).map((p) => place(sim, p.defId, p.x, p.z, p.rot ?? 0));
  sim.drainEvents();
  return { sim, agents, objects, counters };
}

export function putAt(a: AgentState, x: number, z: number): void {
  a.pos = { x: x + 0.5, z: z + 0.5 };
  a.prevPos = { ...a.pos };
  a.path = null;
}

export function queue(sim: EngineSimulation, a: AgentState, interactionId: string, target: TargetRef, params?: Record<string, string | number | boolean>) {
  return sim.dispatch({ type: 'queue', actorId: a.id, interactionId, target, params });
}

/** Step until predicate holds (or max ticks); returns ticks taken or -1. */
export function until(sim: EngineSimulation, pred: () => boolean, maxTicks = 4000): number {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return i;
    sim.step();
  }
  return pred() ? maxTicks : -1;
}

export function phaseOf(a: AgentState): string | null {
  return a.active ? `${a.active.interactionId}:${a.active.phase}` : null;
}

export { steps };
