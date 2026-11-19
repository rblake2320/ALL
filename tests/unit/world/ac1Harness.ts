/**
 * AC-1 equivalence harness (W-025 S1/S2, docs/DESIGN_WORLD_LEVELS.md §1.15).
 *
 * Runs the REAL engine (shipped content, real spatial service) on a scripted multi-day session and returns one
 * fingerprint per game day:
 *   - `save`: SHA-256 of the canonical save payload (exactly what SaveManager hashes into `payloadSha256`), taken of
 *     the AC-1 projection of the world (see `ac1Projection`);
 *   - `events`: SHA-256 of every event drained that day (JSON, in emission order) + the event count.
 *
 * The file deliberately uses ONLY APIs that exist unchanged in the pre-W-025 engine (commit fd20992): the same file
 * was run against that tree to record `ac1.golden.json` (the "old engine" side of the comparison), and the tests run
 * it against the region-aware engine (the "new engine" side). Nothing here may import W-025 code.
 *
 * The script is resolved against the live state each time (menus, ids), so it exercises the same breadth of
 * interactions on every lot template: object interactions picked from the real menus, socials, go-here walks, build
 * and buy with undo/redo, settings, cheats, choices, cancels, renames.
 */
import type { Command, NewGameOptions, SimulationAPI } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { savePayloadSha256 } from '../../../src/persistence/saveManager';
import { sha256HexSync } from '../../../src/persistence/sha256';
import { defaultAppearance } from '../../../src/shared/appearance';

export type Ac1Template = 'derelict' | 'starter' | 'empty';

export interface DayPrint {
  day: number;
  tick: number;
  save: string;
  events: string;
  eventCount: number;
}

export interface Ac1Run {
  key: string;
  days: DayPrint[];
  faults: number;
}

/**
 * The AC-1 projection: the world as the pre-world engine would have saved it. For a pre-W-025 world this is the
 * identity. For a region-aware world it removes the additive schema-v2 `town` block and restores schemaVersion 1;
 * EVERYTHING else (lot, objects, agents, household, quests, rng, flags, ...) must be byte-identical.
 */
export function ac1Projection(world: WorldState): WorldState {
  const copy = JSON.parse(JSON.stringify(world)) as WorldState & { town?: unknown };
  delete copy.town;
  // Jobs are additive batch metadata. This legacy comparison may remove ONLY an empty assignment block;
  // projecting an active job would hide intentional simulation changes and is refused.
  if (copy.jobs?.list.length) throw new Error('AC-1 legacy projection requires no assigned household jobs');
  delete copy.jobs;
  copy.schemaVersion = 1;
  return copy;
}

export function ac1SaveHash(world: WorldState): string {
  return savePayloadSha256(ac1Projection(world));
}

export const AC1_MEMBERS: NewGameOptions['members'] = [
  { firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: ['gourmand', 'clumsy'], aspiration: 'tycoon' },
  { firstName: 'Ghoulia', lastName: 'Graves', appearance: defaultAppearance(), traits: ['socialButterfly', 'neatFreak'], aspiration: 'eternalRomance' },
  { firstName: 'Rotney', lastName: 'Graves', appearance: defaultAppearance(), traits: ['lazy', 'artistic'], aspiration: null },
];

export function ac1Options(template: Ac1Template, seed: number): NewGameOptions {
  return { seed, householdName: 'The Graves', members: AC1_MEMBERS.map((m) => ({ ...m, traits: [...m.traits] })), lotTemplate: template, difficulty: 'normal' };
}

function sortedIds(rec: Record<string, unknown>): string[] {
  return Object.keys(rec).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The scripted player: a command for this tick, or null. Pure function of the live state and the tick. */
export function ac1Command(sim: SimulationAPI, tick: number): Command | null {
  const s = sim.state;
  const ids = s.household.memberIds.filter((id) => s.agents[id] && s.agents[id].presence === 'onLot');
  if (tick === 10) return { type: 'renameHousehold', name: 'The Equivalent Graves' };
  if (ids.length === 0) return null;
  const k = Math.floor(tick / 60);
  const actor = ids[k % ids.length];
  // every game hour + 7 ticks: choices are answered, notifications read
  if (tick % TICKS_PER_HOUR === 7 && s.choices.length > 0) return { type: 'choice', choiceId: s.choices[0].id, option: 0 };
  if (tick % TICKS_PER_DAY === 11) return { type: 'markNotificationsRead' };
  // every 3 game hours: an object interaction from the real menu
  if (tick % (3 * TICKS_PER_HOUR) === 120) {
    const objs = sortedIds(s.objects);
    for (let i = 0; i < objs.length; i++) {
      const id = objs[(k + i) % objs.length];
      const entries = sim.menu(actor, { kind: 'object', id });
      const e = entries.find((m) => m.available && !m.children);
      if (e) return { type: 'queue', actorId: actor, interactionId: e.interactionId, target: { kind: 'object', id }, params: e.params };
    }
    return null;
  }
  // every 4 game hours: a social with another member
  if (tick % (4 * TICKS_PER_HOUR) === 300 && ids.length > 1) {
    const other = ids[(k + 1) % ids.length];
    const entries = sim.menu(actor, { kind: 'agent', id: other });
    const e = entries.find((m) => m.available && !m.children);
    if (e) return { type: 'queue', actorId: actor, interactionId: e.interactionId, target: { kind: 'agent', id: other }, params: e.params };
    return null;
  }
  // every 5 game hours: walk somewhere on the lot
  if (tick % (5 * TICKS_PER_HOUR) === 450) {
    const x = (k * 7) % s.lot.width;
    const z = (k * 11) % s.lot.depth;
    return { type: 'queue', actorId: actor, interactionId: 'engine_goHere', target: { kind: 'tile', x, z } };
  }
  // cancel the first queued item now and then
  if (tick % (7 * TICKS_PER_HOUR) === 610) {
    const a = s.agents[actor];
    const q = a.queue[0];
    if (q) return { type: 'cancel', actorId: actor, uid: q.uid };
    return null;
  }
  const day = Math.floor(tick / TICKS_PER_DAY);
  const inDay = tick % TICKS_PER_DAY;
  // build / buy / undo / redo once a day
  if (inDay === 9 * TICKS_PER_HOUR) {
    const x = 3 + ((day * 5) % 20);
    const z = 3 + ((day * 3) % 18);
    return { type: 'build', cmd: { type: 'buy', defId: day % 2 === 0 ? 'table_rickety' : 'chair_creaky', x, z, rot: 0 } };
  }
  if (inDay === 9 * TICKS_PER_HOUR + 40) {
    const x = 2 + ((day * 4) % 22);
    return { type: 'build', cmd: { type: 'addWalls', edges: [`h:${x}:20`, `h:${x + 1}:20`] } };
  }
  if (inDay === 9 * TICKS_PER_HOUR + 80 && day % 2 === 1) return { type: 'undo' };
  if (inDay === 9 * TICKS_PER_HOUR + 90 && day % 3 === 1) return { type: 'redo' };
  if (inDay === 9 * TICKS_PER_HOUR + 120) return { type: 'endBuildSession' };
  if (inDay === 14 * TICKS_PER_HOUR) {
    if (day === 1) return { type: 'setSettings', settings: { autonomy: 'limited' } };
    if (day === 2) return { type: 'setSettings', settings: { autonomy: 'full' } };
    if (day === 3) return { type: 'cheat', code: 'graverobber' };
    if (day === 4) return { type: 'setSettings', settings: { visitorsEnabled: false } };
    if (day === 5) return { type: 'setSettings', settings: { visitorsEnabled: true } };
  }
  return null;
}

export interface Ac1Hooks {
  /** Called once when the run reaches `atTick` (before that tick's command): may return a replacement simulation. */
  reloadAt?: { tick: number; reload: (sim: SimulationAPI) => SimulationAPI | Promise<SimulationAPI> };
  /** Fingerprint of a world (default ac1SaveHash). */
  hash?: (world: WorldState) => string;
}

/** Step `sim` (already created) to `days` game days with the scripted player; one fingerprint per day boundary. */
export async function runAc1(key: string, sim0: SimulationAPI, days: number, hooks: Ac1Hooks = {}): Promise<Ac1Run> {
  let sim = sim0;
  const hash = hooks.hash ?? ac1SaveHash;
  const out: DayPrint[] = [];
  let parts: string[] = [];
  let count = 0;
  const end = days * TICKS_PER_DAY;
  let reloaded = false;
  while (sim.state.tick < end) {
    if (hooks.reloadAt && !reloaded && sim.state.tick === hooks.reloadAt.tick) {
      reloaded = true;
      sim = await hooks.reloadAt.reload(sim);
    }
    const c = ac1Command(sim, sim.state.tick);
    if (c) {
      const r = sim.dispatch(c);
      parts.push(`#cmd ${sim.state.tick} ${c.type} ${r.ok ? 1 : 0}`);
    }
    sim.step();
    const ev = sim.drainEvents();
    if (ev.length > 0) {
      count += ev.length;
      parts.push(JSON.stringify(ev));
    }
    if (sim.state.tick % TICKS_PER_DAY === 0) {
      out.push({ day: sim.state.tick / TICKS_PER_DAY, tick: sim.state.tick, save: hash(sim.state), events: sha256HexSync(parts.join('\n')), eventCount: count });
      parts = [];
      count = 0;
      // let the vitest worker breathe
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return { key, days: out, faults: sim.faults().length };
}
