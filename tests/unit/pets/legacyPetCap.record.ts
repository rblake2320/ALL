/** Copy into tests/unit/pets on the immutable accepted schema-2 pets base only. Never regenerate on the candidate. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import { TICK_MINUTES, TICKS_PER_DAY } from '../../../src/sim/types';
import { MAX_PETS, PET_ADOPT_TRUST, CALM_MIN } from '../../../src/sim/systems/pets';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { opts } from '../quests/helpers';
import { makeMeta, silentLogger } from '../persistence/fixtures';

it('record a genuine four-adoption schema-2 save with the accepted old pet limit', async () => {
  const out = process.env.PETS_FIXTURE_OUT;
  if (!out) throw Error('PETS_FIXTURE_OUT required');
  expect(MAX_PETS).toBe(4);
  const sim = createSimulation(createNewWorld(opts(77221, 2)));
  expect(sim.state.schemaVersion).toBe(2);
  const commands: unknown[] = [];
  const act = (cmd: Parameters<typeof sim.dispatch>[0]) => {
    const result = sim.dispatch(cmd);
    commands.push({ tick: sim.state.tick, cmd, result });
    expect(result.ok, JSON.stringify(cmd)).toBe(true);
  };
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      if (sim.state.tick % 720 === 0) act({ type: 'cheat', code: 'freshstart' });
      sim.step();
    }
    expect(sim.faults()).toEqual([]);
    sim.drainEvents();
  };
  // Real dayStart arrivals; no hand-built animals, clock edits, trust edits or nextId edits.
  for (let day = 0; sim.state.pets!.strays.length < 4 && day < 3; day++) step(TICKS_PER_DAY);
  expect(sim.state.pets!.strays).toHaveLength(4);
  const actor = sim.state.agents[sim.state.household.memberIds[0]];
  const placements: unknown[] = [];
  for (const id of sim.state.pets!.strays.map(s => s.id)) {
    const stray = () => sim.state.pets!.strays.find(s => s.id === id)!;
    for (let i = 0; stray().trust < PET_ADOPT_TRUST; i++) {
      expect(i).toBeLessThan(10);
      // Fixture placement only: actual trust, costs, cool-down and adoption use public commands.
      actor.pos = { ...stray().pos };
      placements.push({ tick: sim.state.tick, actorId: actor.id, pos: { ...actor.pos } });
      act({ type: 'pet', action: 'offerScraps', agentId: actor.id, strayId: id });
      step(Math.round(CALM_MIN / TICK_MINUTES));
    }
    actor.pos = { ...stray().pos };
    placements.push({ tick: sim.state.tick, actorId: actor.id, pos: { ...actor.pos } });
    act({ type: 'pet', action: 'adopt', agentId: actor.id, strayId: id });
  }
  expect(sim.state.pets!.pets).toHaveLength(4);
  const sm = new SaveManagerImpl({ backend: createMemoryBackend(), locks: noLocks, logger: silentLogger, repair: engineRepairHook() });
  expect((await sm.save('four-pets', 'Four legacy pets', sim.serialize(), makeMeta())).ok).toBe(true);
  const exported = await sm.exportSlot('four-pets');
  expect(exported).not.toBeNull();
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/pets-four-v2.alsave`, exported!.data);
  writeFileSync(`${out}/pets-four-v2-world.json`, JSON.stringify(sim.serialize(), null, 2));
  writeFileSync(`${out}/pets-four-v2-production.json`, JSON.stringify({ commands, placements, tick: sim.state.tick, petIds: sim.state.pets!.pets.map(p => p.id) }, null, 2));
});
