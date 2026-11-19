/**
 * Integration with the real simulation (SIM-ENGINE's src/sim/index.ts), guarded: skipped while the
 * engine is unavailable or cannot create a world. Proves that engine-produced worlds (fresh and after
 * ticking) pass structural validation with ZERO repairs, survive a save/load round trip through the
 * engine's repairWorld hook, and that the loaded world boots a simulation.
 */
import { describe, expect, it } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { validateWorld } from '../../../src/persistence/validation';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import type { WorldState } from '../../../src/sim/types';
import type { NewGameOptions, SimulationAPI } from '../../../src/sim/contracts';
import { defaultAppearance } from '../../../src/shared/appearance';
import { makeMeta, silentLogger } from './fixtures';

interface EngineModule {
  createNewWorld(opts: NewGameOptions): WorldState;
  createSimulation(state: WorldState): SimulationAPI;
  LOT_TEMPLATES: { id: string }[];
}

async function loadEngine(): Promise<EngineModule | null> {
  const loaders = import.meta.glob('../../../src/sim/index.ts');
  const load = Object.values(loaders)[0];
  if (!load) return null;
  try {
    const mod = (await load()) as Partial<EngineModule>;
    return typeof mod.createNewWorld === 'function' && typeof mod.createSimulation === 'function' ? (mod as EngineModule) : null;
  } catch {
    return null;
  }
}

function newGameOptions(engine: EngineModule, seed: number): NewGameOptions {
  const tmpl = (engine.LOT_TEMPLATES?.[0]?.id ?? 'starter') as NewGameOptions['lotTemplate'];
  return {
    seed,
    householdName: 'Integration Household',
    lotTemplate: tmpl,
    difficulty: 'normal',
    members: [
      { firstName: 'Ada', lastName: 'Bones', appearance: defaultAppearance(), traits: [], aspiration: null },
      { firstName: 'Bram', lastName: 'Bones', appearance: { ...defaultAppearance(), skinTone: 3 }, traits: [], aspiration: null },
    ],
  };
}

function diffPaths(a: unknown, b: unknown, p = '$', out: string[] = []): string[] {
  if (out.length >= 10) return out;
  const isObj = (v: unknown) => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 80)} -> ${JSON.stringify(b)?.slice(0, 80)}`);
    return out;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) diffPaths(ra[k], rb[k], `${p}.${k}`, out);
  return out;
}

let cached: Promise<{ engine: EngineModule; fresh: WorldState; ticked: WorldState } | null> | null = null;

/** One engine world for all tests in this file (2000 ticks is the expensive part). */
function engineWorld(): Promise<{ engine: EngineModule; fresh: WorldState; ticked: WorldState } | null> {
  cached ??= buildEngineWorld();
  return cached;
}

async function buildEngineWorld(): Promise<{ engine: EngineModule; fresh: WorldState; ticked: WorldState } | null> {
  const engine = await loadEngine();
  if (!engine) return null;
  try {
    const fresh = engine.createNewWorld(newGameOptions(engine, 4242));
    const sim = engine.createSimulation(JSON.parse(canonicalJson(fresh)) as WorldState);
    for (let i = 0; i < 2000; i++) sim.step();
    return { engine, fresh, ticked: sim.serialize() };
  } catch {
    return null; // engine still under construction: not this module's failure
  }
}

describe('persistence x real engine', () => {
  it('engine-produced worlds (fresh and after 2000 ticks) pass structural validation with ZERO repairs', { timeout: 180_000 }, async (ctx) => {
    const w = await engineWorld();
    if (!w) return ctx.skip();
    for (const world of [w.fresh, w.ticked]) {
      const v = validateWorld(JSON.parse(canonicalJson(world)));
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.issues, JSON.stringify(v.issues.slice(0, 5))).toEqual([]);
    }
  });

  it('save -> load (no repair hook) is byte-identical for an engine world', async (ctx) => {
    const w = await engineWorld();
    if (!w) return ctx.skip();
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger, repair: null });
    const saved = await mgr.save('integration', 'Integration', w.ticked, makeMeta());
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    const loaded = await mgr.load('integration');
    expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.warnings).toEqual([]);
    expect(diffPaths(JSON.parse(canonicalJson(w.ticked)), JSON.parse(canonicalJson(loaded.world)))).toEqual([]);
  });

  it("with the engine's repairWorld hook: a self-produced world needs no repair, and boots a simulation", async (ctx) => {
    const w = await engineWorld();
    if (!w) return ctx.skip();
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger, repair: engineRepairHook() });
    expect((await mgr.save('integration', 'Integration', w.ticked, makeMeta())).ok).toBe(true);
    const loaded = await mgr.load('integration');
    expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
    if (!loaded.ok) return;
    // A non-empty diff here means SIM-ENGINE's repairWorld changed a valid world it produced itself.
    expect(loaded.warnings, loaded.warnings.join('\n')).toEqual([]);
    expect(diffPaths(JSON.parse(canonicalJson(w.ticked)), JSON.parse(canonicalJson(loaded.world))), 'engine repairWorld drift').toEqual([]);
    const again = w.engine.createSimulation(loaded.world);
    again.step();
    expect(again.state.tick).toBe(w.ticked.tick + 1);
  });
});
