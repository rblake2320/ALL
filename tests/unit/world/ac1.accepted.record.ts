import { mkdirSync, writeFileSync } from 'node:fs';
import { createNewWorld, createSimulation } from '../../../src/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { fixtureSim, newFixtureWorld, member } from '../../../src/sim/engine/fixtures/world';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { noLocks } from '../../../src/persistence/locks';
import { runAc1, ac1Options, type Ac1Template } from './ac1Harness';
const out = process.env.AC1_OUT!;
const baseline = process.env.ACCEPTED_BASE_REF;
if (!baseline || !/^[0-9a-f]{40}$/.test(baseline)) throw Error('Full ACCEPTED_BASE_REF required');
const reloadTick = TICKS_PER_DAY + 6 * TICKS_PER_HOUR;
export async function record(template: Ac1Template | 'fixture') {
  if (!out) throw Error('AC1_OUT required');
  const runs = [];
  if (template === 'fixture') {
    for (const seed of [2024, 99, 5]) {
      const { sim } = fixtureSim(newFixtureWorld({ seed, lotTemplate: 'starter', members: [member('Mort'), member('Ghoulia'), member('Rotney')] }));
      runs.push(await runAc1(`fixture:starter:${seed}`, sim, 3));
    }
  } else for (const seed of [1, 7, 2024]) {
    runs.push(await runAc1(`real:${template}:${seed}`, createSimulation(createNewWorld(ac1Options(template, seed))), 7));
    runs.push(await runAc1(`real:${template}:${seed}:reload`, createSimulation(createNewWorld(ac1Options(template, seed))), 7, {
      reloadAt: { tick: reloadTick, reload: async sim => {
        const manager = new SaveManagerImpl({ backend: createMemoryBackend(), logger: { warn() {}, error() {} }, locks: noLocks, repair: engineRepairHook() });
        const saved = await manager.save('ac1', 'batch baseline', sim.serialize(), { householdName: 'x', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null });
        if (!saved.ok) throw Error(saved.error);
        const loaded = await manager.load('ac1');
        if (!loaded.ok) throw Error(loaded.error);
        return createSimulation(loaded.world);
      } },
    }));
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/${template}.json`, JSON.stringify({ engine: baseline, schemaVersion: 2, days: 7, reloadTick, runs }, null, 2));
}

// This collector must run on the immutable accepted pets/premium base, never the world candidate.
import { it } from 'vitest';
it('record the independent accepted pets-enabled home-only cohort', async () => {
  for (const template of ['derelict', 'starter', 'empty', 'fixture'] as const) await record(template);
}, 600000);
