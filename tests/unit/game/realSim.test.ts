/**
 * Integration with the REAL simulation (src/sim/index.ts, built in parallel by SIM-ENGINE). Skipped when the engine
 * graph cannot be imported. Proves the seams the fakes can't: CAZ output accepted by the real createNewWorld,
 * real events through the router, real serialize → save → load → repair round-trip, no crash path triggered.
 */
import { describe, expect, it } from 'vitest';
import type { SimModule } from '../../../src/game/simTypes';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { validateCazState } from '../../../src/game/cazState';
import { startedHarness } from './controllerHarness';

let real: SimModule | null = null;
let importError = '';
try {
  const mod = await import('../../../src/sim/index');
  real = { createNewWorld: mod.createNewWorld, createSimulation: mod.createSimulation, loadContent: mod.loadContent, LOT_TEMPLATES: mod.LOT_TEMPLATES };
} catch (e) {
  importError = e instanceof Error ? e.message : String(e);
}

describe.skipIf(real === null)(`controller × real simulation${importError ? ` (skipped: ${importError})` : ''}`, () => {
  it('CAZ households generated from real content are accepted by the real createNewWorld', () => {
    const sim = real!;
    const catalog = buildCazCatalog(sim.loadContent(), sim.LOT_TEMPLATES);
    expect(catalog.fromContent).toBe(true);
    for (let seed = 1; seed <= 12; seed++) {
      const h = randomHousehold(seed * 7919, catalog, 1 + (seed % 4));
      const state = { members: h.members, activeIndex: 0, householdName: h.householdName, lotTemplate: 'starter' as const, difficulty: 'normal' as const };
      expect(validateCazState(state, catalog)).toEqual([]);
      const world = sim.createNewWorld({ seed, householdName: h.householdName, members: h.members, lotTemplate: seed % 2 ? 'starter' : 'empty', difficulty: 'normal' });
      expect(world.household.memberIds.length).toBe(h.members.length);
      for (const id of world.household.memberIds) {
        const a = world.agents[id];
        expect(h.members.some((m) => m.firstName === a.firstName)).toBe(true);
      }
    }
  });

  it('full flow: menu demo → CAZ → game → hours of play at speed → save → reload, no fatal', async () => {
    const h = await startedHarness({ realSim: real! });
    expect(h.game.screen).toBe('game');
    const sim = h.game.sim!;
    expect(sim.state.household.memberIds.length).toBe(2);
    expect(h.saves.saveCalls[0].slotId).toMatch(/^auto-[0-9a-f]{8}$/);
    const t0 = sim.state.tick;
    h.game.setSpeed(3);
    await h.frames(240); // ~4 s real at 8 game-min/s ≈ 32 game minutes
    expect(sim.state.tick - t0).toBeGreaterThan(100);
    expect(h.game.fatalError).toBeNull();
    // the interaction menu on a tile always offers Go Here, and queueing it works through the real dispatch
    h.game.openMenuFor({ kind: 'tile', x: 10, z: 20 }, 100, 100);
    const goHere = h.game.menu?.entries.find((e) => e.interactionId === 'engine_goHere');
    expect(goHere).toBeDefined();
    h.game.chooseMenuEntry(goHere!);
    // build mode with the real BuildService preview (wall drag) — never throws
    h.game.setMode('build');
    expect(h.game.applyBuild({ type: 'addWalls', edges: ['h:3:3', 'h:4:3'], style: 'wall_plaster_bone' })).toBeTypeOf('boolean');
    h.game.setMode('live');
    // manual save + reload through the persistence fake (JSON round trip → real repair on load)
    const saved = await h.game.saveGame();
    expect(saved.ok).toBe(true);
    const slot = saved.ok ? saved.info.slotId : '';
    const p = h.game.loadGame(slot);
    await h.until(() => h.game.sim !== sim);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(h.game.screen).toBe('game');
    expect(h.game.sim!.state.tick).toBeGreaterThanOrEqual(t0);
    await h.frames(60);
    expect(h.game.fatalError).toBeNull();
    const d = h.game.diagnostics();
    expect(d).toContain('world: game');
  });
});
