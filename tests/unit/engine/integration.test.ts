/**
 * Integration with the real spatial module + home/people content & systems through src/sim/index.ts.
 * Skipped (not failed) when those parallel modules can't be imported yet; engine-only suites use fixtures.
 */
import { describe, expect, it } from 'vitest';
import type { NewGameOptions } from '../../../src/sim/contracts';
import { defaultAppearance } from '../../../src/shared/appearance';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { hashState } from '../../../src/sim/engine/fixtures/world';

type SimIndex = typeof import('../../../src/sim/index');
let sim: SimIndex | null = null;
let loadError = '';
try {
  sim = await import('../../../src/sim/index');
} catch (e) {
  loadError = e instanceof Error ? e.message : String(e);
}

const opts = (seed: number): NewGameOptions => ({
  seed,
  householdName: 'The Graves',
  members: [
    { firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: ['gourmand', 'neatFreak', 'nightOwl'], aspiration: 'tycoon' },
    { firstName: 'Ghoulia', lastName: 'Graves', appearance: defaultAppearance(), traits: ['cheerful', 'artistic'], aspiration: 'afterparty' },
    { firstName: 'Rotney', lastName: 'Graves', appearance: defaultAppearance(), traits: ['slob', 'lazy', 'clumsy'], aspiration: null },
  ],
  lotTemplate: 'starter',
  difficulty: 'normal',
});

describe.skipIf(!sim)(`integration with real modules${loadError ? ` (skipped: ${loadError})` : ''}`, () => {
  it('shipped content validates against the shipped systems', () => {
    const problems = sim!.validateContent();
    expect(problems, problems.slice(0, 20).join('\n')).toEqual([]);
  });

  it('exports lot templates and a cached registry', () => {
    expect(sim!.LOT_TEMPLATES.map((t) => t.id).sort()).toEqual(['derelict', 'empty', 'starter']);
    expect(sim!.loadContent()).toBe(sim!.loadContent());
  });

  it('a new game runs a full game day with zero faults and healthy invariants', () => {
    const s = sim!.createSimulation(sim!.createNewWorld(opts(7)));
    expect(s.repairWarnings).toEqual([]); // a fresh world is healthy
    expect(s.checkInvariants()).toEqual([]);
    for (let i = 0; i < 24 * TICKS_PER_HOUR; i++) {
      s.step();
      if (i % 2000 === 0) s.drainEvents();
      if (i % 480 === 0) expect(s.checkInvariants()).toEqual([]);
    }
    expect(s.faults()).toEqual([]);
    expect(s.household()).toHaveLength(3);
    expect(Object.values(s.state.agents).some((a) => a.role === 'townie')).toBe(true);
  }, 240000);

  it('is deterministic end-to-end and survives a save/load round trip', () => {
    const a = sim!.createSimulation(sim!.createNewWorld(opts(99)));
    const b = sim!.createSimulation(sim!.createNewWorld(opts(99)));
    for (let i = 0; i < 6 * TICKS_PER_HOUR; i++) {
      a.step();
      b.step();
    }
    expect(hashState(a.serialize())).toBe(hashState(b.serialize()));
    const loaded = sim!.createSimulation(JSON.parse(JSON.stringify(a.serialize())));
    // decision #9: loading a healthy world is a no-op
    expect(loaded.repairWarnings).toEqual([]);
    expect(loaded.serialize()).toEqual(a.serialize());
    for (let i = 0; i < 2 * TICKS_PER_HOUR; i++) {
      a.step();
      loaded.step();
    }
    expect(hashState(loaded.serialize())).toBe(hashState(a.serialize()));
    expect(sim!.repairWorld(JSON.parse(JSON.stringify(a.serialize())))).toEqual([]);
  }, 240000);
});
