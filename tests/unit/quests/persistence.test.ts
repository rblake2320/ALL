/**
 * WorldState.quests through the real persistence pipeline (structural schema + SaveManager on the memory backend +
 * the engine's repair hook): saved and restored byte-identically, old saves without the key load with ZERO warnings
 * and stay without it, broken quest blocks are dropped with a warning (never fatal), and the sim recreates them.
 */
import { describe, expect, it } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { validateWorld } from '../../../src/persistence/validation';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { createSimulation } from '../../../src/sim/index';
import { QUESTS_SYSTEM_ID } from '../../../src/sim/systems/quests';
import { makeMeta, silentLogger } from '../persistence/fixtures';
import { jsonClone, newWorld, opts, run, simOf, systemsWithout, systemsWithQuests } from './helpers';

function midQuestWorld(): WorldState {
  const systems = systemsWithQuests();
  const sim = simOf(newWorld(opts(321), systems), systems);
  run(sim, TICKS_PER_HOUR * 20);
  const w = jsonClone(sim.serialize());
  expect(w.quests!.active.length).toBeGreaterThan(0);
  expect(w.quests!.grants.length).toBeGreaterThan(0);
  return w;
}

describe('quests persistence', () => {
  it('validateWorld: a mid-quest world passes with zero issues and is unchanged', () => {
    const w = midQuestWorld();
    const r = validateWorld(jsonClone(w));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    expect(canonicalJson(r.world)).toBe(canonicalJson(w));
  });

  it('validateWorld: an old save without quests has zero issues and the key stays ABSENT', () => {
    const noQ = systemsWithout(QUESTS_SYSTEM_ID);
    const sim = simOf(newWorld(opts(9), noQ), noQ);
    const w = jsonClone(sim.serialize());
    expect('quests' in w).toBe(false);
    const r = validateWorld(jsonClone(w));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(r.world, 'quests')).toBe(false);
    expect(() => canonicalJson(r.world)).not.toThrow();
  });

  it('validateWorld: broken quest data is repaired or dropped (reported), never fatal', () => {
    const w = midQuestWorld();
    const bad = jsonClone(w) as unknown as { quests: Record<string, unknown> };
    bad.quests.version = 7;
    const r1 = validateWorld(bad);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(Object.prototype.hasOwnProperty.call(r1.world, 'quests')).toBe(false);
      expect(r1.warnings.join('\n')).toContain('quest progress reset');
      // the sim recreates it on load
      expect(createSimulation(r1.world).state.quests!.version).toBe(1);
    }
    const leafy = jsonClone(w) as unknown as { quests: { active: Record<string, unknown>[]; grants: unknown[] } };
    leafy.quests.active[0].stepIndex = -3;
    leafy.quests.active[0].step = { progress: 'x' };
    leafy.quests.grants.push({ grantId: 'g', questId: 'q', instance: 0 });
    const r2 = validateWorld(leafy);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.world.quests!.active[0].stepIndex).toBe(0);
      expect(r2.world.quests!.active[0].step.progress).toBe(0);
      expect(r2.world.quests!.grants.length).toBe(w.quests!.grants.length);
      expect(r2.warnings.length).toBeGreaterThan(0);
    }
    const proto = JSON.parse(JSON.stringify(w).replace('"completions":{', '"completions":{"__proto__":3,')) as unknown;
    const r3 = validateWorld(proto);
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(Object.getPrototypeOf(r3.world.quests!.completions)).toBe(Object.prototype);
  });

  it('SaveManager round trip (atomic memory backend + engine repair hook): byte-identical, no warnings, resumes', async () => {
    const w = midQuestWorld();
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger, repair: engineRepairHook() });
    const saved = await mgr.save('quests', 'Quests', w, makeMeta());
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    const loaded = await mgr.load('quests');
    expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.warnings).toEqual([]);
    expect(canonicalJson(loaded.world)).toBe(canonicalJson(w));
    const systems = systemsWithQuests();
    const a = simOf(jsonClone(w), systems);
    const b = simOf(loaded.world, systems);
    run(a, w.tick + TICKS_PER_HOUR * 6);
    run(b, w.tick + TICKS_PER_HOUR * 6);
    expect(canonicalJson(b.serialize())).toBe(canonicalJson(a.serialize())); // key order differs after canonical save; content must not
  }, 120_000);
});
