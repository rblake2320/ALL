/**
 * W-025 S4 test harness: the REAL engine (shipped content, real spatial service) on a Mildew Lane world whose regions
 * are brought live and frozen by STREAMING only (no manual activation). Never-visited lots are built by a stand-in
 * region builder (the S7 / S14 seam, `setRegionBuilder`): n3 = the shipped `starter` (a furnished house with a
 * fridge and a table), every other lot = the shipped `empty` template (mailbox + tree), the Old Graveyard = `empty`.
 * Streets use the default street lot. The builder is not saved (S7 makes it data-driven), so every load re-installs it.
 */
import { expect } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { createLotTemplate } from '../../../src/sim/spatial';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { Engine } from '../../../src/sim/engine/types';
import type { WorldState } from '../../../src/sim/types';
import type { NewGameOptions } from '../../../src/sim/contracts';
import { setRegionBuilder, type RegionBuilder } from '../../../src/sim/engine/streaming';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { defaultAppearance } from '../../../src/shared/appearance';
import { AC1_MEMBERS, ac1Options } from './ac1Harness';
import { N3 } from './s3Harness';

export const STAND_INS: Record<string, 'starter' | 'empty'> = { [N3]: 'starter' };

export const standInBuilder: RegionBuilder = (_eng, def) => {
  if (def.kind !== 'lot') return null; // streets: the default street lot
  const t = createLotTemplate(STAND_INS[def.id] ?? 'empty');
  return { lot: JSON.parse(JSON.stringify(t.lot)), objects: t.objects };
};

export function membersOf(n: number): NewGameOptions['members'] {
  const names = ['Mort', 'Ghoulia', 'Rotney', 'Morticia', 'Boneca', 'Grimsby', 'Wraithe', 'Cadaver'];
  return Array.from({ length: n }, (_, i) => ({ ...AC1_MEMBERS[i % AC1_MEMBERS.length], firstName: names[i], appearance: defaultAppearance(), traits: [...AC1_MEMBERS[i % AC1_MEMBERS.length].traits] }));
}

export interface StreamWorldOptions {
  seed?: number;
  members?: number;
  autonomy?: 'full' | 'limited' | 'off';
}

/** Wire a simulation for these tests: the stand-in builder (never saved). */
export function wire(sim: EngineSimulation): EngineSimulation {
  setRegionBuilder(sim.engine, standInBuilder);
  return sim;
}

export function streamWorld(o: StreamWorldOptions = {}): { sim: EngineSimulation; eng: Engine; members: string[] } {
  const opts = ac1Options('starter', o.seed ?? 7);
  if (o.members) opts.members = membersOf(o.members);
  const sim = wire(createSimulation(createNewWorld(opts)) as unknown as EngineSimulation);
  expect(sim.dispatch({ type: 'setSettings', settings: { autonomy: o.autonomy ?? 'off', visitorsEnabled: false } }).ok).toBe(true);
  sim.drainEvents();
  return { sim, eng: sim.engine, members: [...sim.state.household.memberIds] };
}

const silent = { warn: () => undefined, error: () => undefined };
const META = { householdName: 'x', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null };

/** Save with the REAL SaveManager (canonical JSON, schema v2 validation, engine repair), load, re-wire. */
export async function saveAndLoad(world: WorldState): Promise<{ sim: EngineSimulation; warnings: string[]; repair: string[] }> {
  const backend = createMemoryBackend();
  const mgr = new SaveManagerImpl({ backend, compress: false, logger: silent, locks: noLocks, repair: engineRepairHook() });
  const w = await mgr.save('slot-s4', 'S4', world, META);
  if (!w.ok) throw new Error(w.error);
  const l = await mgr.load('slot-s4');
  if (!l.ok) throw new Error(l.error);
  const sim = wire(createSimulation(l.world) as unknown as EngineSimulation);
  return { sim, warnings: l.warnings, repair: sim.repairWarnings };
}

/** Active set changes of one step: what the step's tier evaluation thawed / froze. */
export interface TierChange {
  tick: number;
  thawed: string[];
  frozen: string[];
}

export function stepLogged(sim: EngineSimulation, log: TierChange[]): void {
  const before = sim.state.town ? [...sim.state.town.stream.active] : [];
  const tick = sim.state.tick;
  sim.step();
  const after = sim.state.town ? sim.state.town.stream.active : [];
  const thawed = after.filter((r) => !before.includes(r));
  const frozen = before.filter((r) => !after.includes(r));
  if (thawed.length > 0 || frozen.length > 0) log.push({ tick, thawed, frozen });
}
