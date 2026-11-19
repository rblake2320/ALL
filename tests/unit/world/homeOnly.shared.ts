/**
 * AC-1 home-only comparison against the independently recorded accepted base 00794ea (schema 2): the approved
 * pets/premium batch 3cc1f39 plus the W-153 stray-motion change (animals stay outdoors) and nothing else.
 * Historical fd20992 and 3cc1f39 goldens remain unchanged in fixtures/; pets remain compared.
 * For each template/seed compare daily event and canonical legacy-payload hashes in three modes:
 * A. schema 3 with expansion explicitly frozen; B. no-town in-memory legacy world;
 * C. the same frozen home saved as schema 1 at day 1 + 6 hours, then migrated through the real v3 pipeline.
 * The original collector/projection bytes remain unchanged. A separate legacy adapter permits only inert home-service
 * accounting; active home building/services and assigned jobs throw. Current full-state save/replay stays unprojected.
 * Furnished neighbour streaming and travel are exercised by separate runtime suites.
 */
import { legacyReferenceWorld } from './legacyReference';
import { expect } from 'vitest';
import golden from './fixtures/ac1.accepted-00794ea-pets-outdoors.json';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import type { WorldState } from '../../../src/sim/types';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { savePayloadSha256 } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { legacyTown } from '../../../src/shared/town';
import { ac1Options, ac1Projection, ac1SaveHash, runAc1, type Ac1Run, type Ac1Template } from './ac1Harness';

interface GoldenFile {
  engine: string;
  schemaVersion: number;
  days: number;
  reloadTick: number;
  runs: Ac1Run[];
}
export const GOLDEN = golden as unknown as GoldenFile;
export const AC1_SEEDS = [1, 7, 2024] as const;
export const legacyAc1Hash = (world: WorldState) => ac1SaveHash(legacyReferenceWorld(world));
const silent = { warn: () => undefined, error: () => undefined };
const META = { householdName: 'x', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null };

export function goldenRun(key: string): Ac1Run {
  const r = GOLDEN.runs.find((x) => x.key === key);
  if (!r) throw new Error(`no golden run ${key}`);
  return r;
}

/** Day-by-day comparison with a readable failure (first diverging day). */
export function expectSameRun(actual: Ac1Run, expected: Ac1Run): void {
  expect(actual.days.length).toBe(expected.days.length);
  for (let i = 0; i < expected.days.length; i++) {
    const a = actual.days[i];
    const e = expected.days[i];
    expect({ key: actual.key, day: a.day, tick: a.tick, save: a.save, events: a.events, eventCount: a.eventCount }).toEqual({
      key: actual.key,
      day: e.day,
      tick: e.tick,
      save: e.save,
      events: e.events,
      eventCount: e.eventCount,
    });
  }
  expect(actual.faults).toBe(expected.faults);
}

/** Every evidence line printed by the AC-1 tests (collected for the PR report). */
export function evidence(run: Ac1Run): string {
  const last = run.days[run.days.length - 1];
  return `${run.key}: ${run.days.length} days, ${run.days.reduce((n, d) => n + d.eventCount, 0)} events, day-${last.day} save ${last.save.slice(0, 16)} events ${last.events.slice(0, 16)}`;
}

export async function runNewWorld(tpl: Ac1Template, seed: number): Promise<{ run: Ac1Run; townBefore: string; townAfter: string; world: WorldState }> {
  const world = createNewWorld(ac1Options(tpl, seed));
  // AC-1 is explicitly a HOME-ONLY session. The S7 integration now furnishes neighbouring regions; traversing and
  // streaming those is covered by the world runtime suites, not by comparing a home-only batch to an expanded town.
  if (world.town) world.town.expandPending = true;
  expect(world.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  expect(world.town?.homeLotId).toBe('wormwood:mildew_n2');
  const townBefore = canonicalJson(world.town);
  const sim = createSimulation(world);
  const run = await runAc1(`real:${tpl}:${seed}`, sim, GOLDEN.days, { hash: legacyAc1Hash });
  return { run, townBefore, townAfter: canonicalJson(sim.state.town), world: sim.state };
}

export async function runLegacyNoTown(tpl: Ac1Template, seed: number): Promise<Ac1Run> {
  const world = createNewWorld(ac1Options(tpl, seed)) as WorldState & { town?: unknown };
  delete world.town;
  world.schemaVersion = 1;
  const sim = createSimulation(world);
  // Compare the same legacy payload projection as the independently recorded batch.
  return runAc1(`real:${tpl}:${seed}`, sim, GOLDEN.days, {
    hash: (w) => {
      expect((w as { town?: unknown }).town).toBeUndefined();
      return legacyAc1Hash(w);
    },
  });
}

export async function runMigratedMidRun(tpl: Ac1Template, seed: number): Promise<{ run: Ac1Run; warnings: string[]; repairWarnings: string[]; migratedTown: unknown; tick: number }> {
  let warnings: string[] = [];
  let repairWarnings: string[] = [];
  let migratedTown: unknown = null;
  let tick = -1;
  const start = createNewWorld(ac1Options(tpl, seed));
  if (start.town) start.town.expandPending = true;
  const run = await runAc1(`real:${tpl}:${seed}:reload`, createSimulation(start), GOLDEN.days, {
    hash: legacyAc1Hash,
    reloadAt: {
      tick: GOLDEN.reloadTick,
      reload: async (sim) => {
        const backend = createMemoryBackend();
        // the pre-world save as the old build wrote it: schema v1, no town
        const v1 = new SaveManagerImpl({ backend, schemaVersion: 1, migrations: [], compress: false, logger: silent, locks: noLocks });
        const old = ac1Projection(legacyReferenceWorld(sim.serialize()));
        const w = await v1.save('slot-ac1', 'AC-1', old, META);
        if (!w.ok) throw new Error(w.error);
        const v2 = new SaveManagerImpl({ backend, compress: false, logger: silent, locks: noLocks, repair: engineRepairHook() });
        const l = await v2.load('slot-ac1');
        if (!l.ok) throw new Error(l.error);
        warnings = l.warnings;
        tick = l.world.tick;
        migratedTown = JSON.parse(JSON.stringify(l.world.town));
        const next = createSimulation(l.world);
        repairWarnings = next.repairWarnings;
        return next;
      },
    },
  });
  return { run, warnings, repairWarnings, migratedTown, tick };
}

/**
 * W-025 S4: a new world streams its surroundings in (tiers are state), so its town block is no longer frozen. The
 * AC-1 projection already proves lot / objects / agents / events are untouched; this pins what the town may do:
 * only `stream` and the records of streamed regions change, every streamed region is pristine (no objects frozen,
 * never modified), and the home record is untouched.
 */
export function expectTownStreamedOnly(beforeJson: string, afterJson: string): void {
  const before = JSON.parse(beforeJson) as { homeLotId: string; regions: Record<string, unknown>; stream: unknown };
  const after = JSON.parse(afterJson) as typeof before & { regions: Record<string, { snapshot: { objects: unknown; data: Record<string, unknown> } | null }> };
  const strip = (t: typeof before) => ({ ...t, stream: null, regions: { [t.homeLotId]: t.regions[t.homeLotId] } });
  expect(strip(after)).toEqual(strip(before));
  for (const [id, r] of Object.entries(after.regions)) {
    if (id === after.homeLotId) continue;
    expect(r.snapshot === null || Object.keys(r.snapshot.objects as object).length === 0).toBe(true);
    if (r.snapshot) expect(r.snapshot.data.modifiedTick).toBeUndefined();
  }
}

export function expectLegacyTown(town: unknown, seed: number, tick: number): void {
  expect(town).toEqual(legacyTown(seed, tick));
}
