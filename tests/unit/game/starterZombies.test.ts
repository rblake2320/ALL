import { describe, expect, it } from 'vitest';
import { STARTER_ZOMBIES, starterZombiePatch } from '../../../src/game/starterZombies';
import { initialCaz } from '../../../src/game/randomZombie';
import { updateMember, validateCazState, finalizeCaz } from '../../../src/game/cazState';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { canUseBody } from '../../../src/game/premiumAccess';
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES } from '../../../src/sim/index';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';

const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);

describe('playable starter zombies', () => {
  it('offers six distinct free cast bodies', () => {
    expect(STARTER_ZOMBIES).toHaveLength(6);
    expect(new Set(STARTER_ZOMBIES.map((p) => p.id)).size).toBe(6);
    expect(new Set(STARTER_ZOMBIES.map((p) => p.body)).size).toBe(6);
    for (const preset of STARTER_ZOMBIES) expect(canUseBody(preset.body, null)).toBe(true);
  });

  for (const id of ['arrival', 'fixer', 'caretaker', 'reader', 'goGetter', 'partyStarter']) {
    it(`${id}: valid household, deterministic simulation and actual save/load`, async () => {
      const before = initialCaz(42, catalog);
      const original = canonicalJson(before);
      const patch = starterZombiePatch(id);
      expect(patch).not.toBeNull();
      const state = updateMember(before, 0, patch!);
      expect(canonicalJson(before)).toBe(original);
      expect(state.members[0].firstName).toBe(before.members[0].firstName);
      expect(state.members[0].lastName).toBe(before.members[0].lastName);
      expect(validateCazState(state, catalog)).toEqual([]);
      expect(validateCazState(state, buildCazCatalog(null, null))).toEqual([]);
      const options = finalizeCaz(state, 123);
      const a = createSimulation(createNewWorld(options));
      const b = createSimulation(createNewWorld(options));
      for (let tick = 0; tick < 120; tick++) { a.step(); b.step(); }
      expect(canonicalJson(a.serialize())).toBe(canonicalJson(b.serialize()));
      const manager = new SaveManagerImpl({ backend: createMemoryBackend(), logger: { warn() {}, error() {} } });
      const world = a.serialize();
      const meta = { householdName: state.householdName, memberNames: state.members.map((m) => m.firstName), day: 1, timeLabel: 'Mon 08:00', funds: 100, lotValue: 0, thumbnail: null };
      const saved = await manager.save('starter', id, world, meta);
      expect(saved.ok).toBe(true);
      const loaded = await manager.load('starter');
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error('Could not load starter save');
      expect(canonicalJson(loaded.world)).toBe(canonicalJson(world));
      expect(Object.values(loaded.world.agents).some((agent) => agent.appearance.body === patch!.appearance.body)).toBe(true);
    });
  }

  it('returns fresh look and trait data for each application', () => {
    const first = starterZombiePatch('arrival')!;
    const expected = canonicalJson(first);
    first.traits.length = 0;
    first.appearance.body = 'sexton';
    expect(canonicalJson(starterZombiePatch('arrival'))).toBe(expected);
  });

  it('rejects unknown IDs and hostile values without property access or coercion', () => {
    for (const id of [undefined, null, '', 'sexton', '__proto__', 'constructor', 0, {}, ['arrival'], { toString() { throw new Error('coerced'); } }]) {
      expect(starterZombiePatch(id)).toBeNull();
    }
  });
});
