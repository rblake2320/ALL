/**
 * The scripted S3 travel session (AC-3 / AC-4): one member walks home → Mildew Lane sidewalk → the neighbour's yard
 * (n3) → street → the Old Graveyard gate → a graveyard tile → back home; a second member walks to the street and back
 * meanwhile. The script is a pure function of the live state + tick, so a reloaded or replayed world issues exactly
 * the same commands at the same ticks.
 */
import type { WorldState } from '../../../src/sim/types';
import type { Command } from '../../../src/sim/contracts';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { WorldRouteTarget } from '../../../src/shared/world';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';
import { GRAVEYARD, HOME, N3, stateHash } from './s3Harness';

export const LEGS_A: WorldRouteTarget[] = [
  { regionId: N3, x: 5, z: 25 }, // the neighbour's front yard
  { regionId: GRAVEYARD, x: 14, z: 20 }, // in at the graveyard gate
  { regionId: HOME, x: 15, z: 20 }, // and back home
];
export const LEGS_B: WorldRouteTarget[] = [
  { regionId: 'street:mildew:2', x: 22, z: 0 },
  { regionId: HOME, x: 12, z: 22 },
];
export const SCRIPT_TICKS = 1400;

function walk(actorId: string, t: WorldRouteTarget): Command {
  return { type: 'queue', actorId, interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: t.x, z: t.z }, params: { regionId: t.regionId } };
}

/** Script progress (the "player"): which leg each member walks next. Copied with a save to continue identically. */
export interface Driver {
  a: number;
  b: number;
}

export function scriptCommand(sim: EngineSimulation, members: string[], d: Driver): Command | null {
  const s = sim.state;
  const [a, b] = members;
  const next = (who: string, legs: WorldRouteTarget[], key: 'a' | 'b'): Command | null => {
    const ag = s.agents[who];
    if (!ag || ag.active || ag.queue.length > 0 || d[key] >= legs.length) return null;
    d[key]++;
    return walk(who, legs[d[key] - 1]);
  };
  if (s.tick % 2 === 0) return next(a, LEGS_A, 'a');
  if (s.tick >= 40) return next(b, LEGS_B, 'b');
  return null;
}

export interface ScriptRun {
  hashes: { tick: number; hash: string }[];
  crossings: { tick: number; agentId: string; from: string; to: string; portalId: string }[];
  results: { tick: number; ok: boolean; reason?: string; portals?: string[] }[];
  /** Commands issued (tick at dispatch → command): the "journal" of the run. */
  journal: { tick: number; cmd: Command }[];
}

export function emptyRun(): ScriptRun {
  return { hashes: [], crossings: [], results: [], journal: [] };
}

/**
 * Drive `sim` until `toTick`: before each step the script may dispatch one command (or, with `replay`, the recorded
 * commands of that tick are re-dispatched instead). Every `every` ticks the canonical save hash is recorded.
 */
export function runScript(
  sim: EngineSimulation,
  members: string[],
  toTick: number,
  d: Driver,
  run: ScriptRun,
  opts: { hash?: (world: WorldState) => string; every?: number; replay?: { tick: number; cmd: Command }[]; stopAt?: (tick: number) => boolean } = {},
): ScriptRun {
  const every = opts.every ?? 100;
  while (sim.state.tick < toTick) {
    if (opts.stopAt && opts.stopAt(sim.state.tick)) break;
    const cmds = opts.replay ? opts.replay.filter((j) => j.tick === sim.state.tick).map((j) => j.cmd) : [scriptCommand(sim, members, d)].filter((c): c is Command => !!c);
    for (const cmd of cmds) {
      const r = sim.dispatch(cmd);
      run.journal.push({ tick: sim.state.tick, cmd });
      run.results.push({ tick: sim.state.tick, ok: r.ok, reason: r.reason, portals: r.route && r.route.ok ? r.route.portals : undefined });
    }
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'regionCrossed') run.crossings.push({ tick: sim.state.tick, agentId: e.agentId, from: e.from, to: e.to, portalId: e.portalId });
    if (sim.state.tick % every === 0) run.hashes.push({ tick: sim.state.tick, hash: (opts.hash ?? stateHash)(sim.state) });
  }
  return run;
}
