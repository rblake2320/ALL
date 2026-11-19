/**
 * W-025 S3 test harness: the REAL engine (shipped content, real spatial service) on a Mildew Lane world whose
 * neighbouring regions are activated through the S3 seam (`activateRegion`, the call S4 streaming will make).
 *
 * Region stand-ins until their slices land: neighbour lots use the shipped `starter` / `empty` templates (S7 brings
 * the neighbour templates), the Old Graveyard uses the `empty` template (S14 brings `old_graveyard`). Streets use the
 * S3 street lot (`streetLot`: road / curb +2, verge / crosswalk 0).
 */
import { expect } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { createLotTemplate } from '../../../src/sim/spatial';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { Engine } from '../../../src/sim/engine/types';
import type { CommandResult, SimEvent } from '../../../src/sim/contracts';
import type { AgentState, WorldState } from '../../../src/sim/types';
import type { WorldRouteTarget } from '../../../src/shared/world';
import { activateRegion, streetLot } from '../../../src/sim/engine/regionSetup';
import { agentRegion, spatialOfRegion } from '../../../src/sim/engine/regions';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';
import { ac1Options, type Ac1Template } from './ac1Harness';
import { savePayloadSha256 } from '../../../src/persistence/saveManager';

export const HOME = 'wormwood:mildew_n2';
export const N1 = 'wormwood:mildew_n1';
export const N3 = 'wormwood:mildew_n3';
export const S2 = 'wormwood:mildew_s2';
export const GRAVEYARD = 'graveyard:old_graveyard';
export const STREETS = ['street:mildew:0', 'street:mildew:1', 'street:mildew:2', 'street:mildew:3', 'street:mildew:4', 'street:mildew:5'];

export interface LaneOptions {
  seed?: number;
  template?: Ac1Template;
  /** Extra lots to activate (default: n1, n3, s2, graveyard). */
  lots?: Record<string, 'starter' | 'empty' | 'derelict'>;
  /** Autonomy setting while testing (default 'off': only the commands walk). */
  autonomy?: 'full' | 'limited' | 'off';
}

export const DEFAULT_LOTS: Record<string, 'starter' | 'empty' | 'derelict'> = { [N1]: 'empty', [N3]: 'starter', [S2]: 'empty', [GRAVEYARD]: 'empty' };

export function laneWorld(o: LaneOptions = {}): { sim: EngineSimulation; eng: Engine; members: string[] } {
  const world = createNewWorld(ac1Options(o.template ?? 'starter', o.seed ?? 7));
  const sim = createSimulation(world) as unknown as EngineSimulation;
  const eng = sim.engine;
  expect(sim.dispatch({ type: 'setSettings', settings: { autonomy: o.autonomy ?? 'off', visitorsEnabled: false } }).ok).toBe(true);
  activateLane(eng, o.lots ?? DEFAULT_LOTS);
  sim.drainEvents();
  return { sim, eng, members: [...sim.state.household.memberIds] };
}

export function activateLane(eng: Engine, lots: Record<string, 'starter' | 'empty' | 'derelict'>): void {
  for (const id of STREETS) {
    const lot = streetLot(eng, id);
    expect(lot).not.toBeNull();
    expect(activateRegion(eng, id, { lot: lot! })).toEqual({ ok: true });
  }
  for (const [id, tpl] of Object.entries(lots)) {
    const t = createLotTemplate(tpl);
    expect(activateRegion(eng, id, { lot: JSON.parse(JSON.stringify(t.lot)), objects: t.objects })).toEqual({ ok: true });
  }
}

export function goHere(sim: EngineSimulation, actorId: string, t: WorldRouteTarget): CommandResult {
  return sim.dispatch({ type: 'queue', actorId, interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: t.x, z: t.z }, params: { regionId: t.regionId } });
}

export function tileOfAgent(eng: Engine, a: AgentState): { regionId: string; x: number; z: number } {
  const id = agentRegion(eng, a);
  const sp = spatialOfRegion(eng, id)!;
  const t = sp.tileOf(a.pos);
  return { regionId: id, x: t.x, z: t.z };
}

export interface WalkLog {
  ticks: number;
  crossings: { tick: number; from: string; to: string; portalId: string }[];
  failed: string[];
}

/** Step until the agent has no run and no queue (or maxTicks); collects crossings and failures of that agent. */
export function runUntilIdle(sim: EngineSimulation, actorId: string, maxTicks = 6000, onTick?: (tick: number) => void): WalkLog {
  const log: WalkLog = { ticks: 0, crossings: [], failed: [] };
  for (let i = 0; i < maxTicks; i++) {
    sim.step();
    log.ticks++;
    for (const e of sim.drainEvents() as SimEvent[]) {
      if (e.type === 'regionCrossed' && e.agentId === actorId) log.crossings.push({ tick: sim.state.tick, from: e.from, to: e.to, portalId: e.portalId });
      if (e.type === 'interactionFailed' && e.agentId === actorId) log.failed.push(e.reason);
    }
    onTick?.(sim.state.tick);
    const a = sim.state.agents[actorId];
    if (!a.active && a.queue.length === 0) break;
  }
  return log;
}

export function stateHash(w: WorldState): string {
  return savePayloadSha256(JSON.parse(JSON.stringify(w)));
}
