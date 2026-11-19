/**
 * Scripted player for the Act 1 story start (W-113): drives a REAL derelict-lot simulation through every beat with
 * ordinary player commands (queue interactions, Buy / Build commands). No quest state is touched directly — each beat
 * has to complete from the sim's own events and state.
 */
import type { BuildCommand, Command, SimEvent } from '../../../src/sim/contracts';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import type { EngineSimulation } from '../../../src/sim/engine';
import { ACT1_QUEST_IDS } from '../../../src/sim/content/quests';
import { homeRegionIdOf } from '../../../src/shared/town';

export const HOUSE = { x0: 11, z0: 13, x1: 19, z1: 19 };
export const MAIN_ROOM = { x0: 11, z0: 13, x1: 16, z1: 19 };
export const BACK_ROOM = { x0: 16, z0: 13, x1: 19, z1: 19 };
const HOUR_TICKS = TICKS_PER_HOUR;

export function objectOf(sim: EngineSimulation, defId: string): string | null {
  const home = homeRegionIdOf(sim.state);
  const o = Object.values(sim.state.objects).find((x) => x.defId === defId && x.placement.kind !== 'held' && (x.regionId ?? home) === home);
  return o ? o.id : null;
}

/** Buy `defId` at the first spot inside `box` the build service accepts (z, x, rot scan); ends the build session. */
export function buyIn(sim: EngineSimulation, defId: string, box: { x0: number; z0: number; x1: number; z1: number }): string | null {
  for (let z = box.z0; z < box.z1; z++) {
    for (let x = box.x0; x < box.x1; x++) {
      for (const rot of [0, 1, 2, 3] as const) {
        const cmd: BuildCommand = { type: 'buy', defId, x, z, rot };
        const pv = sim.build.preview(cmd);
        if (!pv.ok || (pv.blockedSlots ?? []).length > 0) continue;
        const r = sim.build.apply(cmd);
        if (r.ok) {
          sim.dispatch({ type: 'endBuildSession' });
          return r.objectId ?? null;
        }
      }
    }
  }
  return null;
}

/** Buy at an exact spot (the layout below keeps every slot reachable); falls back to the first spot in `box`. */
export function buyAt(sim: EngineSimulation, defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3, box?: { x0: number; z0: number; x1: number; z1: number }): string | null {
  const r = sim.build.apply({ type: 'buy', defId, x, z, rot });
  if (r.ok) {
    sim.dispatch({ type: 'endBuildSession' });
    return r.objectId ?? null;
  }
  return box ? buyIn(sim, defId, box) : null;
}

/**
 * Where the scripted player puts things in the shack (fronts never face another object):
 *   kitchen on the main room's north wall: fridge (13,13) and stove (14,13), both facing +Z;
 *   shower (18,16) facing -X in the back room (the sink is at (18,14));
 *   furniture in the main room's south corners; decor along the back room's north and south walls.
 */
export const LAYOUT = {
  fridge: [13, 13, 0],
  stove: [14, 13, 0],
  microwave: [14, 13, 0],
  shower: [18, 16, 1],
  furnish: [
    ['chair_creaky', 11, 18, 0],
    ['lamp_skull', 15, 18, 0],
    ['table_urnstand', 12, 18, 0],
  ],
  decor: [
    ['candelabra_drippy', 16, 13, 0],
    ['headstone_decor', 17, 13, 0],
    ['lamp_skull', 18, 13, 0],
    ['plant_deadfern', 16, 18, 0],
    ['candelabra_drippy', 17, 18, 0],
    ['lamp_skull', 18, 18, 0],
  ],
} as const;

export function activeAct1(sim: EngineSimulation): string | null {
  const a = sim.state.quests?.active.find((q) => ACT1_QUEST_IDS.includes(q.questId));
  return a ? a.questId : null;
}

export function act1Step(sim: EngineSimulation): string | null {
  const a = sim.state.quests?.active.find((q) => ACT1_QUEST_IDS.includes(q.questId));
  if (!a) return null;
  return `${a.questId}#${a.stepIndex}`;
}

function idle(sim: EngineSimulation, id: string): boolean {
  const a = sim.state.agents[id];
  return !!a && a.presence === 'onLot' && a.queue.length === 0 && (!a.active || a.active.source !== 'player');
}

export interface DriveLog {
  quest: SimEvent[];
  notes: string[];
}

/**
 * One player decision per call (call every game minute or so). Returns the commands to dispatch now. `mem` keeps the
 * script's own memory (what was bought) — never quest state.
 */
export function act1Commands(sim: EngineSimulation, mem: Record<string, unknown>): Command[] {
  const ids = sim.state.household.memberIds;
  const a = ids[0];
  const b = ids[1] ?? ids[0];
  const out: Command[] = [];
  const step = act1Step(sim);
  const q = (actorId: string, interactionId: string, target: Command extends never ? never : { kind: 'object'; id: string } | { kind: 'self' } | { kind: 'agent'; id: string }, params?: Record<string, string | number | boolean>) =>
    out.push({ type: 'queue', actorId, interactionId, target, ...(params ? { params } : {}) } as Command);
  switch (step) {
    case 'act1_claim#0': {
      const mb = objectOf(sim, 'mailbox_crooked');
      if (mb && idle(sim, a)) q(a, 'home_checkMail', { kind: 'object', id: mb });
      break;
    }
    case 'act1_rest#0': {
      const c = objectOf(sim, 'coffin_pine');
      if (c && idle(sim, a)) q(a, 'home_sleep', { kind: 'object', id: c });
      break;
    }
    case 'act1_hunger#0':
      if (!mem.fridge) mem.fridge = buyAt(sim, 'fridge_humming', LAYOUT.fridge[0], LAYOUT.fridge[1], LAYOUT.fridge[2], MAIN_ROOM);
      break;
    case 'act1_hunger#1':
      if (!mem.stove) mem.stove = buyAt(sim, (mem.cooker as string | undefined) ?? 'stove_greasefire', LAYOUT.stove[0], LAYOUT.stove[1], LAYOUT.stove[2], MAIN_ROOM);
      break;
    case 'act1_hunger#2': {
      const f = objectOf(sim, 'fridge_humming');
      const m = objectOf(sim, 'microwave_nuke');
      if (m && idle(sim, a)) q(a, 'home_microwaveBurrito', { kind: 'object', id: m });
      else if (f && idle(sim, a) && !mem.cooked) {
        q(a, 'home_cook', { kind: 'object', id: f }, { recipe: 'brainLoaf' });
        mem.cooked = true;
      }
      break;
    }
    case 'act1_scrub#0':
      if (!mem.shower) mem.shower = buyAt(sim, 'shower_drizzle', LAYOUT.shower[0], LAYOUT.shower[1], LAYOUT.shower[2], BACK_ROOM);
      break;
    case 'act1_scrub#1': {
      const s = objectOf(sim, 'shower_drizzle');
      if (s && idle(sim, b)) q(b, 'home_shower', { kind: 'object', id: s });
      break;
    }
    case 'act1_scrub#2': {
      const f = objectOf(sim, 'fridge_humming');
      if (f && idle(sim, b)) q(b, 'home_grabSpray', { kind: 'object', id: f });
      break;
    }
    case 'act1_patch#0':
      if (!mem.walls) {
        // a little yard fence: 4 segments, clear of the house and the path
        const r = sim.build.apply({ type: 'addWalls', edges: ['h:20:22', 'h:21:22', 'h:22:22', 'h:23:22'] });
        mem.walls = r.ok;
        sim.dispatch({ type: 'endBuildSession' });
      }
      break;
    case 'act1_patch#1':
      if (!mem.furnished) {
        mem.furnished = LAYOUT.furnish.map(([d, x, z, r]) => buyAt(sim, d, x, z, r));
      }
      break;
    case 'act1_curb#0':
      if (!mem.decor) mem.decor = buyAt(sim, 'plant_deadfern', 15, 17, 0);
      break;
    case 'act1_curb#1': {
      // dress up the small back room until it scores 4 (one purchase per game hour while it doesn't)
      const i = typeof mem.decorIdx === 'number' ? mem.decorIdx : 0;
      const env = sim.spatial.roomEnvironment(17.5, 17.5);
      if (env < 4 && i < LAYOUT.decor.length && sim.state.tick % HOUR_TICKS === 0) {
        mem.decorIdx = i + 1;
        const [d, x, z, r] = LAYOUT.decor[i];
        buyAt(sim, d, x, z, r);
      }
      break;
    }
    case 'act1_neighbour#0':
      if (idle(sim, a) && idle(sim, b) && a !== b) q(a, 'social_chat', { kind: 'agent', id: b });
      break;
    case 'act1_lease#0': {
      const mb = objectOf(sim, 'mailbox_crooked');
      const due = sim.state.household.bills.some((x) => x.paidTick === null || x.paidTick === undefined);
      if (mb && due && idle(sim, a)) q(a, 'home_payBills', { kind: 'object', id: mb });
      break;
    }
    default:
      break;
  }
  return out;
}

/** Drive until every Act 1 beat is complete (or `maxTicks`). Decisions every game minute. */
export function driveAct1(sim: EngineSimulation, maxTicks: number, log?: DriveLog, mem: Record<string, unknown> = {}, stopAt?: (sim: EngineSimulation) => boolean): void {
  const end = sim.state.tick + maxTicks;
  while (sim.state.tick < end) {
    if (stopAt && stopAt(sim)) return;
    if (sim.state.tick % 4 === 0) for (const c of act1Commands(sim, mem)) sim.dispatch(c);
    sim.step();
    const ev = sim.drainEvents();
    if (log) for (const e of ev) if (e.type === 'questStarted' || e.type === 'questProgress' || e.type === 'questCompleted') log.quest.push(e);
    if (ACT1_QUEST_IDS.every((id) => (sim.state.quests?.completions[id] ?? 0) > 0)) return;
  }
}

export const HOUR = TICKS_PER_HOUR;
