/**
 * Security review 2026-11-05 H-1: the controller tells the profile economy which worlds were created on this profile
 * (new game → reconciled) and which arrived through the importer (never reconciled; contained progress not paid).
 */
import { describe, expect, it } from 'vitest';
import { worldKey } from '../../../src/economy/grants';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { EconomyService } from '../../../src/economy/service';
import { startedHarness } from './controllerHarness';

function economy(): EconomyService {
  const b = createMemoryBackend();
  const now = () => Date.parse('2026-11-05T12:00:00Z');
  const profile = new ProfileStoreImpl(() => Promise.resolve(b), { logger: { warn: () => undefined }, now });
  return new EconomyService({ backend: () => Promise.resolve(b), profile, now, logger: { warn: () => undefined }, broadcast: false });
}

describe('controller → economy world registry (H-1)', () => {
  it('startGame registers the new world as native; importSave marks the imported world (forged id included) as imported', async () => {
    const econ = economy();
    await econ.init();
    const h = await startedHarness({ economy: econ });
    const id = worldKey(h.game.sim!.state as never);
    expect(id).not.toBeNull();
    expect(econ.worldRegistry.worlds[id!]?.origin).toBe('native');
    const forged = { ...(JSON.parse(JSON.stringify(h.game.sim!.state)) as Record<string, unknown>), quests: { version: 1, worldId: 'forged-by-someone', active: [], completions: {}, lastEndedDay: {}, grants: [], pinned: null } };
    const r = await h.game.importSave(new File([JSON.stringify(forged)], 'free-bones.alsave'));
    expect(r.ok).toBe(true);
    expect(econ.worldRegistry.worlds['forged-by-someone']?.origin).toBe('imported');
    // Re-importing a copy of the player's own native world downgrades it too (fail closed).
    await h.game.importSave(new File([JSON.stringify(h.game.sim!.state)], 'mine.alsave'));
    expect(econ.worldRegistry.worlds[id!]?.origin).toBe('imported');
  });
});
