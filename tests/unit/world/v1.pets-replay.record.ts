/** Run ONLY on immutable accepted 3cc1f39; the original v1 fixture bytes remain unchanged. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { createSimulation } from '../../../src/sim';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { noLocks } from '../../../src/persistence/locks';
import { readJournal } from '../../../src/persistence/journal';
import { replayEntries } from '../../../src/game/journal';
import { backendOf, fixture, V1_NAMES } from './v1Fixtures';
import { ac1SaveHash } from './ac1Harness';

it('record all old v1 journal replays on the independent accepted pet-enabled engine', async () => {
  const pin = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  expect(pin).toBe(process.env.ACCEPTED_BASE_REF ?? '3cc1f39f4adee7a39034dc29ec20097c1b49a8d8');
  const out = process.env.V1_REPLAY_OUT;
  if (!out) throw Error('V1_REPLAY_OUT required');
  mkdirSync(out, { recursive: true });
  const runs = [];
  for (const name of V1_NAMES.filter(n => n.endsWith('+journal'))) {
    const f = fixture(name), backend = backendOf(f);
    const manager = new SaveManagerImpl({ backend, locks: noLocks, logger: { warn() {}, error() {} }, repair: engineRepairHook() });
    const loaded = await manager.load(f.slotId);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw Error(loaded.error);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.world.schemaVersion).toBe(2);
    const sim = createSimulation(loaded.world);
    const journal = await readJournal(backend, f.slotId, { slotId: f.slotId, payloadSha256: loaded.payloadSha256!, tick: loaded.world.tick });
    expect(journal).not.toBeNull();
    expect(journal!.stoppedBecause).toBeNull();
    const replay = await replayEntries(sim, journal!.entries, { now: () => 0 });
    expect(replay).toMatchObject({ applied: journal!.entries.length, stopped: null, diverged: false });
    expect(sim.state.tick).toBe(f.journal!.endTick);
    expect(sim.faults()).toEqual([]);
    const run = { name, hash: ac1SaveHash(sim.state), tick: sim.state.tick, commands: journal!.entries.filter(e => e.c !== undefined).length, applied: replay.applied, faults: sim.faults(), pets: sim.state.pets };
    runs.push(run);
    writeFileSync(`${out}/${name.replace('+', '-')}.world.json`, JSON.stringify(sim.serialize()));
  }
  writeFileSync(`${out}/reference.json`, JSON.stringify({ engine: pin, schemaVersion: 2, runs }, null, 2));
});
