/**
 * RECORDER (provenance of tests/unit/world/fixtures/ac1.golden.json and tests/fixtures/saves/v1-saves.json).
 *
 * Run ONLY on the pre-W-025 tree (commit fd20992, schema v1): `git archive fd20992 | tar -x -C <dir>`, copy this file
 * there as tests/unit/world/ac1.record.test.ts next to ac1Harness.ts, then `AC1_OUT=<out> npx vitest run
 * tests/unit/world/ac1.record.test.ts`. It writes the AC-1 golden fingerprints (old engine, 3 templates × 3 seeds × 7
 * days, continuous and with a SaveManager reload at day 1 + 6 h; plus the engine-fixture sim × 3 seeds × 3 days) and
 * the schema-v1 save fixtures (one per template, with and without a W-119 journal) as memory-backend dumps. It refuses
 * to run on a schema-v2 engine. Not a test file (no `.test.ts`): the suite never runs it.
 */
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { SAVE_SCHEMA_VERSION, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import type { WorldState } from '../../../src/sim/types';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { JournalWriter } from '../../../src/persistence/journal';
import { cloneCommand, worldFingerprint } from '../../../src/game/journal';
import { autosaveSlotFor } from '../../../src/game/saves';
import { fixtureSim, newFixtureWorld, member } from '../../../src/sim/engine/fixtures/world';
import { ac1Command, ac1Options, ac1SaveHash, runAc1, type Ac1Run, type Ac1Template } from './ac1Harness';

const OUT = process.env.AC1_OUT ?? '/tmp/ac1-out';
const silent = { warn: () => undefined, error: () => undefined };
const TEMPLATES: Ac1Template[] = ['derelict', 'starter', 'empty'];
const SEEDS = [1, 7, 2024];
const DAYS = 7;
const RELOAD_TICK = TICKS_PER_DAY + 6 * TICKS_PER_HOUR;

function saves(backend = createMemoryBackend(), compress = false) {
  return { backend, mgr: new SaveManagerImpl({ backend, compress, logger: silent, locks: noLocks, repair: engineRepairHook() }) };
}

async function dump(backend: ReturnType<typeof createMemoryBackend>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of await backend.list('')) out[k] = Buffer.from((await backend.read(k))!).toString('base64');
  return out;
}

it('record AC-1 goldens + v1 fixtures', async () => {
  mkdirSync(OUT, { recursive: true });
  if ((SAVE_SCHEMA_VERSION as number) !== 1) throw new Error('the recorder must run on the schema-v1 engine');
  const runs: Ac1Run[] = [];
  for (const tpl of TEMPLATES) {
    for (const seed of SEEDS) {
      const t0 = Date.now();
      runs.push(await runAc1(`real:${tpl}:${seed}`, createSimulation(createNewWorld(ac1Options(tpl, seed))), DAYS));
      // reload at day 1 + 6 h through a real SaveManager round trip (save → load → createSimulation)
      runs.push(
        await runAc1(`real:${tpl}:${seed}:reload`, createSimulation(createNewWorld(ac1Options(tpl, seed))), DAYS, {
          reloadAt: {
            tick: RELOAD_TICK,
            reload: async (sim) => {
              const { mgr } = saves();
              const r = await mgr.save('slot-ac1', 'AC-1', sim.serialize(), { householdName: 'x', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null });
              if (!r.ok) throw new Error(r.error);
              const l = await mgr.load('slot-ac1');
              if (!l.ok) throw new Error(l.error);
              return createSimulation(l.world);
            },
          },
        }),
      );
      console.log(tpl, seed, Date.now() - t0, 'ms');
    }
  }
  for (const seed of [2024, 99, 5]) {
    const { sim } = fixtureSim(newFixtureWorld({ seed, lotTemplate: 'starter', members: [member('Mort'), member('Ghoulia'), member('Rotney')] }));
    runs.push(await runAc1(`fixture:starter:${seed}`, sim, 3));
  }
  writeFileSync(`${OUT}/ac1.golden.json`, JSON.stringify({ engine: 'fd20992', schemaVersion: SAVE_SCHEMA_VERSION, days: DAYS, reloadTick: RELOAD_TICK, runs }, null, 1));

  // ── schema-v1 save fixtures (AC-7): one per template, with and without a journal ──
  const fixtures: Record<string, unknown> = {};
  for (const tpl of TEMPLATES) {
    for (const withJournal of [false, true]) {
      const sim = createSimulation(createNewWorld(ac1Options(tpl, 7)));
      while (sim.state.tick < RELOAD_TICK) {
        const c = ac1Command(sim, sim.state.tick);
        if (c) sim.dispatch(c);
        sim.step();
        sim.drainEvents();
      }
      const { backend, mgr } = saves(createMemoryBackend(), tpl === 'starter');
      const slot = autosaveSlotFor(sim.state);
      const snap: WorldState = sim.serialize();
      const meta = { householdName: snap.household.name, memberNames: [], day: 2, timeLabel: '6:00 AM', funds: snap.household.funds, lotValue: 0, thumbnail: null };
      const r = await mgr.save(slot, 'Fixture', snap, meta, { autosave: true, playMinutes: 42 });
      if (!r.ok || !r.payloadSha256) throw new Error('save failed');
      const quests = (snap.quests?.active ?? []).map((q) => `${q.questId}#${q.stepIndex}`);
      let endTick = snap.tick;
      let commands = 0;
      if (withJournal) {
        let epochN = 0;
        const w = new JournalWriter({ backend, ns: slot, locks: noLocks, wallNow: () => 1_700_000_000_000, newEpoch: () => `00000000feed${String(epochN++).padStart(4, '0')}`, logger: silent });
        if (!(await w.acquire())) throw new Error('lock');
        await w.rebase({ slotId: slot, payloadSha256: r.payloadSha256, tick: snap.tick }, w.mark(), snap.tick * 10);
        const until = snap.tick + 2 * TICKS_PER_HOUR;
        while (sim.state.tick < until) {
          const c = ac1Command(sim, sim.state.tick);
          if (c) {
            const op = w.record({ t: sim.state.tick, atAbs: sim.state.tick * 10, c: cloneCommand(c) });
            op.ok = sim.dispatch(c).ok === true;
            commands++;
          }
          sim.step();
          sim.drainEvents();
          if (sim.state.tick % 60 === 0) w.record({ t: sim.state.tick, atAbs: sim.state.tick * 10, fp: worldFingerprint(sim) });
        }
        // the player's own order on the last tick (a goHere) so the journal certainly holds commands
        const id = sim.state.household.memberIds[0];
        const go = { type: 'queue' as const, actorId: id, interactionId: 'engine_goHere', target: { kind: 'tile' as const, x: 15, z: 26 } };
        const op = w.record({ t: sim.state.tick, atAbs: sim.state.tick * 10, c: cloneCommand(go) });
        op.ok = sim.dispatch(go).ok === true;
        commands++;
        const fl = await w.flush();
        if (fl !== 'written') throw new Error(`flush ${fl}`);
        endTick = sim.state.tick;
        w.release();
      }
      fixtures[`${tpl}${withJournal ? '+journal' : ''}`] = {
        template: tpl,
        seed: 7,
        slotId: slot,
        compressed: tpl === 'starter',
        snapshotTick: snap.tick,
        snapshotSha: r.payloadSha256,
        snapshotHash: ac1SaveHash(snap),
        quests,
        journal: withJournal ? { endTick, commands, liveHash: ac1SaveHash(sim.serialize()) } : null,
        backend: await dump(backend),
      };
    }
  }
  writeFileSync(`${OUT}/v1-saves.json`, JSON.stringify({ engine: 'fd20992', schemaVersion: SAVE_SCHEMA_VERSION, fixtures }, null, 1));
}, 1_800_000);
