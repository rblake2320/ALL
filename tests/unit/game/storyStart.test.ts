/**
 * W-113 story start in the game layer (docs/systems/story-start.md §2/§5) on the REAL simulation:
 *  - the derelict claim is the first and default New Game lot (catalog order + initial CAZ state);
 *  - entering a brand-new derelict world shows the "Rise and Squat" card through the hint callout and frames the
 *    zombie and the shack; it is skippable without turning tips off, hides by itself, never blocks, never on load;
 *  - a starter (sandbox) game shows no story card.
 */
import { describe, expect, it } from 'vitest';
import type { SimModule } from '../../../src/game/simTypes';
import { buildCazCatalog, LOT_TEMPLATE_IDS } from '../../../src/game/gddCatalog';
import { initialCaz } from '../../../src/game/randomZombie';
import { STORY_INTRO_ID, STORY_INTRO_MS, storyIntroFor } from '../../../src/game/storyIntro';
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES } from '../../../src/sim/index';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { createHarness, type Harness } from './controllerHarness';

const real: SimModule = { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES };

async function start(lot: 'derelict' | 'starter' | null, settings?: Record<string, unknown>): Promise<Harness> {
  const h = await createHarness({ realSim: real, tutorial: { v: 1, seen: [] }, ...(settings ? { settings } : {}) });
  h.game.beginNewGame();
  if (lot) h.game.updateCaz({ lotTemplate: lot });
  h.env.randoms.push(0xc0ffee);
  const p = h.game.startGame();
  await h.until(() => h.game.screen === 'game' || h.game.screen === 'gameOver');
  await p;
  await h.frames(1);
  return h;
}

describe('New Game: the derelict claim is first and default', () => {
  it('catalog order is derelict, starter, empty; the initial CAZ state picks derelict', () => {
    expect([...LOT_TEMPLATE_IDS]).toEqual(['derelict', 'starter', 'empty']);
    const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES);
    expect(catalog.lotTemplateIds).toEqual(['derelict', 'starter', 'empty']);
    expect(initialCaz(7, catalog).lotTemplate).toBe('derelict');
  });

  it('a catalog without the derelict lot (older sim module) still defaults to starter', () => {
    const catalog = buildCazCatalog(loadContent(), LOT_TEMPLATES.filter((t) => t.id !== 'derelict'));
    expect(catalog.lotTemplateIds).toEqual(['starter', 'empty']);
    expect(initialCaz(7, catalog).lotTemplate).toBe('starter');
  });

  it('the controller lists all three lots and a default new game builds the derelict world with the story arc', async () => {
    const h = await start(null);
    expect(h.game.lotTemplates.map((t) => t.id)).toEqual(['derelict', 'starter', 'empty']);
    expect(h.game.sim!.state.flags.storyArc).toBe('act1');
    expect(h.game.sim!.state.household.funds).toBe(2500);
  }, 60_000);
});

describe('story intro card', () => {
  it('a new derelict game opens on the card (even with tips OFF) and frames the zombie and the shack', async () => {
    const h = await start('derelict', { tutorialEnabled: false });
    const hint = h.game.hint;
    expect(hint).toMatchObject({ id: STORY_INTRO_ID, title: 'Rise and Squat', anchor: null });
    expect(hint!.text.length).toBeGreaterThan(40);
    expect(hint!.text.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length).toBeLessThanOrEqual(4); // 2–3 sentences
    const focus = h.renderer.calls.filter((c) => c.name === 'focus').pop()!;
    const target = focus.args[0] as { x: number; z: number };
    const sim = h.game.sim!;
    const zombie = sim.state.agents[sim.state.household.memberIds[0]].pos;
    // between the zombie (out by the curb) and the shack (z 13..19)
    expect(target.z).toBeGreaterThan(16);
    expect(target.z).toBeLessThan(zombie.z);
    expect(h.renderer.last('setCamera')!.args[0]).toMatchObject({ distance: 24 });
    // input is not blocked: the game keeps running and commands still work
    const t0 = sim.state.tick;
    await h.frames(60);
    expect(sim.state.tick).toBeGreaterThan(t0);
    expect(h.game.dialog).toBeNull();
  }, 60_000);

  it('skipping it never turns the tutorial off, and the tips come back once it is gone', async () => {
    const h = await start('derelict');
    expect(h.game.hint?.id).toBe(STORY_INTRO_ID);
    h.game.dismissHint(STORY_INTRO_ID, true); // even the "never" path must not disable tips
    expect(h.game.settings.tutorialEnabled).toBe(true);
    await h.frames(400);
    expect(h.game.hint === null || h.game.hint.id !== STORY_INTRO_ID).toBe(true);
    h.game.dismissHint(STORY_INTRO_ID); // a second dismiss is harmless
    expect(h.game.settings.tutorialEnabled).toBe(true);
  }, 60_000);

  it(`hides by itself after ${STORY_INTRO_MS / 1000} s`, async () => {
    const h = await start('derelict');
    expect(h.game.hint?.id).toBe(STORY_INTRO_ID);
    h.game.setSpeed(0 as never);
    h.env.advance(STORY_INTRO_MS + 10);
    await h.frames(2);
    expect(h.game.hint?.id ?? null).not.toBe(STORY_INTRO_ID);
  }, 60_000);

  it('never on a starter (sandbox) game, and never again after a save is loaded', async () => {
    const s = await start('starter');
    expect(s.game.hint?.id ?? null).not.toBe(STORY_INTRO_ID);
    expect(s.game.sim!.state.flags.storyArc).toBeUndefined();

    const h = await start('derelict');
    const saved = await h.game.saveGame();
    expect(saved.ok).toBe(true);
    const slot = saved.ok ? saved.info.slotId : '';
    const before = h.game.sim;
    const p = h.game.loadGame(slot);
    await h.until(() => h.game.sim !== before);
    expect((await p).ok).toBe(true);
    await h.frames(2);
    expect(h.game.hint?.id ?? null).not.toBe(STORY_INTRO_ID);
  }, 60_000);

  it('the pure gate: new + act1 + first game hour only', () => {
    const w = createNewWorld({ seed: 3, householdName: 'X', members: [], lotTemplate: 'derelict', difficulty: 'normal' });
    expect(storyIntroFor(w, null)?.id).toBe(STORY_INTRO_ID);
    expect(storyIntroFor(w, 'slot-1')).toBeNull();
    expect(storyIntroFor({ ...w, tick: TICKS_PER_HOUR }, null)).toBeNull();
    expect(storyIntroFor({ ...w, flags: {} }, null)).toBeNull();
    expect(storyIntroFor({ ...w, flags: { storyArc: 'act9' } }, null)).toBeNull();
    expect(storyIntroFor(null, null)).toBeNull();
    expect(storyIntroFor({ ...w, tick: Number.NaN }, null)).toBeNull();
  });
});
