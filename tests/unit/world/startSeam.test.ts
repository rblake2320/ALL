/**
 * W-025 S7 seam: Astra's `generateStart` wired into new-game creation (src/sim/engine/world.ts `resolveStart`).
 *  - New Game through the REAL controller: 10 seeds → 10 distinct built home geometry signatures, and 10/10
 *    save → reload keep the same geometry and the same seven neighbours (rebuilt from the saved StartPick).
 *  - Explicit canonical picks and options without `startVariation` keep the exact legacy bytes.
 *  - Garbage seeds and picks never throw out of world creation.
 */
import { describe, expect, it } from 'vitest';
import type { SimModule } from '../../../src/game/simTypes';
import type { NewGameOptions } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES, rebuildStart } from '../../../src/sim/index';
import { validateWorld } from '../../../src/persistence/validation';
import { canonicalStartPick } from '../../../src/shared/town';
import { generateStart } from '../../../src/sim/world/startGenerator';
import { extractStartGeometry } from '../../../src/sim/world/startGeometry';
import { createStartTemplate } from '../../../src/sim/world/startTemplates';
import { createHarness } from '../game/controllerHarness';
import { ac1Options } from './ac1Harness';

const real: SimModule = { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES };
const registry = loadContent();

/** Signature of the BUILT world: the live lot grid and objects, plus the neighbours rebuilt from the saved pick. */
function builtSignature(state: WorldState): string {
  const rebuilt = rebuildStart(state);
  if (!rebuilt) throw new Error('world has no rebuildable start');
  const r = extractStartGeometry({ ...rebuilt.layout, home: { ...rebuilt.layout.home, lot: state.lot, objects: Object.values(state.objects) } });
  if (!r.ok) throw new Error(r.reason);
  return r.signature.key;
}

/** A world's lot grid and placed objects, normalised (spawning links `openingId`s and assigns object ids). */
function built(state: WorldState): unknown {
  const walls = Object.fromEntries(Object.entries(state.lot.walls).map(([k, w]) => [k, { ...w, openingId: null }]));
  const objects = Object.values(state.objects).map((o) => JSON.stringify([o.defId, o.placement])).sort();
  return { floors: state.lot.floors, buildable: state.lot.buildable, walls, objects };
}
function builtOf(t: { lot: WorldState['lot']; objects: readonly { defId: string; placement: unknown }[] }): unknown {
  const walls = Object.fromEntries(Object.entries(t.lot.walls).map(([k, w]) => [k, { ...w, openingId: null }]));
  return { floors: t.lot.floors, buildable: t.lot.buildable, walls, objects: t.objects.map((o) => JSON.stringify([o.defId, o.placement])).sort() };
}

function neighbours(state: WorldState): unknown {
  return rebuildStart(state)!.layout.neighbours;
}

describe('S7 seam: New Game through the real controller', () => {
  it('10 seeds: 10 distinct home geometries, story arc + money policy kept, 10/10 save → reload identical', async () => {
    const seeds = [11, 202, 3003, 40004, 0xc0ffee, 7, 99, 123456, 0xdeadbeef, 2024];
    const keys = new Set<string>();
    let reloads = 0;
    for (const seed of seeds) {
      const h = await createHarness({ realSim: real, tutorial: { v: 1, seen: [] } });
      h.game.beginNewGame();
      h.env.randoms.push(seed);
      const p = h.game.startGame();
      await h.until(() => h.game.screen === 'game' || h.game.screen === 'gameOver');
      await p;
      const sim = h.game.sim!;
      const s = sim.state;
      // default New Game = derelict story start, generated from the controller's seed
      expect(s.seed).toBe(seed >>> 0);
      expect(s.flags.storyArc).toBe('act1');
      const members = s.household.memberIds.length;
      expect(s.household.funds).toBe(2500 + 500 * (members - 1)); // GDD §6: derelict base + $500 per extra member
      expect(s.town?.start).toEqual(generateStart(seed, 'derelict', registry).start);
      expect(s.town?.homeLotId).toBe(`wormwood:${s.town!.start!.slotId}`);
      expect(sim.faults()).toEqual([]);
      const key = builtSignature(s);
      keys.add(key);
      const before = neighbours(s);

      const saved = await h.game.saveGame();
      expect(saved.ok).toBe(true);
      const slot = saved.ok ? saved.info.slotId : '';
      // persistence admission on the stored JSON: no silent repair of generated geometry
      const v = validateWorld(JSON.parse(JSON.stringify(h.saves.slots.get(slot)!.world)));
      expect(v.ok, `seed ${seed} admission`).toBe(true);
      if (v.ok) expect(v.issues).toEqual([]);
      const prev = h.game.sim;
      const lp = h.game.loadGame(slot);
      await h.until(() => h.game.sim !== prev);
      expect((await lp).ok).toBe(true);
      const loaded = h.game.sim!.state;
      expect(loaded.town?.start).toEqual(s.town?.start);
      expect(builtSignature(loaded)).toBe(key);
      expect(neighbours(loaded)).toEqual(before);
      expect(loaded.lot).toEqual(s.lot);
      reloads++;
    }
    expect(keys.size).toBe(seeds.length);
    expect(reloads).toBe(10);
  }, 120_000);

  it('the sandbox starter and empty lots keep their canonical layouts', async () => {
    for (const lot of ['starter', 'empty'] as const) {
      const h = await createHarness({ realSim: real, tutorial: { v: 1, seen: [] } });
      h.game.beginNewGame();
      h.game.updateCaz({ lotTemplate: lot });
      h.env.randoms.push(4242);
      const p = h.game.startGame();
      await h.until(() => h.game.screen === 'game' || h.game.screen === 'gameOver');
      await p;
      const s = h.game.sim!.state;
      expect(s.town?.start).toEqual(canonicalStartPick(lot));
      expect(built(s)).toEqual(builtOf(createStartTemplate(lot)));
    }
  }, 60_000);
});

describe('S7 seam: canonical bytes and refusals', () => {
  it('no startVariation, and an explicit canonical pick, give the exact legacy world bytes', () => {
    for (const tpl of ['derelict', 'starter', 'empty'] as const) {
      for (const seed of [1, 7, 2024]) {
        const legacy = createNewWorld(ac1Options(tpl, seed));
        expect(legacy.town?.start).toEqual(canonicalStartPick(tpl));
        expect(built(legacy)).toEqual(builtOf(createStartTemplate(tpl)));
        const pinned = createNewWorld({ ...ac1Options(tpl, seed), startVariation: true, startPick: canonicalStartPick(tpl) });
        expect(JSON.stringify(pinned)).toBe(JSON.stringify(legacy));
        // the generator itself agrees on canonical bytes
        expect(generateStart(seed, tpl, registry, canonicalStartPick(tpl)).home).toEqual(createStartTemplate(tpl));
      }
    }
  });

  it('a saved generated pick replays the generated home exactly; base type still drives arc and funds', () => {
    const g = generateStart(31, 'derelict', registry);
    const varied = createNewWorld({ ...ac1Options('derelict', 31), startVariation: true });
    const replay = createNewWorld({ ...ac1Options('starter', 31), startPick: JSON.parse(JSON.stringify(g.start)) });
    expect(varied.town?.start).toEqual(g.start);
    expect(built(varied)).toEqual(builtOf(g.home));
    expect(built(varied)).not.toEqual(builtOf(createStartTemplate('derelict')));
    expect(JSON.stringify(replay)).toBe(JSON.stringify(varied));
    expect(varied.flags.storyArc).toBe('act1');
    expect(varied.household.funds).toBe(2500 + 500 * (varied.household.memberIds.length - 1));
    const starter = createNewWorld({ ...ac1Options('starter', 31), startVariation: true });
    expect(starter.flags.storyArc).toBeUndefined();
    expect(starter.household.funds).toBe(6500 + 500 * (starter.household.memberIds.length - 1));
  });

  it('garbage seeds and picks are handled cleanly (never throw; canonical fallback, recorded fault)', () => {
    const bad: Partial<NewGameOptions>[] = [
      { seed: Number.NaN, startVariation: true },
      { seed: Number.POSITIVE_INFINITY, startVariation: true },
      { seed: -5.5, startVariation: true },
      { seed: 'x' as never, startVariation: true },
      { startPick: { ...canonicalStartPick('derelict_lean'), variantSeed: 5, attempt: 99 } },
      { startPick: { ...canonicalStartPick('derelict_lean'), variantSeed: 5, genVersion: 7 } },
      { startPick: { ...canonicalStartPick('derelict'), variantSeed: 5, attempt: 8 } },
      { startPick: { ...canonicalStartPick('mansion'), variantSeed: 3 }, startVariation: true },
      { startPick: { templateId: 'derelict', slotId: 'mildew_x9' } as never, startVariation: true },
      { startPick: null as never, startVariation: true },
      { startPick: 'derelict' as never },
    ];
    for (const b of bad) {
      const o = { ...ac1Options('derelict', 3), ...b } as NewGameOptions;
      let w!: WorldState;
      expect(() => (w = createNewWorld(o))).not.toThrow();
      expect(w.flags.storyArc).toBe('act1');
      expect(w.household.funds).toBeGreaterThanOrEqual(2500);
      const sim = createSimulation(w);
      expect(sim.state.household.memberIds.length).toBeGreaterThan(0);
      expect(validateWorld(JSON.parse(JSON.stringify(sim.serialize()))).ok).toBe(true);
    }
    // a refused generated pick falls back to the canonical lot and says why
    const refused = createNewWorld({ ...ac1Options('derelict', 3), startPick: { ...canonicalStartPick('derelict_lean'), variantSeed: 5, attempt: 99 } });
    expect(refused.town?.start).toEqual(canonicalStartPick('derelict'));
    expect(built(refused)).toEqual(builtOf(createStartTemplate('derelict')));
    expect(rebuildStart({ town: undefined })).toBeNull();
    expect(rebuildStart(null as never)).toBeNull();
    expect(rebuildStart({ town: { ...refused.town!, start: { ...refused.town!.start!, genVersion: 9 } } })).toBeNull();
  });
});
